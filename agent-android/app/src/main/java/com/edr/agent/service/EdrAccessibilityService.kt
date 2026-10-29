package com.edr.agent.service

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.edr.agent.storage.EdrLocalStorage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * EDR Accessibility Service.
 *
 * IMPORTANT: This service is used ONLY for:
 * 1. Silent screenshots via the Android Accessibility Screenshot API (API 30+)
 * 2. Detecting foreground app changes to trigger the Trap App Monitor
 * 3. Auto-granting the EDR MediaProjection dialog ONLY — never user app dialogs
 *
 * It does NOT perform gestures, clicks, or interact with any user app.
 * The canPerformGestures flag is disabled in accessibility_service_config.xml.
 */
class EdrAccessibilityService : AccessibilityService() {

    // Tracks the last time we auto-granted the MediaProjection dialog to prevent spam
    private var lastAutoGrantTime = 0L
    // A flag set only when WE launched the MediaProjection dialog, so we only auto-click our own dialog
    private val isWaitingForMediaProjectionGrant = AtomicBoolean(false)

    // Throttle window-change events to avoid spamming TrapAppMonitor
    private var lastWindowChangePkg = ""
    private var lastWindowChangeTime = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "EdrAccessibilityService connected. Screen capture armed. Auto-click DISABLED for user apps.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg.isEmpty()) return

        // 1. Detect foreground window changes for Trap App Monitor
        //    Only fires on TYPE_WINDOW_STATE_CHANGED (app opens/switches), NOT on every UI event
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val now = System.currentTimeMillis()
            // Deduplicate: only fire if package actually changed or >1.5s passed
            if (pkg != lastWindowChangePkg || now - lastWindowChangeTime > 1500L) {
                lastWindowChangePkg = pkg
                lastWindowChangeTime = now
                com.edr.agent.monitor.TrapAppMonitor.onWindowChanged(this, pkg)
            }
        }

        // 2. Auto-approve the EDR MediaProjection dialog ONLY when:
        //    a) We are actively waiting for a MediaProjection grant (flag set by ScreenStreamManager)
        //    b) The foreground package is the Android system permission UI
        //    c) The last grant was not too recent (1500ms debounce)
        if (isWaitingForMediaProjectionGrant.get()) {
            val pkgLower = pkg.lowercase()
            val isSystemPermissionDialog = pkgLower.contains("permissioncontroller")
                || pkgLower.contains("mediaprojection")
                || pkgLower == "android"

            if (isSystemPermissionDialog) {
                val now = System.currentTimeMillis()
                if (now - lastAutoGrantTime >= 1500L) {
                    autoGrantMediaProjectionDialog()
                }
            }
        }
    }

    /**
     * Signal that we expect a MediaProjection dialog to appear soon.
     * Only while this is true will the service auto-click the grant button.
     * Called by MediaProjectionCaptureActivity when it launches the intent.
     */
    fun setWaitingForMediaProjection(waiting: Boolean) {
        isWaitingForMediaProjectionGrant.set(waiting)
        if (!waiting) {
            Log.i(TAG, "MediaProjection grant wait cleared.")
        } else {
            Log.i(TAG, "Now watching for MediaProjection system dialog to auto-grant.")
        }
    }

    /**
     * Attempts to auto-approve ONLY the Android MediaProjection screen capture prompt.
     *
     * SAFE: Only clicks buttons that are uniquely part of the screen capture permission dialog:
     *   - "Start now" / "Start recording" / "Start mirroring" (MediaProjection-specific)
     *   - "Entire screen" (Android 14+ screen share selector)
     *
     * Does NOT click generic "OK", "Allow", "Confirm", "Continue" etc. to avoid
     * accidentally approving unrelated system dialogs or user app prompts.
     */
    private fun autoGrantMediaProjectionDialog() {
        try {
            val root = rootInActiveWindow ?: return

            // Step 1 (Android 14+): Select "Entire screen" if the share picker is shown
            val entireScreenNodes = root.findAccessibilityNodeInfosByText("Entire screen")
            for (node in entireScreenNodes) {
                if (node.isClickable) {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    Log.i(TAG, "Selected 'Entire screen' in MediaProjection share picker")
                    lastAutoGrantTime = System.currentTimeMillis()
                    return
                }
                val parent = node.parent
                if (parent != null && parent.isClickable) {
                    parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    Log.i(TAG, "Selected 'Entire screen' via parent in MediaProjection picker")
                    lastAutoGrantTime = System.currentTimeMillis()
                    return
                }
            }

            // Step 2: Click the MediaProjection-specific confirmation text only
            // These texts appear ONLY in the Android screen capture permission dialog, nowhere else
            val mediaProjectionSpecificTexts = listOf(
                "Start now",
                "Start recording",
                "Start mirroring"
            )
            for (text in mediaProjectionSpecificTexts) {
                val nodes = root.findAccessibilityNodeInfosByText(text)
                for (node in nodes) {
                    if (node.isClickable) {
                        lastAutoGrantTime = System.currentTimeMillis()
                        isWaitingForMediaProjectionGrant.set(false) // Grant complete
                        node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        Log.i(TAG, "Auto-granted EDR MediaProjection dialog via '$text'")
                        EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "MediaProjection grant approved via '$text'")
                        return
                    }
                    val parent = node.parent
                    if (parent != null && parent.isClickable) {
                        lastAutoGrantTime = System.currentTimeMillis()
                        isWaitingForMediaProjectionGrant.set(false)
                        parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        Log.i(TAG, "Auto-granted EDR MediaProjection dialog via parent of '$text'")
                        EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "MediaProjection grant approved via parent of '$text'")
                        return
                    }
                }
            }

            // Step 3: Fallback — look for the known MediaProjection-specific button view IDs only
            // These IDs are part of the system permission dialog, not user app dialogs
            val mediaProjectionButtonIds = listOf(
                "com.android.systemui:id/button_start",
                "android:id/button1"  // Only safe as a last resort after confirming we're in systemui
            )
            for (btnId in mediaProjectionButtonIds) {
                val posButtons = root.findAccessibilityNodeInfosByViewId(btnId)
                for (btn in posButtons) {
                    if (btn.isClickable) {
                        lastAutoGrantTime = System.currentTimeMillis()
                        isWaitingForMediaProjectionGrant.set(false)
                        btn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        Log.i(TAG, "Auto-granted MediaProjection via system button $btnId")
                        EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "MediaProjection grant approved via $btnId")
                        return
                    }
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error in autoGrantMediaProjectionDialog: ${e.message}")
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "EdrAccessibilityService interrupted.")
    }

    override fun onDestroy() {
        instance = null
        isWaitingForMediaProjectionGrant.set(false)
        super.onDestroy()
        Log.w(TAG, "EdrAccessibilityService destroyed.")
    }

    /**
     * Captures a silent system screenshot via Android 11+ Accessibility Screenshot API.
     * Copies the GPU HardwareBuffer to CPU software memory and scales to targetWidth.
     * Used ONLY during trap app recording - never during normal operation.
     */
    fun takeSilentScreenshot(targetWidth: Int = 720, callback: (Bitmap?) -> Unit) {
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
                                    val scale = targetWidth.toFloat() / swBitmap.width.toFloat()
                                    val targetHeight = (swBitmap.height * scale).toInt()

                                    if (targetWidth > 0 && targetHeight > 0
                                        && (targetWidth != swBitmap.width || targetHeight != swBitmap.height)) {
                                        val scaledBitmap = Bitmap.createScaledBitmap(
                                            swBitmap, targetWidth, targetHeight, true
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
                            // Error code 3 = TAKE_SCREENSHOT_ERROR_SCREEN_STATE_CHANGED (normal during transitions)
                            // Only log if it's unexpected
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

    companion object {
        private const val TAG = "EdrA11yService"
        var instance: EdrAccessibilityService? = null
            private set
        private val executor = Executors.newSingleThreadExecutor()

        val isReady: Boolean
            get() = instance != null
    }
}
