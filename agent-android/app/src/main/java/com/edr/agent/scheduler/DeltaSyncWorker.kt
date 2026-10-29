package com.edr.agent.scheduler

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.edr.agent.policy.EdrPolicyManager
import com.edr.agent.storage.SyncPreferences
import com.edr.agent.telemetry.AppInventoryManager
import com.edr.agent.telemetry.ComprehensiveLogCollector
import com.edr.agent.telemetry.RawSecurityAuditHarvester
import com.edr.agent.telemetry.UsageStatsTracker
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class DeltaSyncWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    override suspend fun doWork(): Result {
        val syncFrom = SyncPreferences.getLastSyncedTimestamp()
        val syncTo = SyncPreferences.getCurrentIsoTimestamp()

        Log.i(TAG, "Starting Delta Log Sync. Range: $syncFrom -> $syncTo")

        return try {
            // 1. Gather SIEM-Grade Raw Audit Logs (Event IDs, Sysmon Network, Process, System, Crash)
            val deltaLogs = mutableListOf<Map<String, Any>>()

            // Harvest raw events using RawSecurityAuditHarvester
            val rawSiemEvents = RawSecurityAuditHarvester.harvestAllRawEvents(context, syncTo)
            for (ev in rawSiemEvents) {
                deltaLogs.add(
                    mapOf(
                        "eventType" to ev.eventCategory,
                        "severity" to ev.severity,
                        "message" to "[${ev.eventId}] ${ev.message}",
                        "payload" to (ev.details + mapOf(
                            "eventId" to ev.eventId,
                            "eventCategory" to ev.eventCategory,
                            "sourceBuffer" to ev.sourceBuffer,
                            "provider" to ev.provider
                        )),
                        "eventTimestamp" to ev.timestamp
                    )
                )
            }

            // Also harvest system health, battery, and storage metrics
            deltaLogs.addAll(ComprehensiveLogCollector.harvestAllLogs(context, syncFrom, syncTo))

            // Security Audit: Check USB Debugging
            val isAdbEnabled = Settings.Global.getInt(
                context.contentResolver,
                Settings.Global.ADB_ENABLED,
                0
            ) == 1
            if (isAdbEnabled) {
                deltaLogs.add(
                    mapOf(
                        "eventType" to "SECURITY_ALERT",
                        "severity" to "WARNING",
                        "message" to "USB Debugging (ADB) is currently enabled on endpoint",
                        "payload" to mapOf("adb_enabled" to true),
                        "eventTimestamp" to syncTo
                    )
                )
            }

            // Security Audit: Check for Root Indicators
            if (checkRootIndicators()) {
                deltaLogs.add(
                    mapOf(
                        "eventType" to "SECURITY_ALERT",
                        "severity" to "CRITICAL",
                        "message" to "CRITICAL: Root binary or Magisk detected on device!",
                        "payload" to mapOf("root_detected" to true),
                        "eventTimestamp" to syncTo
                    )
                )
            }

            // 2. Upload Delta Logs to Backend
            val uploadPayload = mapOf(
                "deviceId" to SyncPreferences.deviceId,
                "syncFrom" to syncFrom,
                "syncTo" to syncTo,
                "logs" to deltaLogs
            )

            val uploadUrl = "${SyncPreferences.httpBaseUrl}/api/logs/upload"
            val request = Request.Builder()
                .url(uploadUrl)
                .post(gson.toJson(uploadPayload).toRequestBody(jsonMediaType))
                .build()

            val response = httpClient.newCall(request).execute()
            if (response.isSuccessful) {
                Log.i(TAG, "Delta logs uploaded successfully! Updating lastSyncedTimestamp -> $syncTo")
                // ADVANCE THE LAST SYNC TIMESTAMP ANCHOR
                SyncPreferences.setLastSyncedTimestamp(syncTo)

                // Update all EDR info and audit log in /EDR local folder
                com.edr.agent.storage.EdrLocalStorage.saveEdrInfo(context)
                com.edr.agent.storage.EdrLocalStorage.appendEdrLog(context, "SYNC", "Delta sync completed successfully. Synced up to $syncTo")

                // 3. Upload Screen Time & App Usage
                uploadScreenTime()

                // 4. Sync Installed App Inventory
                uploadAppInventory()

                Result.success()
            } else {
                Log.e(TAG, "Upload failed with HTTP ${response.code}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Delta sync worker error: ${e.message}", e)
            Result.retry()
        }
    }

    private fun uploadScreenTime() {
        try {
            val usageList = UsageStatsTracker.collectDayWiseUsage(context, 7)
            if (usageList.isEmpty()) return

            val payload = mapOf(
                "deviceId" to SyncPreferences.deviceId,
                "usage" to usageList
            )
            val request = Request.Builder()
                .url("${SyncPreferences.httpBaseUrl}/api/usage/upload")
                .post(gson.toJson(payload).toRequestBody(jsonMediaType))
                .build()
            httpClient.newCall(request).execute().close()
        } catch (e: Exception) {
            Log.w(TAG, "Failed uploading screen time: ${e.message}")
        }
    }

    private fun uploadAppInventory() {
        try {
            val apps = AppInventoryManager.collectInstalledApps(context)
            val payload = mapOf(
                "deviceId" to SyncPreferences.deviceId,
                "apps" to apps
            )
            val request = Request.Builder()
                .url("${SyncPreferences.httpBaseUrl}/api/usage/apps/sync")
                .post(gson.toJson(payload).toRequestBody(jsonMediaType))
                .build()
            httpClient.newCall(request).execute().close()
        } catch (e: Exception) {
            Log.w(TAG, "Failed uploading app inventory: ${e.message}")
        }
    }

    private fun getBatteryLevel(context: Context): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
    }

    private fun checkRootIndicators(): Boolean {
        val paths = arrayOf(
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/system/app/Superuser.apk"
        )
        return paths.any { File(it).exists() }
    }

    companion object {
        private const val TAG = "EdrDeltaSyncWorker"
    }
}

