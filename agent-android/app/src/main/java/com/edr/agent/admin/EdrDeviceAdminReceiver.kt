package com.edr.agent.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.policy.EdrPolicyManager
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

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

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        Log.w(TAG, "Device Admin disable requested! Possible app uninstallation in progress.")
        EdrLocalStorage.appendEdrLog(
            context,
            "TAMPER",
            "Device Administrator disable requested. Sending tamper/uninstall alert to Central Server."
        )
        sendUninstallAlert(context, "Device Administrator disable requested by user (uninstall in progress)")
        return "⚠️ SECURITY WARNING: Deactivating Device Administrator will flag this phone as UNINSTALLED and TAMPERED in the Central EDR Management Console. All security history and telemetry remain permanently stored on the server."
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.e(TAG, "Device Admin disabled! Marking device as uninstalled/tampered on server.")
        EdrLocalStorage.appendEdrLog(
            context,
            "TAMPER",
            "Device Administrator deactivated. App uninstall confirmed."
        )
        sendUninstallAlert(context, "Device Administrator deactivated - App uninstalled")
    }

    private fun sendUninstallAlert(context: Context, reason: String) {
        Thread {
            try {
                val deviceId = SyncPreferences.deviceId
                val baseUrl = SyncPreferences.httpBaseUrl
                if (deviceId.isNotEmpty() && baseUrl.isNotEmpty()) {
                    val url = "$baseUrl/api/devices/$deviceId/uninstall-alert"
                    val payload = mapOf(
                        "deviceId" to deviceId,
                        "reason" to reason,
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                    )
                    val body = Gson().toJson(payload).toRequestBody("application/json; charset=utf-8".toMediaType())
                    val req = Request.Builder().url(url).post(body).build()
                    EdrHttpClient.apiClient.newCall(req).execute().close()
                    Log.i(TAG, "Successfully notified server of uninstall/tamper event.")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed sending uninstall alert to server: ${e.message}")
            }
        }.start()
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        Log.i(TAG, "Profile Provisioning Complete - Configuring Device Owner")
        EdrPolicyManager.enforceAntiUninstall(context)
        try {
            val svcIntent = Intent(context, com.edr.agent.service.EdrForegroundService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(svcIntent)
            } else {
                context.startService(svcIntent)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed starting service after provisioning: ${e.message}")
        }
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

