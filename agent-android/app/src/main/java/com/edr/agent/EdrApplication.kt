package com.edr.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import com.edr.agent.scheduler.SyncScheduler
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.SyncPreferences

class EdrApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Initialize Preferences
        SyncPreferences.init(this)

        // Create Persistent Notification Channel for Android O+
        createNotificationChannel()

        // Schedule Nightly 11:00 PM Delta Sync via WorkManager
        SyncScheduler.scheduleNightlySync(this)

        // Ensure EDR service starts automatically
        startEdrService()
    }

    private fun startEdrService() {
        try {
            val intent = Intent(this, EdrForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            android.util.Log.e("EdrApp", "Failed starting service from application context: ${e.message}")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "EDR Protection Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors device security and active policies"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "edr_agent_service_channel"
        lateinit var instance: EdrApplication
            private set
    }
}

