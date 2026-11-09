package com.edr.agent.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import com.edr.agent.R
import com.edr.agent.scheduler.SyncScheduler
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val hostExtra = intent?.getStringExtra("server_host")
        if (!hostExtra.isNullOrBlank()) {
            SyncPreferences.serverHost = hostExtra
        }

        // Request battery optimization exemption for uninterrupted background EDR operation (crucial for Xiaomi/Redmi/Samsung)
        requestBatteryExemption()

        // Prompt OEM autostart permission on aggressive skins (Xiaomi MIUI/HyperOS, Vivo FuntouchOS, Oppo ColorOS)
        promptOemAutostartPermission()

        // Ensure EDR service & WebSocket are actively running without killing existing instance
        ensureServiceRunning()

        // Save & refresh all EDR info in /EDR folder
        EdrLocalStorage.saveEdrInfo(this)

        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val hostExtra = intent?.getStringExtra("server_host")
        if (!hostExtra.isNullOrBlank()) {
            SyncPreferences.serverHost = hostExtra
            ensureServiceRunning()
        }
        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onResume() {
        super.onResume()
        ensureServiceRunning()
    }

    private fun ensureServiceRunning() {
        try {
            if (EdrForegroundService.instance == null) {
                val serviceIntent = Intent(this, EdrForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
            } else {
                EdrForegroundService.instance?.reconnectWebSocket()
            }
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed ensuring EDR service running: ${e.message}", e)
        }
    }

    private fun requestBatteryExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "Battery optimization prompt skipped: ${e.message}")
            }
        }
    }

    private fun promptOemAutostartPermission() {
        val prefs = getSharedPreferences("edr_oem_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("oem_autostart_prompted", false)) return

        val manufacturer = Build.MANUFACTURER.lowercase()
        val oemIntents = mutableListOf<Intent>()

        when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
            }
            manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")))
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")))
            }
            manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")))
            }
            manufacturer.contains("huawei") || manufacturer.contains("honor") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")))
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")))
            }
        }

        for (intent in oemIntents) {
            try {
                if (packageManager.resolveActivity(intent, 0) != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(intent)
                    prefs.edit().putBoolean("oem_autostart_prompted", true).apply()
                    break
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "Failed to launch OEM autostart activity: ${e.message}")
            }
        }
    }
}
