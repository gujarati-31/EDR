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
     * Apply remote policy toggles sent from the Web Management Dashboard
     */
    fun applyPolicy(context: Context, policyMap: Map<String, Any>) {
        // 0. Update Trap App Packages (Monitored Intruder Apps)
        // Note: Does NOT require Device Owner - uses UsageStats & Camera2
        if (policyMap.containsKey("trapAppPackages")) {
            val rawList = policyMap["trapAppPackages"] as? List<*>
            val packages = rawList?.mapNotNull { it?.toString() }?.toSet() ?: emptySet()
            com.edr.agent.monitor.TrapAppMonitor.updateTrapPackages(packages)
            Log.i(TAG, "Applied Trap App Packages: $packages")
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

