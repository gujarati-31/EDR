package com.edr.agent.telemetry

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Autonomous Call Audio Recorder for Phone EDR.
 *
 * Automatically records phone calls on all network connections (4G, 5G, Wi-Fi, hotspot)
 * when a call is connected (OFFHOOK) and stops when the call ends (IDLE).
 *
 * Also scans OEM call recording directories (MIUI/HyperOS, OriginOS/Funtouch, Samsung, Oppo)
 * to link existing native dialer recordings.
 */
object CallAudioRecorder {
    private const val TAG = "CallAudioRecorder"

    private var isInitialized = false
    private var isRecording = false
    private var audioRecorder: MediaRecorder? = null
    private var currentRecordingFile: File? = null
    private var currentCallNumber: String = "unknown"
    private var currentCallStartTime: Long = 0L

    // Map of callTimestamp -> recorded File
    private val callRecordingMap = ConcurrentHashMap<Long, File>()

    private val mainHandler = Handler(Looper.getMainLooper())

    @Synchronized
    fun init(context: Context) {
        if (isInitialized) return
        isInitialized = true

        val appContext = context.applicationContext

        // 1. Register TelephonyManager listener
        try {
            val tm = appContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            if (tm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val executor = ContextCompat.getMainExecutor(appContext)
                    tm.registerTelephonyCallback(executor, object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                        override fun onCallStateChanged(state: Int) {
                            handleCallState(appContext, state, null)
                        }
                    })
                } else {
                    @Suppress("DEPRECATION")
                    tm.listen(object : PhoneStateListener() {
                        @Deprecated("Deprecated in Java")
                        override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                            handleCallState(appContext, state, phoneNumber)
                        }
                    }, PhoneStateListener.LISTEN_CALL_STATE)
                }
                Log.i(TAG, "TelephonyManager call state listener registered.")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not register TelephonyManager listener: ${e.message}")
        }

        // 2. Register BroadcastReceiver for PHONE_STATE as backup
        try {
            val filter = IntentFilter().apply {
                addAction(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
                @Suppress("DEPRECATION")
                addAction(Intent.ACTION_NEW_OUTGOING_CALL)
            }
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent?) {
                    val action = intent?.action ?: return
                    @Suppress("DEPRECATION")
                    if (action == Intent.ACTION_NEW_OUTGOING_CALL) {
                        val outNum = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER)
                        if (!outNum.isNullOrBlank()) {
                            currentCallNumber = outNum
                        }
                    } else if (action == TelephonyManager.ACTION_PHONE_STATE_CHANGED) {
                        val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
                        val inNum = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                        val state = when (stateStr) {
                            TelephonyManager.EXTRA_STATE_RINGING -> TelephonyManager.CALL_STATE_RINGING
                            TelephonyManager.EXTRA_STATE_OFFHOOK -> TelephonyManager.CALL_STATE_OFFHOOK
                            else -> TelephonyManager.CALL_STATE_IDLE
                        }
                        handleCallState(ctx, state, inNum)
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                appContext.registerReceiver(receiver, filter)
            }
            Log.i(TAG, "Call state BroadcastReceiver registered.")
        } catch (e: Exception) {
            Log.w(TAG, "Could not register call state receiver: ${e.message}")
        }
    }

    private fun handleCallState(context: Context, state: Int, phoneNumber: String?) {
        if (!phoneNumber.isNullOrBlank()) {
            currentCallNumber = phoneNumber
        }

        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                Log.d(TAG, "Phone ringing: ${phoneNumber ?: currentCallNumber}")
            }

            TelephonyManager.CALL_STATE_OFFHOOK -> {
                // Call answered or outgoing call connected
                Log.i(TAG, "Call OFFHOOK (connected): $currentCallNumber. Starting call recording...")
                startCallRecording(context)
            }

            TelephonyManager.CALL_STATE_IDLE -> {
                // Call ended / hung up
                if (isRecording) {
                    Log.i(TAG, "Call IDLE (ended): $currentCallNumber. Finalizing call recording...")
                    stopCallRecording(context)
                }
            }
        }
    }

    @Synchronized
    private fun startCallRecording(context: Context) {
        if (isRecording) return

        if (SyncPreferences.isAgentPaused) {
            Log.i(TAG, "Agent protection is paused by administrator. Refusing to record call.")
            return
        }

        val hasMic = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasMic) {
            Log.w(TAG, "Cannot record call: RECORD_AUDIO permission missing.")
            return
        }

        try {
            val callDir = EdrLocalStorage.getCallRecordingsDir(context)
            val now = System.currentTimeMillis()
            currentCallStartTime = now

            val safeNum = currentCallNumber.replace(Regex("[^0-9+]"), "").ifEmpty { "call" }
            val file = File(callDir, "call_${safeNum}_${now}.m4a")

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            // Try VOICE_COMMUNICATION first, fallback to MIC
            try {
                recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            } catch (_: Exception) {
                recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            }

            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioEncodingBitRate(64000)
            recorder.setAudioSamplingRate(44100)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            recorder.start()

            audioRecorder = recorder
            currentRecordingFile = file
            isRecording = true
            Log.i(TAG, "Active Call Recording started -> ${file.name}")
            EdrLocalStorage.appendEdrLog(context, "CALL_REC", "Call audio recording active for $safeNum")
        } catch (e: Exception) {
            Log.e(TAG, "Failed starting call audio recorder: ${e.message}", e)
            try { audioRecorder?.release() } catch (_: Exception) {}
            audioRecorder = null
            currentRecordingFile = null
            isRecording = false
        }
    }

    @Synchronized
    private fun stopCallRecording(context: Context) {
        if (!isRecording) return
        isRecording = false

        val recorder = audioRecorder
        audioRecorder = null

        try {
            recorder?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "Call recorder stop warning: ${e.message}")
        }
        try {
            recorder?.release()
        } catch (_: Exception) {}

        val file = currentRecordingFile
        val startTime = currentCallStartTime
        currentRecordingFile = null

        if (file != null && file.exists() && file.length() > 500) {
            Log.i(TAG, "Call recording saved cleanly: ${file.name} (${file.length()} bytes)")
            callRecordingMap[startTime] = file
            EdrLocalStorage.appendEdrLog(context, "CALL_REC", "Call recording saved: ${file.name}")
        } else {
            Log.w(TAG, "Call recording too small or empty. Discarding.")
            file?.delete()
        }

        // Trigger CallLog sync shortly after call ends so system CallLog.Calls is populated
        mainHandler.postDelayed({
            CallLogHarvester.harvestAndUpload(context)
        }, 2500L)
    }

    /**
     * Resolves the matching call recording file for a harvested call record.
     * Looks in:
     * 1. Our active recording map & /sdcard/EDR/call_recordings/
     * 2. OEM phone dialer recording directories (MIUI, Vivo, Samsung, Oppo)
     */
    fun findRecordingForCall(context: Context, phoneNumber: String, callTimestamp: Long): File? {
        // 1. Direct match in memory map (within ±180s)
        for ((startMs, file) in callRecordingMap) {
            if (Math.abs(startMs - callTimestamp) < 180_000L && file.exists() && file.length() > 500) {
                return file
            }
        }

        // 2. Scan /sdcard/EDR/call_recordings/
        try {
            val edrDir = EdrLocalStorage.getCallRecordingsDir(context)
            val edrFiles = edrDir.listFiles { _, name -> name.endsWith(".m4a") || name.endsWith(".mp4") }
            if (edrFiles != null) {
                for (f in edrFiles) {
                    if (Math.abs(f.lastModified() - callTimestamp) < 180_000L && f.length() > 500) {
                        return f
                    }
                }
            }
        } catch (_: Exception) {}

        // 3. Scan known OEM call recording folders
        val candidateOemDirs = listOf(
            File("/sdcard/MIUI/sound_recorder/call_rec"),          // Xiaomi / Redmi / HyperOS
            File("/sdcard/Record/Call"),                          // Vivo / Funtouch / OriginOS
            File("/sdcard/Recordings/Call"),                      // Samsung / Realme / Oppo
            File("/sdcard/Music/Recordings/Call"),
            File("/sdcard/Recordings")
        )

        val cleanNumber = phoneNumber.replace(Regex("[^0-9]"), "")

        for (dir in candidateOemDirs) {
            if (!dir.exists() || !dir.isDirectory) continue
            try {
                val files = dir.listFiles { _, name ->
                    name.endsWith(".m4a") || name.endsWith(".mp3") || name.endsWith(".aac") || name.endsWith(".wav") || name.endsWith(".amr")
                } ?: continue

                for (f in files) {
                    val timeDiff = Math.abs(f.lastModified() - callTimestamp)
                    val matchesNumber = cleanNumber.isNotEmpty() && cleanNumber.length >= 6 && f.name.contains(cleanNumber)
                    // Match if time difference is within 5 minutes, or within 15 minutes when number is in filename
                    val isNearTime = timeDiff < 300_000L
                    val isNearTimeWithNumber = matchesNumber && timeDiff < 900_000L

                    if (isNearTime || isNearTimeWithNumber) {
                        if (f.length() > 1000) {
                            Log.i(TAG, "Found OEM call recording match in ${dir.path} -> ${f.name} (diff: ${timeDiff / 1000}s)")
                            return f
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error scanning OEM dir ${dir.path}: ${e.message}")
            }
        }

        return null
    }
}
