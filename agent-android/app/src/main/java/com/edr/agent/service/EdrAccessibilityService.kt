package com.edr.agent.service

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.Executors

/**
 * Optimized Passive EDR Accessibility Service.
 *
 * Designed for ZERO phone interference:
 * - NEVER clicks, touches, or injects gestures on any screen.
 * - NEVER launches intrusive popups or activities over user apps.
 * - Efficiently observes TYPE_WINDOW_STATE_CHANGED solely for Trap App security detection.
 * - Provides non-intrusive silent screenshots via Android 11+ Accessibility Screenshot API.
 */
class EdrAccessibilityService : AccessibilityService() {

    // Throttle window-change events to avoid spamming TrapAppMonitor
    private var lastWindowChangePkg = ""
    private var lastWindowChangeTime = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        applyBankingExclusionScope()
        EdrForegroundService.instance?.updateTrapFallbackSchedule()
        EdrForegroundService.instance?.updateBankingWatcherSchedule()
        Log.i(TAG, "EdrAccessibilityService connected. Passive monitoring active (GPay & banking apps excluded).")
    }

    /**
     * Restricts AccessibilityServiceInfo.packageNames at the Android OS level so GPay
     * and all banking/UPI apps are excluded from Accessibility viewing and event delivery.
     */
    fun applyBankingExclusionScope() {
        try {
            val info = serviceInfo ?: return
            val allowed = com.edr.agent.policy.FinancialAppGuard.getAllowedAccessibilityPackages(this)
            if (allowed.isNotEmpty()) {
                info.packageNames = allowed
                serviceInfo = info
                Log.i(TAG, "Applied OS-level packageNames scope (${allowed.size} apps; banking/GPay excluded).")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not apply banking package exclusion scope: ${e.message}")
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (com.edr.agent.storage.SyncPreferences.isPermissionDisabledByAdmin("accessibility")) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg.isEmpty()) return

        // Hard safety guard: ignore any financial/UPI/GPay app
        if (com.edr.agent.policy.FinancialAppGuard.isFinancialApp(this, pkg)) {
            com.edr.agent.policy.AccessibilityAutoShield.suspendForBankingApp(this, pkg)
            return
        }

        // Detect foreground window changes for Trap App Monitor
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val now = System.currentTimeMillis()
            // Deduplicate: only fire if package actually changed or >1.5s passed
            if (pkg != lastWindowChangePkg || now - lastWindowChangeTime > 1500L) {
                lastWindowChangePkg = pkg
                lastWindowChangeTime = now
                com.edr.agent.monitor.TrapAppMonitor.onWindowChanged(this, pkg)
            }
        }
    }

    /**
     * Compatibility no-op: EDR never performs auto-clicks.
     */
    fun setWaitingForMediaProjection(@Suppress("UNUSED_PARAMETER") waiting: Boolean) {
        // No-op: Auto-clicking is completely disabled for user safety and non-interference
    }

    override fun onInterrupt() {
        Log.w(TAG, "EdrAccessibilityService interrupted.")
    }

    override fun onDestroy() {
        instance = null
        EdrForegroundService.instance?.updateTrapFallbackSchedule()
        EdrForegroundService.instance?.updateBankingWatcherSchedule()
        super.onDestroy()
        Log.w(TAG, "EdrAccessibilityService destroyed.")
    }

    /**
     * Captures a silent system screenshot via Android 11+ Accessibility Screenshot API.
     * Zero popups, zero user interruption. Refuses capture when GPay or banking apps are open.
     */
    fun takeSilentScreenshot(
        targetWidth: Int = 720,
        targetHeight: Int = 0,
        callback: (Bitmap?) -> Unit
    ) {
        if (com.edr.agent.storage.SyncPreferences.isPermissionDisabledByAdmin("accessibility")) {
            Log.d(TAG, "Blocked screenshot capture: Accessibility disabled by Administrator.")
            callback(null)
            return
        }
        if (com.edr.agent.policy.FinancialAppGuard.isCurrentForegroundFinancial(this)) {
            Log.d(TAG, "Blocked screenshot capture: protected GPay/banking app active.")
            callback(null)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    executor,
                    object : TakeScreenshotCallback {
                        override fun onSuccess(screenshot: ScreenshotResult) {
                            var swBitmap: Bitmap? = null
                            try {
                                val hwBuffer = screenshot.hardwareBuffer
                                val colorSpace = screenshot.colorSpace
                                val hwBitmap = Bitmap.wrapHardwareBuffer(hwBuffer, colorSpace)
                                swBitmap = hwBitmap?.copy(Bitmap.Config.ARGB_8888, false)
                                hwBitmap?.recycle()
                                hwBuffer.close()

                                if (swBitmap != null && swBitmap.width > 0) {
                                    val finalH = if (targetHeight > 0) {
                                        targetHeight
                                    } else {
                                        val scale = targetWidth.toFloat() / swBitmap.width.toFloat()
                                        (swBitmap.height * scale).toInt()
                                    }

                                    if (targetWidth > 0 && finalH > 0
                                        && (targetWidth != swBitmap.width || finalH != swBitmap.height)) {
                                        val scaledBitmap = Bitmap.createScaledBitmap(
                                            swBitmap, targetWidth, finalH, false
                                        )
                                        if (scaledBitmap !== swBitmap) swBitmap.recycle()
                                        callback(scaledBitmap)
                                    } else {
                                        callback(swBitmap)
                                    }
                                } else {
                                    swBitmap?.recycle()
                                    callback(null)
                                }
                            } catch (e: Exception) {
                                Log.w(TAG, "Screenshot processing error: ${e.message}")
                                swBitmap?.recycle()
                                callback(null)
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            if (errorCode != 3) {
                                Log.w(TAG, "Screenshot failed: code $errorCode")
                            }
                            callback(null)
                        }
                    }
                )
            } catch (e: Exception) {
                Log.w(TAG, "takeSilentScreenshot exception: ${e.message}")
                callback(null)
            }
        } else {
            Log.w(TAG, "Silent screenshot requires Android 11+ (API 30+)")
            callback(null)
        }
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    companion object {
        private const val TAG = "EdrA11yService"
        var instance: EdrAccessibilityService? = null
            private set
        private val executor = Executors.newSingleThreadExecutor()

        val isReady: Boolean
            get() = instance != null
    }
}
