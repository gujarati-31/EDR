package com.edr.agent.logging

import android.content.Context
import android.util.Log
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.network.EdrNetworkManager
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Universal Central Logging Engine & Automatic Wrapper for EDR.
 *
 * Rules Enforced:
 * 1. One Central Function: Every part of EDR code must go through createLog().
 * 2. Log at Start and End: Every action logs "Started", followed by "Success", "Failed", or "Skipped"
 *    using the same Action ID to link together.
 * 3. Automatic Logging Wrapper: runLoggedAction() wraps tasks and auto-creates both logs.
 * 4. Logs skipped actions (e.g., "Skipped: network 4G").
 * 5. Logging NEVER stops, even when EDR is paused. Logs are saved locally on device.
 * 6. Uploads only on 5G, Wi-Fi, or Hotspot. On 4G/3G/2G/Offline, logs remain safe on device.
 * 7. Never saves actual content (photo, call audio, video, message body) — only details (type, name, size, time).
 */
object EdrActionLogger {

    private const val TAG = "EdrActionLogger"
    private val executor = Executors.newSingleThreadExecutor()
    private val gson = Gson()
    private val isUploading = AtomicBoolean(false)
    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        // Enforce 90-day retention cleanup on startup
        executor.execute {
            try {
                EdrActionLogDatabase.getInstance(context).cleanupOldLogs(90)
            } catch (e: Exception) {
                Log.w(TAG, "Startup retention cleanup error: ${e.message}")
            }
        }
    }

    class ActionContext(
        val actionId: String,
        val module: String,
        val eventType: String,
        val triggeredBy: String,
        val description: String
    ) {
        var bytesUploaded: Long = 0L
        var bytesDownloaded: Long = 0L
        var isSkipped: Boolean = false
        var skipReason: String? = null

        fun markSkipped(reason: String) {
            isSkipped = true
            skipReason = reason
        }

        fun addUploadedBytes(bytes: Long) {
            if (bytes > 0) bytesUploaded += bytes
        }

        fun addDownloadedBytes(bytes: Long) {
            if (bytes > 0) bytesDownloaded += bytes
        }
    }

    /**
     * Rule 1: One Central Function.
     * All EDR modules pass through createLog().
     */
    fun createLog(
        context: Context,
        actionId: String,
        module: String,
        eventType: String,
        triggeredBy: String,
        description: String,
        status: String,
        failureReason: String? = null,
        bytesUploaded: Long = 0L,
        bytesDownloaded: Long = 0L,
        customTimestamp: String? = null
    ): EdrActionLog {
        val deviceId = SyncPreferences.deviceId
        val timestamp = customTimestamp ?: SyncPreferences.getCurrentIsoTimestamp()
        val networkType = EdrNetworkManager.getWireNetworkType(context)

        val logEntry = EdrActionLog(
            logId = UUID.randomUUID().toString(),
            actionId = actionId,
            timestamp = timestamp,
            deviceId = deviceId,
            eventType = eventType,
            module = module,
            triggeredBy = triggeredBy,
            description = description,
            status = status,
            failureReason = failureReason,
            bytesUploaded = bytesUploaded,
            bytesDownloaded = bytesDownloaded,
            networkType = networkType
        )

        // 1. Immediately persist to secure local SQLite database
        executor.execute {
            try {
                EdrActionLogDatabase.getInstance(context).insert(logEntry)
            } catch (e: Exception) {
                Log.e(TAG, "Failed inserting action log: ${e.message}")
            }

            // 2. Real-time push: If WebSocket is connected, stream the action log live to dashboard!
            val wsClient = EdrForegroundService.instance?.wsClient
            if (wsClient != null && wsClient.isConnected) {
                val sent = wsClient.sendActionLogs(listOf(logEntry))
                if (sent) {
                    EdrActionLogDatabase.getInstance(context).markUploaded(listOf(logEntry.logId))
                    return@execute
                }
            }

            // 3. Fallback: If on 5G, Wi-Fi, or Hotspot: trigger background HTTP batch upload
            val netStatus = EdrNetworkManager.getNetworkStatus(context)
            if (netStatus.shouldWorkNormally) {
                triggerPendingLogsUpload(context)
            } else {
                Log.d(TAG, "Action log stored locally (${logEntry.status}). Upload deferred on ${netStatus.typeName}.")
            }
        }

        return logEntry
    }

    /**
     * Rule 3: Automatic Logging Wrapper.
     * Automatically logs:
     * 1. Status: Started at the beginning of the action.
     * 2. Status: Success / Failed / Skipped with bytes used and failure reason at the end.
     * Both entries share the same Action ID.
     */
    inline fun <T> runLoggedAction(
        context: Context,
        module: String,
        eventType: String,
        triggeredBy: String,
        description: String,
        block: (ActionContext) -> T
    ): T {
        val actionId = UUID.randomUUID().toString()
        val actCtx = ActionContext(actionId, module, eventType, triggeredBy, description)

        // 1. Start Log
        createLog(
            context = context,
            actionId = actionId,
            module = module,
            eventType = eventType,
            triggeredBy = triggeredBy,
            description = "$description (Started)",
            status = "Started"
        )

        val startTime = System.currentTimeMillis()
        try {
            val result = block(actCtx)
            val durationMs = System.currentTimeMillis() - startTime

            if (actCtx.isSkipped) {
                // Action was skipped (e.g. network weak or paused)
                createLog(
                    context = context,
                    actionId = actionId,
                    module = module,
                    eventType = eventType,
                    triggeredBy = triggeredBy,
                    description = "$description (${actCtx.skipReason ?: "Skipped"})",
                    status = "Skipped",
                    failureReason = actCtx.skipReason,
                    bytesUploaded = actCtx.bytesUploaded,
                    bytesDownloaded = actCtx.bytesDownloaded
                )
            } else {
                // Action completed successfully
                createLog(
                    context = context,
                    actionId = actionId,
                    module = module,
                    eventType = eventType,
                    triggeredBy = triggeredBy,
                    description = "$description (Success in ${durationMs}ms)",
                    status = "Success",
                    bytesUploaded = actCtx.bytesUploaded,
                    bytesDownloaded = actCtx.bytesDownloaded
                )
            }
            return result
        } catch (t: Throwable) {
            val durationMs = System.currentTimeMillis() - startTime
            val reason = t.message ?: t.javaClass.simpleName
            createLog(
                context = context,
                actionId = actionId,
                module = module,
                eventType = eventType,
                triggeredBy = triggeredBy,
                description = "$description (Failed in ${durationMs}ms: $reason)",
                status = "Failed",
                failureReason = reason,
                bytesUploaded = actCtx.bytesUploaded,
                bytesDownloaded = actCtx.bytesDownloaded
            )
            throw t
        }
    }

    /**
     * Convenience method to log an action skipped due to policy or network restrictions.
     */
    fun logSkipped(
        context: Context,
        module: String,
        eventType: String,
        triggeredBy: String,
        description: String,
        reason: String,
        actionId: String = UUID.randomUUID().toString()
    ) {
        createLog(
            context = context,
            actionId = actionId,
            module = module,
            eventType = eventType,
            triggeredBy = triggeredBy,
            description = "$description ($reason)",
            status = "Skipped",
            failureReason = reason
        )
    }

    /**
     * Convenience method for instant one-off status events.
     */
    fun logInstant(
        context: Context,
        module: String,
        eventType: String,
        triggeredBy: String,
        description: String,
        status: String = "Success",
        bytesUploaded: Long = 0L,
        bytesDownloaded: Long = 0L,
        failureReason: String? = null,
        actionId: String = UUID.randomUUID().toString()
    ) {
        createLog(
            context = context,
            actionId = actionId,
            module = module,
            eventType = eventType,
            triggeredBy = triggeredBy,
            description = description,
            status = status,
            failureReason = failureReason,
            bytesUploaded = bytesUploaded,
            bytesDownloaded = bytesDownloaded
        )
    }

    /**
     * Uploads pending local action logs to the central backend.
     * Uses active WebSocket if connected, otherwise uploads via HTTP on 5G, Wi-Fi, or Hotspot.
     */
    fun triggerPendingLogsUpload(context: Context) {
        val wsClient = EdrForegroundService.instance?.wsClient
        val isWsConnected = wsClient != null && wsClient.isConnected
        if (!isWsConnected && !EdrNetworkManager.isCloudUploadAllowed(context)) {
            Log.d(TAG, "Action log upload deferred: currently on weak/metered network (${EdrNetworkManager.getConnectionTypeLabel(context)}).")
            return
        }

        if (!isUploading.compareAndSet(false, true)) {
            return
        }

        executor.execute {
            try {
                val db = EdrActionLogDatabase.getInstance(context)
                var hasMore = true
                var totalUploadedInBatch = 0

                while (hasMore) {
                    val batch = db.getPendingUpload(limit = 60)
                    if (batch.isEmpty()) {
                        hasMore = false
                        break
                    }

                    val success = uploadBatchToServer(context, batch)
                    if (success) {
                        db.markUploaded(batch.map { it.logId })
                        totalUploadedInBatch += batch.size
                        // If fewer than limit, we're done
                        if (batch.size < 60) {
                            hasMore = false
                        }
                    } else {
                        // Network error or server busy; retry later
                        hasMore = false
                    }
                }

                if (totalUploadedInBatch > 0) {
                    Log.i(TAG, "Uploaded $totalUploadedInBatch pending action logs to central server.")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error in triggerPendingLogsUpload: ${e.message}")
            } finally {
                isUploading.set(false)
            }
        }
    }

    private fun uploadBatchToServer(context: Context, logs: List<EdrActionLog>): Boolean {
        // Try WebSocket first if connected
        val wsClient = EdrForegroundService.instance?.wsClient
        if (wsClient != null && wsClient.isConnected) {
            val sent = wsClient.sendActionLogs(logs)
            if (sent) {
                return true
            }
        }

        return try {
            val url = "${SyncPreferences.httpBaseUrl}/api/devices/${SyncPreferences.deviceId}/action-logs"
            val json = gson.toJson(mapOf("logs" to logs))
            val body = json.toRequestBody("application/json; charset=utf-8".toMediaType())
            val req = Request.Builder().url(url).post(body).build()

            EdrHttpClient.apiClient.newCall(req).execute().use { response ->
                response.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed uploading action logs batch: ${e.message}")
            false
        }
    }
}
