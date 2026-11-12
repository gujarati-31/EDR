package com.edr.agent.screen

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

/**
 * Live Audio Streaming Manager for Phone EDR.
 * Captures 16 kHz, 16-bit mono PCM microphone audio via AudioRecord and streams
 * low-latency chunks over the active WebSocket connection to the Admin Dashboard.
 */
object AudioStreamManager {
    private const val TAG = "AudioStreamManager"
    private const val SAMPLE_RATE = 16000
    private const val CHANNELS = 1
    private const val CHUNK_BYTES = 3200 // 100ms of 16kHz 16-bit mono PCM (1600 samples * 2 bytes)

    private val isStreaming = AtomicBoolean(false)
    private var captureThread: Thread? = null
    private var audioRecord: AudioRecord? = null
    private var seq = 0L

    var wsSender: ((String) -> Boolean)? = null
    private val gson = Gson()

    fun isStreamingActive(): Boolean = isStreaming.get()

    @Synchronized
    fun startStreaming(context: Context): Pair<String, String> {
        if (isStreaming.get()) {
            return Pair("EXECUTED", "Live audio stream is already active")
        }

        val hasMicPerm = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasMicPerm) {
            val err = "Microphone permission (RECORD_AUDIO) is not granted on this phone"
            sendStatus(false, err)
            return Pair("FAILED", err)
        }

        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuf == AudioRecord.ERROR || minBuf == AudioRecord.ERROR_BAD_VALUE) {
            val err = "Device microphone AudioRecord unavailable"
            sendStatus(false, err)
            return Pair("FAILED", err)
        }

        val bufferSize = maxOf(minBuf * 2, CHUNK_BYTES * 2)
        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
        } catch (e: SecurityException) {
            val err = "Microphone permission denied: ${e.message}"
            sendStatus(false, err)
            return Pair("FAILED", err)
        } catch (e: Exception) {
            val err = "Failed initializing AudioRecord: ${e.message}"
            sendStatus(false, err)
            return Pair("FAILED", err)
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            val err = "AudioRecord failed to initialize"
            sendStatus(false, err)
            return Pair("FAILED", err)
        }

        audioRecord = recorder
        seq = 0L
        isStreaming.set(true)
        recorder.startRecording()
        sendStatus(true, null)
        EdrLocalStorage.appendEdrLog(context, "AUDIO_STREAM", "Live audio stream started (16kHz PCM)")

        val thread = Thread({
            val buf = ByteArray(CHUNK_BYTES)
            while (isStreaming.get()) {
                val rec = audioRecord ?: break
                val read = try {
                    rec.read(buf, 0, buf.size)
                } catch (e: Exception) {
                    Log.w(TAG, "AudioRecord read error: ${e.message}")
                    break
                }

                if (read > 0) {
                    val actual = if (read == buf.size) buf else buf.copyOf(read)
                    val level = computeRmsLevel(actual, read)
                    val b64 = Base64.encodeToString(actual, Base64.NO_WRAP)
                    val payload = mapOf(
                        "type" to "AUDIO_CHUNK",
                        "deviceId" to SyncPreferences.deviceId,
                        "payload" to mapOf(
                            "audioBase64" to b64,
                            "sampleRate" to SAMPLE_RATE,
                            "channels" to CHANNELS,
                            "encoding" to "PCM_16BIT",
                            "seq" to (++seq),
                            "level" to level,
                            "timestamp" to java.time.Instant.now().toString()
                        )
                    )
                    wsSender?.invoke(gson.toJson(payload))
                }
            }
        }, "EDR_AudioStreamThread")
        captureThread = thread
        thread.start()

        return Pair("EXECUTED", "Live audio stream started (16kHz PCM)")
    }

    @Synchronized
    fun stopStreaming(): Pair<String, String> {
        if (!isStreaming.getAndSet(false)) {
            return Pair("EXECUTED", "Live audio stream was already stopped")
        }

        try {
            audioRecord?.stop()
        } catch (_: Exception) {}
        try {
            audioRecord?.release()
        } catch (_: Exception) {}
        audioRecord = null

        try {
            captureThread?.interrupt()
        } catch (_: Exception) {}
        captureThread = null

        sendStatus(false, null)
        return Pair("EXECUTED", "Live audio stream stopped")
    }

    private fun computeRmsLevel(pcm: ByteArray, length: Int): Int {
        var sumSq = 0.0
        var samples = 0
        var i = 0
        while (i + 1 < length) {
            val lo = pcm[i].toInt() and 0xFF
            val hi = pcm[i + 1].toInt()
            val sample = (hi shl 8) or lo
            sumSq += sample * sample
            samples++
            i += 2
        }
        if (samples == 0) return 0
        val rms = sqrt(sumSq / samples)
        return ((rms / 32768.0) * 180.0).toInt().coerceIn(0, 100)
    }

    private fun sendStatus(active: Boolean, error: String?) {
        val statusPayload = mutableMapOf<String, Any>(
            "active" to active,
            "sampleRate" to SAMPLE_RATE
        )
        if (error != null) statusPayload["error"] = error
        val envelope = mapOf(
            "type" to "AUDIO_STREAM_STATUS",
            "deviceId" to SyncPreferences.deviceId,
            "payload" to statusPayload
        )
        wsSender?.invoke(gson.toJson(envelope))
    }
}
