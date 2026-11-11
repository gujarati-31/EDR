package com.edr.agent.permission

import android.Manifest
import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.edr.agent.admin.EdrDeviceAdminReceiver
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.service.EdrAccessibilityService
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class PermissionItem(
    val key: String,
    val title: String,
    val description: String,
    val isGranted: Boolean,
    val isCritical: Boolean = true
)

object EdrPermissionManager {
    private const val TAG = "EdrPermissionManager"
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val httpClient = EdrHttpClient.apiClient

    fun isAccessibilityGranted(context: Context): Boolean {
        if (EdrAccessibilityService.instance != null) return true
        return try {
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            enabledServices.contains(context.packageName)
        } catch (e: Exception) {
            false
        }
    }

    fun isUsageStatsGranted(context: Context): Boolean {
        return try {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps?.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName
                )
            } else {
                @Suppress("DEPRECATION")
                appOps?.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName
                )
            }
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            false
        }
    }

    fun isBatteryOptimizationIgnored(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false
            } catch (e: Exception) {
                false
            }
        } else {
            true
        }
    }

    fun isStorageManagerGranted(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun isCameraGranted(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun isNotificationsGranted(context: Context): Boolean {
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun isDeviceAdminGranted(context: Context): Boolean {
        return try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            val adminComponent = EdrDeviceAdminReceiver.getComponentName(context)
            dpm?.isAdminActive(adminComponent) ?: false
        } catch (e: Exception) {
            false
        }
    }

    fun isOverlayGranted(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }

    fun isInstallPackagesGranted(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                context.packageManager.canRequestPackageInstalls()
            } catch (_: Exception) {
                false
            }
        } else {
            true
        }
    }

    /**
     * Returns full status map of system permissions (true = turned on, false = turned off).
     */
    fun getAllPermissionsMap(context: Context): Map<String, Boolean> {
        return mapOf(
            "accessibility" to isAccessibilityGranted(context),
            "usageStats" to isUsageStatsGranted(context),
            "batteryOptimization" to isBatteryOptimizationIgnored(context),
            "manageStorage" to isStorageManagerGranted(context),
            "camera" to isCameraGranted(context),
            "notifications" to isNotificationsGranted(context),
            "deviceAdmin" to isDeviceAdminGranted(context),
            "overlay" to isOverlayGranted(context),
            "installPackages" to isInstallPackagesGranted(context)
        )
    }

    /**
     * Returns the full list of PermissionItems with their current granted states.
     */
    fun getAllPermissionItems(context: Context): List<PermissionItem> {
        return listOf(
            PermissionItem(
                key = "accessibility",
                title = "Accessibility Protection Service",
                description = "Required for screen observation, app monitoring, and threat interception.",
                isGranted = isAccessibilityGranted(context),
                isCritical = true
            ),
            PermissionItem(
                key = "usageStats",
                title = "Usage Stats & App Tracking",
                description = "Tracks app launches, screen time, and detects foreground intruder applications.",
                isGranted = isUsageStatsGranted(context),
                isCritical = true
            ),
            PermissionItem(
                key = "batteryOptimization",
                title = "Ignore Battery Optimizations",
                description = "Prevents OEM deep sleep (Redmi / Vivo / Samsung) from killing sensors.",
                isGranted = isBatteryOptimizationIgnored(context),
                isCritical = true
            ),
            PermissionItem(
                key = "manageStorage",
                title = "All Files / Storage Access",
                description = "Saves security telemetry, audit logs, and evidence recordings to /sdcard/EDR.",
                isGranted = isStorageManagerGranted(context),
                isCritical = true
            ),
            PermissionItem(
                key = "camera",
                title = "Intruder Camera Access",
                description = "Silently captures front & back camera photos on unauthorized access.",
                isGranted = isCameraGranted(context),
                isCritical = true
            ),
            PermissionItem(
                key = "notifications",
                title = "System Notifications",
                description = "Maintains persistent background endpoint protection service.",
                isGranted = isNotificationsGranted(context),
                isCritical = true
            ),
            PermissionItem(
                key = "deviceAdmin",
                title = "Device Administrator",
                description = "Enables remote device lock, wipe, anti-tampering, and kiosk management.",
                isGranted = isDeviceAdminGranted(context),
                isCritical = false
            ),
            PermissionItem(
                key = "overlay",
                title = "Display Over Other Apps",
                description = "Allows live screen mirror projection and transparent protection dialogs.",
                isGranted = isOverlayGranted(context),
                isCritical = false
            ),
            PermissionItem(
                key = "installPackages",
                title = "Install Unknown Apps (OTA Updates)",
                description = "Allows remote EDR agent updates pushed from the management dashboard.",
                isGranted = isInstallPackagesGranted(context),
                isCritical = false
            )
        )
    }

    /**
     * Resolves the Intent to prompt or open the system settings for a specific permission.
     */
    fun getLaunchIntentForPermission(context: Context, key: String): Intent? {
        val pkg = context.packageName
        return when (key) {
            "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            "usageStats" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            "batteryOptimization" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$pkg")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                } else null
            }

            "manageStorage" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                        data = Uri.parse("package:$pkg")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                } else {
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$pkg")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                }
            }

            "camera" -> {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$pkg")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }

            "notifications" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                } else {
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:$pkg")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                }
            }

            "deviceAdmin" -> {
                val adminComponent = EdrDeviceAdminReceiver.getComponentName(context)
                Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                    putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                    putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        "Enable Device Administration for enterprise endpoint security and remote lock."
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }

            "overlay" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                        data = Uri.parse("package:$pkg")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                } else null
            }

            "installPackages" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:$pkg")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                } else null
            }

            else -> null
        }
    }

    /**
     * Asynchronously syncs the latest permission states to the central backend.
     */
    fun syncPermissionsToServer(context: Context, wsSender: ((String) -> Boolean)? = null) {
        Thread {
            try {
                val perms = getAllPermissionsMap(context)
                val deviceId = SyncPreferences.deviceId

                // 1. Send over WebSocket if available
                if (wsSender != null) {
                    val msg = mapOf(
                        "type" to "PERMISSIONS_UPDATE",
                        "deviceId" to deviceId,
                        "payload" to mapOf(
                            "deviceId" to deviceId,
                            "permissions" to perms
                        ),
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                    )
                    wsSender(gson.toJson(msg))
                }

                // 2. Also send via REST API for persistence
                val url = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/permissions"
                val requestBody = gson.toJson(mapOf("permissions" to perms)).toRequestBody(jsonMediaType)
                val request = Request.Builder().url(url).put(requestBody).build()
                httpClient.newCall(request).execute().close()

                Log.i(TAG, "Permissions synced to server: $perms")
            } catch (e: Exception) {
                Log.w(TAG, "Failed syncing permissions to server: ${e.message}")
            }
        }.start()
    }
}
