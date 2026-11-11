package com.edr.agent.admin

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.edr.agent.policy.EdrPolicyManager
import com.edr.agent.service.EdrForegroundService

/**
 * Handles Android 12+ Device Owner (DPC) QR provisioning intents:
 * - android.app.action.GET_PROVISIONING_MODE
 * - android.app.action.ADMIN_POLICY_COMPLIANCE
 */
class DpcProvisioningActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent?.action) {
            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> {
                val result = Intent()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    result.putExtra(
                        DevicePolicyManager.EXTRA_PROVISIONING_MODE,
                        DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
                    )
                }
                setResult(RESULT_OK, result)
                finish()
            }

            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> {
                Log.i("DpcProvisioning", "Compliance step reached — finalizing Device Owner setup")
                try {
                    EdrPolicyManager.enforceAntiUninstall(this)
                    val svcIntent = Intent(this, EdrForegroundService::class.java)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(svcIntent)
                    } else {
                        startService(svcIntent)
                    }
                } catch (e: Exception) {
                    Log.w("DpcProvisioning", "Compliance setup warning: ${e.message}")
                }
                setResult(RESULT_OK)
                finish()
            }

            else -> {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }
}
