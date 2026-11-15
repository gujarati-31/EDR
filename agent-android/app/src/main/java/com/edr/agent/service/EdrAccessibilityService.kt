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
        EdrForegroundService.instance?.updateTrapFallbackSchedule()
        Log.i(TAG, "EdrAccessibilityService connected. Passive, zero-interference window monitoring active.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg.isEmpty()) return

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
        super.onDestroy()
        Log.w(TAG, "EdrAccessibilityService destroyed.")
    }

    /**
     * Captures a silent system screenshot via Android 11+ Accessibility Screenshot API.
     * Zero popups, zero user interruption.
     */
    fun takeSilentScreenshot(
        targetWidth: Int = 720,
        targetHeight: Int = 0,
        callback: (Bitmap?) -> Unit
    ) {
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
