package com.edr.agent.ui

import android.content.Intent
import android.os.Bundle
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

        restartService() // Ensure EDR service & WebSocket are actively running!

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
            restartService()
        }
        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onResume() {
        super.onResume()
        restartService()
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
