package com.edr.agent.screen

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.util.Log
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.service.EdrAccessibilityService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Autonomous App Trap Screen Recorder.
 * Records screen frames silently while a trapped target app is in foreground,
 * encodes into standard H.264 MP4 video, and uploads to the central EDR server when closed.
 */
object AppTrapScreenRecorder {
    private const val TAG = "AppTrapRecorder"

    private val isRecording = AtomicBoolean(false)
    private var currentPackageName: String? = null
    private var currentAppLabel: String? = null
    private var recordingStartTime = 0L

    private var recordThread: HandlerThread? = null
    private var recordHandler: Handler? = null
    private var captureThread: HandlerThread? = null
    private var captureHandler: Handler? = null
    private var frameTicker: Runnable? = null
    private var screenshotTicker: Runnable? = null

    private var outputFile: File? = null
    private var mediaMuxer: MediaMuxer? = null
    private var mediaCodec: MediaCodec? = null
    private var videoTrackIndex = -1
    private var isMuxerStarted = false
    private var frameCount = 0L

    // Smooth 16 FPS resolution: 368x800 aligned to 16-pixel macroblocks.
    // Matches the OS silent capture throughput (~16 unique FPS) so every encoded frame is fresh with zero stutter.
    private const val WIDTH = 368   // must be multiple of 16 (23 * 16)
    private const val HEIGHT = 800  // must be multiple of 16 (50 * 16)
    private const val BITRATE = 1_500_000 // 1.5 Mbps — crisp video
    private const val FPS = 16 // 16 FPS (62.5ms/frame) — smooth 1:1 playback matching capture rate

    // Decoupled CFR frame buffer: capture thread updates latestYuv; encoder thread emits at exact 12 FPS
    private val isTakingScreenshot = AtomicBoolean(false)
    private val latestYuvLock = Any()
    private var latestYuv: ByteArray? = null
    private var tempYuv: ByteArray? = null
    private var reusableArgb: IntArray? = null
    private var reusableYuv: ByteArray? = null
    private var reusableBufferInfo: MediaCodec.BufferInfo? = null
    private val encoderLock = Any()

    private val httpClient = EdrHttpClient.uploadClient

    fun isCurrentlyRecording(): Boolean = isRecording.get()

    fun getRecordingPackage(): String? = currentPackageName

    /**
     * Starts recording screen silently because a trapped application opened.
     */
    @Synchronized
    fun startRecording(context: Context, packageName: String, appLabel: String) {
        if (isRecording.get()) {
            Log.w(TAG, "Recording already active for $currentPackageName")
            return
        }

        try {
            val edrDir = EdrLocalStorage.getEdrDir(context)
            val recDir = File(edrDir, "trap_recordings")
            if (!recDir.exists()) recDir.mkdirs()

            val now = Date()
            val dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(now)
            val timeStr = SimpleDateFormat("HH-mm-ss", Locale.US).format(now)
            val safeAppName = appLabel.replace(Regex("[^a-zA-Z0-9._-]"), "_").trim('_').ifEmpty { packageName }
            val filename = "trap_${safeAppName}__${dateStr}__${timeStr}.mp4"
            outputFile = File(recDir, filename)

            currentPackageName = packageName
            currentAppLabel = appLabel
            recordingStartTime = System.currentTimeMillis()
            frameCount = 0L
            isMuxerStarted = false
            videoTrackIndex = -1
            isTakingScreenshot.set(false)

            // Setup MediaCodec H.264 video encoder
            val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            val chosenColor = chooseColorFormat(encoder)

            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, WIDTH, HEIGHT).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, chosenColor)
                setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
                setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1) // Keyframe every 1s
            }

            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            mediaCodec = encoder

            mediaMuxer = MediaMuxer(outputFile!!.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            recordThread = HandlerThread("EDR_TrapRecorderThread").apply { start() }
            recordHandler = Handler(recordThread!!.looper)
            captureThread = HandlerThread("EDR_TrapCaptureThread").apply { start() }
            captureHandler = Handler(captureThread!!.looper)

            val yuvSize = WIDTH * HEIGHT * 3 / 2
            reusableArgb = IntArray(WIDTH * HEIGHT)
            reusableYuv = ByteArray(yuvSize)
            latestYuv = ByteArray(yuvSize)
            tempYuv = ByteArray(yuvSize)
            reusableBufferInfo = MediaCodec.BufferInfo()

            isRecording.set(true)
            Log.i(TAG, "Started App Trap screen recording for $appLabel ($packageName) -> ${outputFile!!.name}")
            EdrLocalStorage.appendEdrLog(context, "TRAP_REC", "Started screen recording for $appLabel ($packageName)")

            // Seed initial dark frame into latestYuv and encode frame #0 immediately
            try {
                val initialBitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(initialBitmap)
                canvas.drawColor(android.graphics.Color.rgb(15, 23, 42))
                val seedYuv = bitmapToNv12(initialBitmap, WIDTH, HEIGHT)
                synchronized(latestYuvLock) {
                    System.arraycopy(seedYuv, 0, latestYuv!!, 0, yuvSize)
                }
                initialBitmap.recycle()
                encodeYuvFrame(seedYuv)
            } catch (e: Exception) {
                Log.w(TAG, "Could not seed initial frame: ${e.message}")
            }

            val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager

            // Loop A: Independent silent screenshot grabber on captureThread.
            // Chains next capture 35ms after completion to maximize smoothness without overlapping.
            screenshotTicker = object : Runnable {
                override fun run() {
                    if (!isRecording.get()) return
                    if (powerManager?.isInteractive == false) {
                        captureHandler?.postDelayed(this, 800L)
                        return
                    }

                    val a11y = EdrAccessibilityService.instance
                    if (a11y != null && isTakingScreenshot.compareAndSet(false, true)) {
                        a11y.takeSilentScreenshot(WIDTH, HEIGHT) { bitmap ->
                            try {
                                if (isRecording.get() && bitmap != null) {
                                    val scaled = if (bitmap.width == WIDTH && bitmap.height == HEIGHT) {
                                        bitmap
                                    } else {
                                        Bitmap.createScaledBitmap(bitmap, WIDTH, HEIGHT, false)
                                    }
                                    val converted = bitmapToNv12(scaled, WIDTH, HEIGHT)
                                    if (scaled !== bitmap) scaled.recycle()
                                    bitmap.recycle()
                                    synchronized(latestYuvLock) {
                                        latestYuv?.let { dest ->
                                            System.arraycopy(converted, 0, dest, 0, dest.size)
                                        }
                                    }
                                } else {
                                    bitmap?.recycle()
                                }
                            } catch (e: Exception) {
                                Log.w(TAG, "Screenshot conversion error: ${e.message}")
                                try { bitmap?.recycle() } catch (_: Exception) {}
                            } finally {
                                isTakingScreenshot.set(false)
                                if (isRecording.get()) {
                                    captureHandler?.post(screenshotTicker!!)
                                }
                            }
                        }
                    } else if (isRecording.get()) {
                        captureHandler?.postDelayed(this, 30L)
                    }
                }
            }

            // Loop B: Exact Constant Frame Rate (CFR = 12 FPS) encoder loop.
            // Emits 1 frame every 83ms aligned to real wall-clock time so 10s real = 10.0s MP4!
            frameTicker = object : Runnable {
                override fun run() {
                    if (!isRecording.get()) return

                    synchronized(encoderLock) {
                        if (!isRecording.get()) return@synchronized
                        val bufToEncode = tempYuv
                        val src = latestYuv
                        if (bufToEncode != null && src != null) {
                            synchronized(latestYuvLock) {
                                System.arraycopy(src, 0, bufToEncode, 0, bufToEncode.size)
                            }
                            encodeYuvFrame(bufToEncode)
                        }
                    }

                    if (isRecording.get()) {
                        val nextTargetMs = recordingStartTime + (frameCount * 1000L / FPS)
                        val delay = (nextTargetMs - System.currentTimeMillis()).coerceIn(1L, (1000L / FPS))
                        recordHandler?.postDelayed(this, delay)
                    }
                }
            }

            captureHandler?.post(screenshotTicker!!)
            recordHandler?.postDelayed(frameTicker!!, (1000L / FPS))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start screen recorder: ${e.message}", e)
            EdrLocalStorage.appendEdrLog(context, "TRAP_ERR", "Failed starting trap recorder: ${e.message}")
            cleanup()
        }
    }

    /**
     * Determines the optimal color format supported by the device's hardware H.264 encoder.
     */
    private fun chooseColorFormat(codec: MediaCodec): Int {
        try {
            val caps = codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
            for (color in caps.colorFormats) {
                if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar) {
                    return color
                }
            }
            for (color in caps.colorFormats) {
                if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible) {
                    return color
                }
            }
            return caps.colorFormats.firstOrNull() ?: MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar
        } catch (e: Exception) {
            return MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar
        }
    }

    /**
     * Encodes a single NV12/YUV420 frame into H.264 at a strict constant frame rate (CFR)
     * and muxes it into MP4. Every frame is spaced by exact 1_000_000L / FPS microseconds
     * so playback duration matches real-time 1:1.
     */
    private fun encodeYuvFrame(yuv: ByteArray) {
        val codec = mediaCodec ?: return

        try {
            val inputIndex = codec.dequeueInputBuffer(10000L)
            if (inputIndex >= 0) {
                val inputBuffer = codec.getInputBuffer(inputIndex) ?: return
                inputBuffer.clear()
                inputBuffer.put(yuv)

                val ptsUs = frameCount * 1_000_000L / FPS
                frameCount++
                codec.queueInputBuffer(inputIndex, 0, yuv.size, ptsUs, 0)
            }

            drainEncoder(false)
        } catch (e: Exception) {
            Log.e(TAG, "Error encoding frame #$frameCount: ${e.message}")
        }
    }

    private fun drainEncoder(endOfStream: Boolean) {
        val codec = mediaCodec ?: return
        val muxer = mediaMuxer ?: return
        val bufferInfo = reusableBufferInfo ?: MediaCodec.BufferInfo().also { reusableBufferInfo = it }

        var retryCount = 0
        while (true) {
            val outputIndex = codec.dequeueOutputBuffer(bufferInfo, 10000L)
            if (outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) break
                retryCount++
                if (retryCount > 10) break
            } else if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (isMuxerStarted) {
                    Log.w(TAG, "Format changed after muxer started")
                    continue
                }
                val newFormat = codec.outputFormat
                videoTrackIndex = muxer.addTrack(newFormat)
                muxer.start()
                isMuxerStarted = true
                Log.i(TAG, "MediaMuxer started with track: $videoTrackIndex")
            } else if (outputIndex >= 0) {
                val outputBuffer = codec.getOutputBuffer(outputIndex)
                if (outputBuffer != null && bufferInfo.size > 0 && isMuxerStarted) {
                    outputBuffer.position(bufferInfo.offset)
                    outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                    muxer.writeSampleData(videoTrackIndex, outputBuffer, bufferInfo)
                }
                codec.releaseOutputBuffer(outputIndex, false)
                if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                    break
                }
            }
        }
    }

    /**
     * Stops the active recording, finalizes the MP4 file, and asynchronously uploads it to EDR backend.
     */
    @Synchronized
    fun stopRecording(context: Context) {
        if (!isRecording.getAndSet(false)) return

        val pkg = currentPackageName ?: "unknown"
        val label = currentAppLabel ?: pkg
        val durationMs = System.currentTimeMillis() - recordingStartTime
        val durationSec = (durationMs / 1000).toInt()
        val durationFormatted = String.format("%02d:%02d", durationSec / 60, durationSec % 60)

        Log.i(TAG, "Stopping screen recording for $label ($pkg). Total duration: $durationFormatted")
        EdrLocalStorage.appendEdrLog(context, "TRAP_REC", "App closed. Finalizing video for $label ($durationFormatted)")

        synchronized(encoderLock) {
            try {
                // Signal End of Stream at exact CFR PTS
                val inputIndex = mediaCodec?.dequeueInputBuffer(10000L) ?: -1
                if (inputIndex >= 0) {
                    val ptsUs = frameCount * 1_000_000L / FPS
                    mediaCodec?.queueInputBuffer(inputIndex, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                }
                drainEncoder(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error draining encoder on stop: ${e.message}")
            }

            cleanup()
        }

        val video = outputFile
        if (video != null && video.exists() && video.length() > 1000) {
            Log.i(TAG, "Video finalized cleanly: ${video.name} (${video.length()} bytes)")
            // Register video with Android MediaScanner so user sees it in Gallery & /EDR folder
            try {
                android.media.MediaScannerConnection.scanFile(
                    context,
                    arrayOf(video.absolutePath),
                    arrayOf("video/mp4"),
                    null
                )
            } catch (ignored: Exception) {}

            // Asynchronously upload video to EDR Server
            uploadTrapRecording(context, video, pkg, label, durationFormatted)
        } else {
            Log.w(TAG, "Video file too small or missing (${video?.length()} bytes). Discarding.")
            video?.delete()
        }
    }

    private fun cleanup() {
        try {
            mediaCodec?.stop()
            mediaCodec?.release()
        } catch (ignored: Exception) {}
        mediaCodec = null

        try {
            if (isMuxerStarted) {
                mediaMuxer?.stop()
            }
            mediaMuxer?.release()
        } catch (ignored: Exception) {}
        mediaMuxer = null

        synchronized(latestYuvLock) {
            latestYuv = null
        }
        tempYuv = null
        isTakingScreenshot.set(false)
        reusableArgb = null
        reusableYuv = null
        reusableBufferInfo = null

        recordThread?.quitSafely()
        recordThread = null
        recordHandler = null
        captureThread?.quitSafely()
        captureThread = null
        captureHandler = null
        frameTicker = null
        screenshotTicker = null
        currentPackageName = null
        currentAppLabel = null
    }

    /**
     * Uploads the recorded video evidence to /api/devices/{deviceId}/recordings
     */
    private fun uploadTrapRecording(
        context: Context,
        file: File,
        packageName: String,
        appLabel: String,
        duration: String
    ) {
        Thread {
            try {
                Log.i(TAG, "Uploading trap video evidence (${file.length()} bytes) to EDR Server...")
                val deviceId = SyncPreferences.deviceId
                val url = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/recordings"

                val body = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("duration", duration)
                    .addFormDataPart("recordingType", "APP_TRAP")
                    .addFormDataPart("appName", appLabel)
                    .addFormDataPart("packageName", packageName)
                    .addFormDataPart(
                        "video",
                        file.name,
                        file.asRequestBody("video/mp4".toMediaType())
                    )
                    .build()

                val request = Request.Builder()
                    .url(url)
                    .post(body)
                    .build()

                val response = httpClient.newCall(request).execute()
                val ok = response.isSuccessful
                val code = response.code
                response.close()

                if (ok) {
                    Log.i(TAG, "Trap video evidence uploaded successfully! (${file.name})")
                    EdrLocalStorage.appendEdrLog(
                        context,
                        "EVIDENCE",
                        "Uploaded attacker video for $appLabel ($duration) to EDR server. Saved local copy at ${file.absolutePath}"
                    )
                    // Keep file preserved in /EDR/trap_recordings folder so phone user can view it anytime
                } else {
                    Log.e(TAG, "Server rejected trap video upload: HTTP $code")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed uploading trap video: ${e.message}", e)
            }
        }.start()
    }

    /**
     * Converts an ARGB_8888 Bitmap into NV12 (YUV420 Semi-Planar) byte array for H.264 hardware encoding.
     * NV12 has Y plane followed by interleaved U and V components (U first, V second).
     */
    private fun bitmapToNv12(bitmap: Bitmap, width: Int, height: Int): ByteArray {
        val neededPixels = width * height
        val argb = reusableArgb?.takeIf { it.size == neededPixels }
            ?: IntArray(neededPixels).also { reusableArgb = it }
        bitmap.getPixels(argb, 0, width, 0, 0, width, height)

        val neededYuv = neededPixels * 3 / 2
        val yuv = reusableYuv?.takeIf { it.size == neededYuv }
            ?: ByteArray(neededYuv).also { reusableYuv = it }
        val frameSize = width * height
        var yIndex = 0
        var uvIndex = frameSize

        var r: Int
        var g: Int
        var b: Int
        var y: Int
        var u: Int
        var v: Int
        var index = 0

        for (j in 0 until height) {
            val evenRow = (j and 1) == 0
            for (i in 0 until width) {
                val pixel = argb[index++]
                r = (pixel shr 16) and 0xff
                g = (pixel shr 8) and 0xff
                b = pixel and 0xff

                // Standard ITU-R BT.601 conversion formula
                y = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                yuv[yIndex++] = (if (y < 0) 0 else if (y > 255) 255 else y).toByte()

                // NV12 format: U then V interleaved for every 2x2 block
                if (evenRow && (i and 1) == 0) {
                    u = ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128
                    v = ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128
                    yuv[uvIndex++] = (if (u < 0) 0 else if (u > 255) 255 else u).toByte()
                    yuv[uvIndex++] = (if (v < 0) 0 else if (v > 255) 255 else v).toByte()
                }
            }
        }
        return yuv
    }
}
