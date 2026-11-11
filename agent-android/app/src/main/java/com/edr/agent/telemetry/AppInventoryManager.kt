package com.edr.agent.telemetry

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

data class InstalledAppRecord(
    val packageName: String,
    val appName: String,
    val versionName: String,
    val isSystemApp: Boolean,
    val apkSha256: String
)

object AppInventoryManager {
    private const val TAG = "EdrAppInventory"
    private const val INVENTORY_TTL_MS = 24L * 60L * 60L * 1000L
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val isSyncing = AtomicBoolean(false)

    private val httpClient = EdrHttpClient.apiClient

    /**
     * Computes a zero-I/O metadata signature (count + latest package update timestamp + hash).
     * Used to avoid re-reading and SHA-256 hashing all APKs when nothing was installed/updated.
     */
    fun computePackageSignature(context: Context): String {
        return try {
            val pm = context.packageManager
            val packages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
            } else {
                pm.getInstalledPackages(0)
            }
            var maxUpdateTime = 0L
            var nameHash = 0L
            for (pkg in packages) {
                if (pkg.lastUpdateTime > maxUpdateTime) maxUpdateTime = pkg.lastUpdateTime
                nameHash = 31L * nameHash + (pkg.packageName?.hashCode() ?: 0)
            }
            "${packages.size}:$maxUpdateTime:$nameHash"
        } catch (_: Exception) {
            ""
        }
    }

    fun hasInventoryChanged(context: Context): Boolean {
        val currentSig = computePackageSignature(context)
        if (currentSig.isBlank()) return true
        val savedSig = SyncPreferences.lastAppInventorySig
        val ageMs = System.currentTimeMillis() - SyncPreferences.lastAppInventoryTime
        return currentSig != savedSig || ageMs >= INVENTORY_TTL_MS
    }

    fun markInventorySynced(context: Context, signature: String = computePackageSignature(context)) {
        if (signature.isNotBlank()) {
            SyncPreferences.lastAppInventorySig = signature
            SyncPreferences.lastAppInventoryTime = System.currentTimeMillis()
        }
    }

    fun collectInstalledApps(context: Context): List<InstalledAppRecord> {
        val pm = context.packageManager
        val records = mutableListOf<InstalledAppRecord>()
        val seenPackages = mutableSetOf<String>()

        try {
            val packages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
            } else {
                pm.getInstalledPackages(0)
            }

            for (pkg in packages) {
                try {
                    val appInfo = pkg.applicationInfo ?: continue
                    val packageName = pkg.packageName ?: continue
                    if (!seenPackages.add(packageName)) continue

                    val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                    val appName = try {
                        val label = pm.getApplicationLabel(appInfo).toString()
                        if (label.isNotBlank()) label else packageName
                    } catch (e: Exception) {
                        packageName
                    }
                    val versionName = pkg.versionName ?: "1.0"
                    val apkPath = appInfo.sourceDir ?: ""
                    val sha256 = calculateFileSha256(apkPath, isSystem)

                    records.add(
                        InstalledAppRecord(
                            packageName = packageName,
                            appName = appName,
                            versionName = versionName,
                            isSystemApp = isSystem,
                            apkSha256 = sha256
                        )
                    )
                } catch (ignored: Exception) {}
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed collecting packages via getInstalledPackages: ${e.message}", e)
        }

        // Robust Fallback: If packages list was blocked or empty, query installed applications directly
        if (records.isEmpty()) {
            try {
                val apps = pm.getInstalledApplications(0)
                for (appInfo in apps) {
                    try {
                        val packageName = appInfo.packageName ?: continue
                        if (!seenPackages.add(packageName)) continue

                        val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                        val appName = try {
                            val label = pm.getApplicationLabel(appInfo).toString()
                            if (label.isNotBlank()) label else packageName
                        } catch (e: Exception) {
                            packageName
                        }

                        records.add(
                            InstalledAppRecord(
                                packageName = packageName,
                                appName = appName,
                                versionName = "1.0",
                                isSystemApp = isSystem,
                                apkSha256 = if (isSystem) "system" else ""
                            )
                        )
                    } catch (ignored: Exception) {}
                }
            } catch (e: Exception) {
                Log.e(TAG, "Fallback getInstalledApplications failed: ${e.message}", e)
            }
        }

        Log.i(TAG, "Collected ${records.size} installed apps (User: ${records.count { !it.isSystemApp }}, System: ${records.count { it.isSystemApp }})")
        return records
    }

    /**
     * Fast SHA-256 calculation. Skips full system framework scanning and caps hash at 512KB
     * to prevent CPU/IO freezing on hundreds of user packages.
     */
    private fun calculateFileSha256(filePath: String, isSystem: Boolean): String {
        if (isSystem || filePath.isBlank()) return "system"
        return try {
            val file = File(filePath)
            if (!file.exists() || !file.canRead()) return ""
            val digest = MessageDigest.getInstance("SHA-256")
            val fis = FileInputStream(file)
            val buffer = ByteArray(8192)
            var bytesRead: Int
            var totalRead = 0L
            val maxBytes = 512L * 1024L // Read first 512KB max for instant calculation
            while (fis.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
                totalRead += bytesRead
                if (totalRead >= maxBytes) break
            }
            fis.close()
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Instantly harvests all installed packages and synchronizes them with the backend
     * over both open WebSocket (real-time zero latency) and HTTP REST endpoint.
     */
    fun syncNow(
        context: Context,
        wsSender: ((String) -> Boolean)? = null,
        force: Boolean = true,
        callback: ((Boolean, Int) -> Unit)? = null
    ) {
        if (!force && !hasInventoryChanged(context)) {
            Log.d(TAG, "App inventory unchanged since last sync; skipping APK scan/upload to save battery.")
            callback?.invoke(true, 0)
            return
        }
        if (!isSyncing.compareAndSet(false, true)) {
            Log.d(TAG, "App inventory sync already in progress; skipping duplicate request.")
            callback?.invoke(true, 0)
            return
        }

        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "edr:app_sync_now")

        Thread {
            try {
                wakeLock?.acquire(15000L) // 15 seconds max CPU lock
                val currentSig = computePackageSignature(context)
                val apps = collectInstalledApps(context)
                val deviceId = SyncPreferences.deviceId

                // 1. Send via WebSocket for instantaneous dashboard push
                var wsSent = false
                if (wsSender != null) {
                    try {
                        val wsPayload = mapOf(
                            "type" to "APPS_INVENTORY",
                            "deviceId" to deviceId,
                            "payload" to mapOf(
                                "deviceId" to deviceId,
                                "apps" to apps
                            ),
                            "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                        )
                        wsSent = wsSender(gson.toJson(wsPayload))
                        Log.i(TAG, "Sent app inventory over WebSocket: $wsSent (${apps.size} apps)")
                    } catch (wsErr: Exception) {
                        Log.w(TAG, "WebSocket app push error: ${wsErr.message}")
                    }
                }

                // 2. Also POST to REST backend API for guaranteed persistence
                val httpPayload = mapOf(
                    "deviceId" to deviceId,
                    "apps" to apps
                )
                val url = "${SyncPreferences.httpBaseUrl}/api/usage/apps/sync"
                val request = Request.Builder()
                    .url(url)
                    .post(gson.toJson(httpPayload).toRequestBody(jsonMediaType))
                    .build()

                val response = httpClient.newCall(request).execute()
                val isSuccess = response.isSuccessful
                response.close()

                if (isSuccess || wsSent) {
                    markInventorySynced(context, currentSig)
                }

                Log.i(TAG, "REST app inventory sync finished. Success=$isSuccess (${apps.size} apps)")
                callback?.invoke(isSuccess || wsSent, apps.size)
            } catch (e: Exception) {
                Log.e(TAG, "Failed during syncNow app inventory: ${e.message}", e)
                callback?.invoke(false, 0)
            } finally {
                isSyncing.set(false)
                try {
                    if (wakeLock?.isHeld == true) wakeLock.release()
                } catch (ignored: Exception) {}
            }
        }.start()
    }
}
