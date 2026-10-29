package com.edr.agent.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import com.edr.agent.policy.EdrPolicyManager

class EdrDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "EDR Device Admin Enabled")
        Toast.makeText(context, "EDR Device Admin Activated", Toast.LENGTH_SHORT).show()

        // Check if Device Owner
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isDeviceOwnerApp(context.packageName)) {
            Log.i(TAG, "EDR is provisioned as DEVICE OWNER! Enforcing Anti-Tamper Protection...")
            EdrPolicyManager.enforceAntiUninstall(context)
        }
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        Log.i(TAG, "Profile Provisioning Complete - Configuring Device Owner")
        EdrPolicyManager.enforceAntiUninstall(context)
    }

    override fun onPasswordFailed(context: Context, intent: Intent) {
        super.onPasswordFailed(context, intent)
        Log.w(TAG, "Security Alert: Incorrect lockscreen password attempt detected!")
    }

    companion object {
        private const val TAG = "EdrDeviceAdmin"

        fun getComponentName(context: Context): ComponentName {
            return ComponentName(context.applicationContext, EdrDeviceAdminReceiver::class.java)
        }
    }
}

