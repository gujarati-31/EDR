package com.edr.agent.permission

import android.Manifest
import android.app.Activity
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

    fun isOsAccessibilityGranted(context: Context): Boolean {
        if (EdrAccessibilityService.instance != null) return true
        // Preserve granted status while Accessibility is temporarily shielded during GPay / banking apps
        if (SyncPreferences.isAccessibilityAutoPausedForBank) return true
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

    fun isAccessibilityGranted(context: Context): Boolean {
        return !SyncPreferences.isPermissionDisabledByAdmin("accessibility") && isOsAccessibilityGranted(context)
    }

    fun isUsageStatsGranted(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("usageStats")) return false
        return isOsUsageStatsGranted(context)
    }

    private fun isOsUsageStatsGranted(context: Context): Boolean {
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
        if (SyncPreferences.isPermissionDisabledByAdmin("batteryOptimization")) return false
        return isOsBatteryOptimizationIgnored(context)
    }

    private fun isOsBatteryOptimizationIgnored(context: Context): Boolean {
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
        if (SyncPreferences.isPermissionDisabledByAdmin("manageStorage")) return false
        return isOsStorageManagerGranted(context)
    }

    private fun isOsStorageManagerGranted(context: Context): Boolean {
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
        if (SyncPreferences.isPermissionDisabledByAdmin("camera")) return false
        return isOsCameraGranted(context)
    }

    private fun isOsCameraGranted(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun isNotificationsGranted(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("notifications")) return false
        return isOsNotificationsGranted(context)
    }

    private fun isOsNotificationsGranted(context: Context): Boolean {
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun isDeviceAdminGranted(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("deviceAdmin")) return false
        return isOsDeviceAdminGranted(context)
    }

    private fun isOsDeviceAdminGranted(context: Context): Boolean {
        return try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            val adminComponent = EdrDeviceAdminReceiver.getComponentName(context)
            dpm?.isAdminActive(adminComponent) ?: false
        } catch (e: Exception) {
            false
        }
    }

    fun isOverlayGranted(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("overlay")) return false
        return isOsOverlayGranted(context)
    }

    private fun isOsOverlayGranted(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }

    fun isInstallPackagesGranted(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("installPackages")) return false
        return isOsInstallPackagesGranted(context)
    }

    private fun isOsInstallPackagesGranted(context: Context): Boolean {
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

    fun isCallLogGranted(context: Context): Boolean {
        if (SyncPreferences.isPermissionDisabledByAdmin("callLog")) return false
        return isOsCallLogGranted(context)
    }

    private fun isOsCallLogGranted(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Raw OS permission states (independent of Admin override).
     */
    fun getOsPermissionsMap(context: Context): Map<String, Boolean> {
        return mapOf(
            "accessibility" to isOsAccessibilityGranted(context),
            "usageStats" to isOsUsageStatsGranted(context),
            "batteryOptimization" to isOsBatteryOptimizationIgnored(context),
            "manageStorage" to isOsStorageManagerGranted(context),
            "camera" to isOsCameraGranted(context),
            "notifications" to isOsNotificationsGranted(context),
            "deviceAdmin" to isOsDeviceAdminGranted(context),
            "overlay" to isOsOverlayGranted(context),
            "installPackages" to isOsInstallPackagesGranted(context),
            "callLog" to isOsCallLogGranted(context)
        )
    }

    /**
     * Effective active permissions (true = OS granted AND not turned off by Admin).
     */
    fun getAllPermissionsMap(context: Context): Map<String, Boolean> {
        val osMap = getOsPermissionsMap(context)
        return osMap.mapValues { (key, osGranted) ->
            osGranted && !SyncPreferences.isPermissionDisabledByAdmin(key)
        }
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
            ),
            PermissionItem(
                key = "callLog",
                title = "Phone History & Call Logs",
                description = "Enables auditing of incoming, outgoing, and missed call duration logs.",
                isGranted = isCallLogGranted(context),
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

            "callLog" -> {
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
                    if (context !is Activity) {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
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
     * Applies an Admin remote toggle for any EDR permission (turn OFF or turn ON) and syncs updated status.
     */
    fun setAdminPermissionState(
        context: Context,
        key: String,
        enabled: Boolean,
        wsSender: ((String) -> Boolean)? = null
    ): Pair<String, String> {
        val validKeys = setOf(
            "accessibility", "usageStats", "batteryOptimization", "manageStorage",
            "camera", "notifications", "deviceAdmin", "overlay", "installPackages", "callLog"
        )
        if (key !in validKeys) {
            return Pair("FAILED", "Unknown permission key: $key")
        }

        SyncPreferences.setPermissionDisabledByAdmin(key, !enabled)
        var detailMsg = if (enabled) {
            "Permission '$key' turned ON by Administrator."
        } else {
            "Permission '$key' turned OFF by Administrator."
        }

        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
        val admin = EdrDeviceAdminReceiver.getComponentName(context)
        val isDo = dpm?.isDeviceOwnerApp(context.packageName) == true

        when (key) {
            "accessibility" -> {
                if (enabled) {
                    val osSuccess = com.edr.agent.policy.AccessibilityAutoShield.setOurAccessibilitySettingEnabled(
                        context, enabled = true, markPausedForBank = false
                    )
                    if (osSuccess) {
                        detailMsg = "Accessibility Protection Service turned ON at OS level."
                    } else if (!isOsAccessibilityGranted(context)) {
                        try {
                            getLaunchIntentForPermission(context, "accessibility")?.let { context.startActivity(it) }
                        } catch (_: Exception) {}
                        detailMsg = "Accessibility enabled in EDR; prompt opened on phone for OS confirmation."
                    }
                } else {
                    val osDisabled = com.edr.agent.policy.AccessibilityAutoShield.setOurAccessibilitySettingEnabled(
                        context, enabled = false, markPausedForBank = false
                    )
                    detailMsg = if (osDisabled) {
                        "Accessibility Protection Service turned OFF at OS level by Administrator."
                    } else {
                        "Accessibility Protection Service turned OFF in EDR."
                    }
                }
            }

            "usageStats" -> {
                if (!enabled && com.edr.agent.screen.AppTrapScreenRecorder.isCurrentlyRecording()) {
                    com.edr.agent.screen.AppTrapScreenRecorder.stopRecording(context.applicationContext)
                }
                com.edr.agent.service.EdrForegroundService.instance?.updateTrapFallbackSchedule()
            }

            "overlay" -> {
                if (!enabled && com.edr.agent.screen.ScreenStreamManager.isStreamingActive()) {
                    com.edr.agent.screen.ScreenStreamManager.stopStreaming()
                }
            }

            "camera", "callLog", "notifications" -> {
                if (isDo && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val manifestPerm = when (key) {
                        "camera" -> Manifest.permission.CAMERA
                        "callLog" -> Manifest.permission.READ_CALL_LOG
                        "notifications" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            Manifest.permission.POST_NOTIFICATIONS
                        } else null
                        else -> null
                    }
                    if (manifestPerm != null) {
                        try {
                            dpm?.setPermissionGrantState(
                                admin,
                                context.packageName,
                                manifestPerm,
                                if (enabled) DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
                                else DevicePolicyManager.PERMISSION_GRANT_STATE_DENIED
                            )
                        } catch (e: Exception) {
                            Log.w(TAG, "DPC setPermissionGrantState failed for $key: ${e.message}")
                        }
                    }
                }
            }
        }

        // If Admin enabled a permission whose OS grant is missing on the phone, prompt user gracefully
        val osGrantedAfter = getOsPermissionsMap(context)[key] == true
        if (enabled && !osGrantedAfter && key != "accessibility") {
            try {
                getLaunchIntentForPermission(context, key)?.let { intent ->
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                }
                detailMsg = "Permission '$key' enabled in EDR; OS grant prompt opened on phone."
            } catch (e: Exception) {
                Log.w(TAG, "Could not open permission prompt for $key from background: ${e.message}")
                detailMsg = "Permission '$key' enabled in EDR (OS permission still needs user grant on phone)."
            }
        }

        Log.i(TAG, "Admin remote permission update: $key -> enabled=$enabled ($detailMsg)")
        com.edr.agent.storage.EdrLocalStorage.appendEdrLog(context, "POLICY_CHANGE", detailMsg)
        syncPermissionsToServer(context, wsSender)
        return Pair("EXECUTED", detailMsg)
    }

    /**
     * Asynchronously syncs the latest permission states to the central backend.
     */
    fun syncPermissionsToServer(context: Context, wsSender: ((String) -> Boolean)? = null) {
        Thread {
            try {
                val osPerms = getOsPermissionsMap(context)
                val disabledSet = SyncPreferences.getAdminDisabledPermissions()
                val effectivePerms = osPerms.mapValues { (k, v) -> v && !disabledSet.contains(k) }
                val deviceId = SyncPreferences.deviceId

                // 1. Send over WebSocket if available
                if (wsSender != null) {
                    val msg = mapOf(
                        "type" to "PERMISSIONS_UPDATE",
                        "deviceId" to deviceId,
                        "payload" to mapOf(
                            "deviceId" to deviceId,
                            "permissions" to effectivePerms,
                            "osPermissions" to osPerms,
                            "adminDisabledPermissions" to disabledSet.toList()
                        ),
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                    )
                    wsSender(gson.toJson(msg))
                }

                // 2. Also send via REST API for persistence
                val url = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/permissions"
                val requestBody = gson.toJson(
                    mapOf(
                        "permissions" to effectivePerms,
                        "osPermissions" to osPerms,
                        "adminDisabledPermissions" to disabledSet.toList()
                    )
                ).toRequestBody(jsonMediaType)
                val request = Request.Builder().url(url).put(requestBody).build()
                httpClient.newCall(request).execute().close()

                Log.i(TAG, "Permissions synced to server: $effectivePerms (adminDisabled=$disabledSet)")
            } catch (e: Exception) {
                Log.w(TAG, "Failed syncing permissions to server: ${e.message}")
            }
        }.start()
    }
}
