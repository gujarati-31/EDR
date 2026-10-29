package com.edr.agent.monitor

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
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

    private val trapPackages = Collections.synchronizedSet(mutableSetOf<String>())
    private val cooldownMap = ConcurrentHashMap<String, Long>()
    private var isInitialized = false

    // Own package name cached to avoid calling context.packageName on every event
    private var ownPackageName = ""

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
    }

    fun getTrapPackages(): Set<String> = trapPackages.toSet()

    /**
     * Called instantly by EdrAccessibilityService when the foreground window changes.
     * This is the PRIMARY detection path. Runs on the accessibility thread — keep it fast.
     *
     * @param context Application context
     * @param pkg     Package name of the newly-foreground app/window
     */
    fun onWindowChanged(context: Context, pkg: String) {
        // Ignore our own EDR agent app
        if (pkg.isEmpty() || pkg == ownPackageName) return

        if (trapPackages.contains(pkg)) {
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
            // User navigated away from the trapped app to something else
            val recordingPkg = AppTrapScreenRecorder.getRecordingPackage()
            if (recordingPkg != null && recordingPkg != pkg) {
                Log.i(TAG, "Window switched to '$pkg' (away from '$recordingPkg'). Stopping recording.")
                AppTrapScreenRecorder.stopRecording(context)
            }
        }
    }

    /**
     * Fallback poller using UsageStatsManager. Called every 5 seconds by EdrForegroundService.
     * Only active as a safety net in case AccessibilityService events are delayed.
     * Queries the last 6 seconds of usage events to avoid gaps between poll intervals.
     */
    fun checkForegroundApp(context: Context) {
        if (trapPackages.isEmpty() && !AppTrapScreenRecorder.isCurrentlyRecording()) return

        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        val now = System.currentTimeMillis()

        try {
            // Query last 6 seconds (slightly more than our 5s poll interval) to avoid gaps
            val events = usm.queryEvents(now - 6000L, now) ?: return
            val event = UsageEvents.Event()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val pkg = event.packageName ?: continue
                if (pkg == ownPackageName) continue

                when (event.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> {
                        if (trapPackages.contains(pkg)) {
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
                                break
                            }
                        } else if (AppTrapScreenRecorder.isCurrentlyRecording()) {
                            val recordingPkg = AppTrapScreenRecorder.getRecordingPackage()
                            if (recordingPkg != null && recordingPkg != pkg) {
                                Log.i(TAG, "Fallback: switched to '$pkg'. Stopping recording of '$recordingPkg'.")
                                AppTrapScreenRecorder.stopRecording(context)
                            }
                        }
                    }
                    UsageEvents.Event.ACTIVITY_PAUSED,
                    UsageEvents.Event.ACTIVITY_STOPPED -> {
                        if (AppTrapScreenRecorder.isCurrentlyRecording()
                            && AppTrapScreenRecorder.getRecordingPackage() == pkg) {
                            Log.i(TAG, "Trap app '$pkg' paused/stopped. Finalizing recording.")
                            AppTrapScreenRecorder.stopRecording(context)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error in checkForegroundApp: ${e.message}")
        }
    }

    private fun resolveAppLabel(context: Context, pkg: String): String {
        return try {
            val pm = context.packageManager
            val info = pm.getApplicationInfo(pkg, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            pkg
        }
    }
}
