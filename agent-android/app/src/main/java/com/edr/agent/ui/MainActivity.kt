package com.edr.agent.ui

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.edr.agent.R
import com.edr.agent.policy.EdrPolicyManager
import com.edr.agent.scheduler.SyncScheduler
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.SyncPreferences

class MainActivity : AppCompatActivity() {

    private lateinit var tvDeviceOwnerStatus: TextView
    private lateinit var tvDeviceId: TextView
    private lateinit var tvLastSync: TextView
    private lateinit var etServerHost: EditText
    private lateinit var btnSaveConfig: Button
    private lateinit var btnTriggerSync: Button
    private lateinit var btnUsagePermission: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()

        val hostExtra = intent?.getStringExtra("server_host")
        if (!hostExtra.isNullOrBlank()) {
            SyncPreferences.serverHost = hostExtra
            etServerHost.setText(hostExtra)
        }

        updateStatus()
        restartService() // Ensure EDR service & WebSocket are actively running!

        // Save & refresh all EDR info in /EDR folder
        com.edr.agent.storage.EdrLocalStorage.saveEdrInfo(this)

        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
        restartService()
    }

    private fun initViews() {
        tvDeviceOwnerStatus = findViewById(R.id.tvDeviceOwnerStatus)
        tvDeviceId = findViewById(R.id.tvDeviceId)
        tvLastSync = findViewById(R.id.tvLastSync)
        etServerHost = findViewById(R.id.etServerHost)
        btnSaveConfig = findViewById(R.id.btnSaveConfig)
        btnTriggerSync = findViewById(R.id.btnTriggerSync)
        btnUsagePermission = findViewById(R.id.btnUsagePermission)

        etServerHost.setText(SyncPreferences.serverHost)

        btnSaveConfig.setOnClickListener {
            val newHost = etServerHost.text.toString().trim()
            if (newHost.isNotEmpty()) {
                SyncPreferences.serverHost = newHost
                Toast.makeText(this, "Server updated to $newHost. Restarting service...", Toast.LENGTH_SHORT).show()
                restartService()
            }
        }

        btnTriggerSync.setOnClickListener {
            SyncScheduler.triggerImmediateSync(this)
            Toast.makeText(this, "Delta sync worker enqueued!", Toast.LENGTH_SHORT).show()
            updateStatus()
        }

        btnUsagePermission.setOnClickListener {
            if (!hasUsageStatsPermission()) {
                startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            } else {
                Toast.makeText(this, "Screen time permission already granted!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateStatus() {
        val isOwner = EdrPolicyManager.isDeviceOwner(this)
        if (isOwner) {
            tvDeviceOwnerStatus.text = "ACTIVE - Device Owner (Tamper-Proof)"
            tvDeviceOwnerStatus.setTextColor(getColor(android.R.color.holo_green_light))
        } else {
            tvDeviceOwnerStatus.text = "NOT PROVISIONED (Standard Mode)\nRun ADB command for Device Owner"
            tvDeviceOwnerStatus.setTextColor(getColor(android.R.color.holo_orange_light))
        }

        tvDeviceId.text = "Device ID: ${SyncPreferences.deviceId}"
        tvLastSync.text = "Last Delta Sync: ${SyncPreferences.getLastSyncedTimestamp()}"
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
        } else {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun restartService() {
        try {
            stopService(Intent(this, EdrForegroundService::class.java))
            val intent = Intent(this, EdrForegroundService::class.java)
            startService(intent)
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed restarting EDR service: ${e.message}")
        }
    }
}

