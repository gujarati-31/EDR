package com.edr.agent.policy

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.os.UserManager
import android.util.Log
import com.edr.agent.admin.EdrDeviceAdminReceiver

object EdrPolicyManager {
    private const val TAG = "EdrPolicyManager"

    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    /**
     * Stealth Mode: Hide App from Settings (Apps list, Data Usage) and Launcher.
     * Invokes DevicePolicyManager.setApplicationHidden() when provisioned as Device Owner.
     * Also toggles launcher activity component state as companion/fallback.
     */
    fun setAppHidden(context: Context, hidden: Boolean): Pair<Boolean, String> {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return Pair(false, "DevicePolicyManager service not available")
        val admin = EdrDeviceAdminReceiver.getComponentName(context)
        val pm = context.packageManager
        val launcherComponent = android.content.ComponentName(context, com.edr.agent.ui.MainActivity::class.java)

        var dpmSuccess = false
        var dpmMessage = ""

        try {
            if (dpm.isDeviceOwnerApp(context.packageName) || dpm.isProfileOwnerApp(context.packageName)) {
                dpmSuccess = dpm.setApplicationHidden(admin, context.packageName, hidden)
                dpmMessage = "DPM setApplicationHidden($hidden): $dpmSuccess"
                Log.i(TAG, dpmMessage)
            } else {
                dpmMessage = "Not Device Owner (requires DO for full Settings hide)"
                Log.w(TAG, dpmMessage)
            }
        } catch (e: Exception) {
            dpmMessage = "DPM error: ${e.message}"
            Log.e(TAG, dpmMessage, e)
        }

        // Also toggle MainActivity component setting so Launcher/App Drawer icon is hidden
        try {
            val desiredState = if (hidden) {
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            } else {
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            }
            pm.setComponentEnabledSetting(
                launcherComponent,
                desiredState,
                android.content.pm.PackageManager.DONT_KILL_APP
            )
            Log.i(TAG, "MainActivity component state set to $desiredState (hidden=$hidden)")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to toggle MainActivity component: ${e.message}")
        }

        val finalMsg = if (dpmSuccess) {
            if (hidden) "App completely hidden from Settings Apps list, Data Usage, and Launcher"
            else "App unhidden and visible in Settings and Launcher"
        } else {
            if (hidden) "App hidden from Launcher/App Drawer (Settings hide requires Device Owner: $dpmMessage)"
            else "App unhidden and visible on Launcher"
        }

        com.edr.agent.storage.EdrLocalStorage.appendEdrLog(
            context,
            "POLICY_CHANGE",
            "Stealth Mode (${if (hidden) "HIDE_APP" else "UNHIDE_APP"}): $finalMsg"
        )

        return Pair(true, finalMsg)
    }

    fun isAppHidden(context: Context): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return false
        val admin = EdrDeviceAdminReceiver.getComponentName(context)
        return try {
            if (dpm.isDeviceOwnerApp(context.packageName) || dpm.isProfileOwnerApp(context.packageName)) {
                dpm.isApplicationHidden(admin, context.packageName)
            } else {
                false
            }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Enforce Anti-Tamper: Phone user cannot uninstall or force-stop the EDR Agent!
     */
    fun enforceAntiUninstall(context: Context) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = EdrDeviceAdminReceiver.getComponentName(context)

        if (dpm.isDeviceOwnerApp(context.packageName)) {
            try {
                // Block uninstalling EDR agent
                dpm.setUninstallBlocked(admin, context.packageName, true)

                // Block factory reset by user from settings
                dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)

                // Block safe boot mode
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
                }

                Log.i(TAG, "Anti-Tampering successfully enforced. Agent cannot be uninstalled by user.")
            } catch (e: Exception) {
                Log.e(TAG, "Error enforcing anti-uninstall: ${e.message}", e)
            }
        } else {
            Log.w(TAG, "Cannot enforce anti-uninstall: App is not provisioned as Device Owner.")
        }
    }

    /**
     * Remote Pause: Temporarily stops background monitoring, trap screen recordings, and streams.
     * Keeps WebSocket open so the admin can resume at any time.
     */
    fun pauseProtection(context: Context) {
        com.edr.agent.storage.SyncPreferences.isAgentPaused = true
        Log.w(TAG, "PAUSE_AGENT: EDR background protection paused by administrator.")

        try {
            if (com.edr.agent.screen.AppTrapScreenRecorder.isCurrentlyRecording()) {
                com.edr.agent.screen.AppTrapScreenRecorder.stopRecording(context.applicationContext)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping active trap recording during pause: ${e.message}")
        }

        try {
            com.edr.agent.screen.ScreenStreamManager.stopStreaming()
        } catch (ignored: Exception) {}

        try {
            com.edr.agent.screen.AudioStreamManager.stopStreaming()
        } catch (ignored: Exception) {}

        try {
            com.edr.agent.service.EdrForegroundService.instance?.updateNotification()
        } catch (ignored: Exception) {}

        com.edr.agent.storage.EdrLocalStorage.appendEdrLog(
            context,
            "POLICY_CHANGE",
            "EDR Protection paused by administrator from dashboard."
        )

        try {
            com.edr.agent.service.EdrForegroundService.instance?.sendWebSocketHeartbeatNow()
        } catch (ignored: Exception) {}
    }

    /**
     * Remote Resume: Restores normal background monitoring, app trap detection, and telemetry.
     */
    fun resumeProtection(context: Context) {
        com.edr.agent.storage.SyncPreferences.isAgentPaused = false
        Log.i(TAG, "RESUME_AGENT: EDR background protection resumed by administrator.")

        try {
            com.edr.agent.service.EdrForegroundService.instance?.updateNotification()
        } catch (ignored: Exception) {}

        com.edr.agent.storage.EdrLocalStorage.appendEdrLog(
            context,
            "POLICY_CHANGE",
            "EDR Protection resumed by administrator from dashboard."
        )

        try {
            com.edr.agent.service.EdrForegroundService.instance?.sendWebSocketHeartbeatNow()
        } catch (ignored: Exception) {}
    }

    /**
     * Apply remote policy toggles sent from the Web Management Dashboard
     */
    fun applyPolicy(context: Context, policyMap: Map<String, Any>, isInitialRegistration: Boolean = false) {
        // 0. Update Trap App Packages (Monitored Intruder Apps)
        // Note: Does NOT require Device Owner - uses UsageStats & Screen Recording
        if (policyMap.containsKey("trapAppPackages")) {
            val rawList = policyMap["trapAppPackages"] as? List<*>
            val packages = rawList?.mapNotNull { it?.toString() }?.toSet() ?: emptySet()
            if (!isInitialRegistration || packages.isNotEmpty() || com.edr.agent.monitor.TrapAppMonitor.getTrapPackages().isEmpty()) {
                com.edr.agent.monitor.TrapAppMonitor.updateTrapPackages(packages)
                Log.i(TAG, "Applied Trap App Packages: $packages")
            }
        }

        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = EdrDeviceAdminReceiver.getComponentName(context)

        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            Log.w(TAG, "Cannot apply DPC policies: App is not Device Owner.")
            return
        }

        try {
            // 1. Screen Capture / Recording Block
            if (policyMap.containsKey("blockScreenCapture")) {
                val block = policyMap["blockScreenCapture"] as? Boolean ?: false
                dpm.setScreenCaptureDisabled(admin, block)
                Log.i(TAG, "Policy updated: ScreenCaptureDisabled = $block")
            }

            // 2. Camera Disable
            if (policyMap.containsKey("disableCamera")) {
                val disable = policyMap["disableCamera"] as? Boolean ?: false
                dpm.setCameraDisabled(admin, disable)
                Log.i(TAG, "Policy updated: CameraDisabled = $disable")
            }

            // 3. USB File Transfer (MTP)
            if (policyMap.containsKey("disableUsbTransfer")) {
                val disable = policyMap["disableUsbTransfer"] as? Boolean ?: false
                setRestriction(dpm, admin, UserManager.DISALLOW_USB_FILE_TRANSFER, disable)
                Log.i(TAG, "Policy updated: DisallowUsbTransfer = $disable")
            }

            // 4. USB Debugging (ADB)
            if (policyMap.containsKey("blockUsbDebugging")) {
                val block = policyMap["blockUsbDebugging"] as? Boolean ?: false
                setRestriction(dpm, admin, UserManager.DISALLOW_DEBUGGING_FEATURES, block)
                Log.i(TAG, "Policy updated: DisallowDebuggingFeatures = $block")
            }

            // 5. Unknown Sources (Sideloading)
            if (policyMap.containsKey("blockUnknownSources")) {
                val block = policyMap["blockUnknownSources"] as? Boolean ?: false
                setRestriction(dpm, admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES, block)
                Log.i(TAG, "Policy updated: DisallowInstallUnknownSources = $block")
            }

            // 6. Factory Reset Block
            if (policyMap.containsKey("blockFactoryReset")) {
                val block = policyMap["blockFactoryReset"] as? Boolean ?: true
                setRestriction(dpm, admin, UserManager.DISALLOW_FACTORY_RESET, block)
                Log.i(TAG, "Policy updated: DisallowFactoryReset = $block")
            }

            // 7. Stealth Mode / Hide App from Settings (Apps list, Data Usage) & Launcher
            if (policyMap.containsKey("hideAppFromSettings")) {
                val hide = policyMap["hideAppFromSettings"] as? Boolean ?: false
                val res = setAppHidden(context, hide)
                Log.i(TAG, "Policy updated: hideAppFromSettings = $hide -> ${res.second}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed applying policies: ${e.message}", e)
        }
    }

    private fun setRestriction(
        dpm: DevicePolicyManager,
        admin: android.content.ComponentName,
        restrictionKey: String,
        enabled: Boolean
    ) {
        if (enabled) {
            dpm.addUserRestriction(admin, restrictionKey)
        } else {
            dpm.clearUserRestriction(admin, restrictionKey)
        }
    }
}

