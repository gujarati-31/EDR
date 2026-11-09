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
}
