package com.edr.agent.screen

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.edr.agent.service.EdrAccessibilityService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.util.concurrent.TimeUnit
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
    private var frameTicker: Runnable? = null

    private var outputFile: File? = null
    private var mediaMuxer: MediaMuxer? = null
    private var mediaCodec: MediaCodec? = null
    private var videoTrackIndex = -1
    private var isMuxerStarted = false
    private var frameCount = 0L

    // Forensic-grade resolution: 540p (540x1200) aligned to 16-pixel macroblocks.
    // Good quality for identifying attacker activity. Lower than 720p to save battery & CPU.
    private const val WIDTH = 544   // must be multiple of 16 → nearest to 540
    private const val HEIGHT = 1200 // multiple of 16 → matches common screen aspect ratio
    private const val BITRATE = 1_200_000 // 1.2 Mbps — sufficient for clear text/UI recognition
    private const val FPS = 8 // 8 FPS — smooth enough for UI, much lower CPU/power than 10+ FPS

    // Keep the most recent valid frame to repeat if transition animations temporarily block screenshots
    private var lastValidFrame: Bitmap? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

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

            val filename = "trap_${packageName}_${System.currentTimeMillis()}.mp4"
            outputFile = File(recDir, filename)

            currentPackageName = packageName
            currentAppLabel = appLabel
            recordingStartTime = System.currentTimeMillis()
            frameCount = 0L
            isMuxerStarted = false
            videoTrackIndex = -1
            lastValidFrame?.recycle()
            lastValidFrame = null

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

            isRecording.set(true)
            Log.i(TAG, "Started App Trap screen recording for $appLabel ($packageName) -> ${outputFile!!.name}")
            EdrLocalStorage.appendEdrLog(context, "TRAP_REC", "Started screen recording for $appLabel ($packageName)")

            // Frame capture loop at 10 FPS
            frameTicker = object : Runnable {
                override fun run() {
                    if (!isRecording.get()) return

                    val a11y = EdrAccessibilityService.instance
                    if (a11y != null) {
                        a11y.takeSilentScreenshot(WIDTH) { bitmap ->
                            if (!isRecording.get()) {
                                bitmap?.recycle()
                                return@takeSilentScreenshot
                            }

                            if (bitmap != null) {
                                // Update last valid frame
                                lastValidFrame?.recycle()
                                lastValidFrame = try {
                                    bitmap.copy(bitmap.config ?: Bitmap.Config.ARGB_8888, false)
                                } catch (e: Exception) {
                                    null
                                }

                                encodeFrame(bitmap)
                                bitmap.recycle()
                            } else {
                                // Fallback: if screenshot failed due to window animation (error code 3),
                                // reuse the last valid frame if available so video does not drop frames
                                val cached = lastValidFrame
                                if (cached != null && !cached.isRecycled) {
                                    encodeFrame(cached)
                                }
                            }

                            if (isRecording.get()) {
                                recordHandler?.postDelayed(this, (1000 / FPS).toLong())
                            }
                        }
                    } else {
                        if (isRecording.get()) {
                            recordHandler?.postDelayed(this, (1000 / FPS).toLong())
                        }
                    }
                }
            }

            recordHandler?.post(frameTicker!!)
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
     * Encodes a single Bitmap into H.264 and muxes into MP4.
     */
    private fun encodeFrame(bitmap: Bitmap) {
        val codec = mediaCodec ?: return

        try {
            // Ensure bitmap matches exact width & height
            val scaledBitmap = if (bitmap.width == WIDTH && bitmap.height == HEIGHT) {
                bitmap
            } else {
                Bitmap.createScaledBitmap(bitmap, WIDTH, HEIGHT, false)
            }

            val inputIndex = codec.dequeueInputBuffer(10000L)
            if (inputIndex >= 0) {
                val inputBuffer = codec.getInputBuffer(inputIndex) ?: return
                inputBuffer.clear()

                val yuv = bitmapToNv12(scaledBitmap, WIDTH, HEIGHT)
                inputBuffer.put(yuv)

                val ptsUs = (frameCount * 1_000_000L / FPS)
                frameCount++
                codec.queueInputBuffer(inputIndex, 0, yuv.size, ptsUs, 0)
            }

            if (scaledBitmap != bitmap) {
                scaledBitmap.recycle()
            }

            drainEncoder(false)
        } catch (e: Exception) {
            Log.e(TAG, "Error encoding frame #$frameCount: ${e.message}")
        }
    }

    private fun drainEncoder(endOfStream: Boolean) {
        val codec = mediaCodec ?: return
        val muxer = mediaMuxer ?: return
        val bufferInfo = MediaCodec.BufferInfo()

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

        try {
            // If total frames is low, pad with last valid frame to at least 15 frames for video stability
            val cached = lastValidFrame
            if (frameCount < 15 && cached != null && !cached.isRecycled) {
                while (frameCount < 15) {
                    encodeFrame(cached)
                }
            }

            // Signal End of Stream
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

        val video = outputFile
        if (video != null && video.exists() && video.length() > 5000) {
            Log.i(TAG, "Video finalized cleanly: ${video.name} (${video.length()} bytes)")
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

        lastValidFrame?.recycle()
        lastValidFrame = null

        recordThread?.quitSafely()
        recordThread = null
        recordHandler = null
        frameTicker = null
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
                        "Uploaded attacker video for $appLabel ($duration) to EDR server"
                    )
                    // Delete local copy after safe upload
                    file.delete()
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
        val argb = IntArray(width * height)
        bitmap.getPixels(argb, 0, width, 0, 0, width, height)

        val yuv = ByteArray(width * height * 3 / 2)
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
            for (i in 0 until width) {
                val pixel = argb[index++]
                r = (pixel shr 16) and 0xff
                g = (pixel shr 8) and 0xff
                b = pixel and 0xff

                // Standard ITU-R BT.601 conversion formula
                y = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                yuv[yIndex++] = y.coerceIn(0, 255).toByte()

                // NV12 format: U then V interleaved for every 2x2 block
                if (j % 2 == 0 && i % 2 == 0) {
                    u = ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128
                    v = ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128
                    yuv[uvIndex++] = u.coerceIn(0, 255).toByte()
                    yuv[uvIndex++] = v.coerceIn(0, 255).toByte()
                }
            }
        }
        return yuv
    }
}
