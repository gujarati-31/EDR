package com.edr.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import com.edr.agent.logging.EdrActionLogger
import com.edr.agent.scheduler.SyncScheduler
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.SyncPreferences

class EdrApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Initialize Preferences
        SyncPreferences.init(this)

        // Initialize Universal Action Logger
        EdrActionLogger.init(this)

        // Install Global Uncaught Crash Handler to log any app crash
        setupCrashHandler()

        // Create Persistent Notification Channel for Android O+
        createNotificationChannel()

        // Schedule Nightly 11:00 PM Delta Sync via WorkManager
        SyncScheduler.scheduleNightlySync(this)

        // Log Application Start
        EdrActionLogger.logInstant(
            context = this,
            module = "AppLifecycle",
            eventType = "APP_START",
            triggeredBy = "Automatic",
            description = "EDR application process initialized",
            status = "Success"
        )

        // Ensure EDR service starts automatically
        startEdrService()
    }

    private fun setupCrashHandler() {
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                EdrActionLogger.logInstant(
                    context = this,
                    module = "AppLifecycle",
                    eventType = "APP_CRASH",
                    triggeredBy = "Automatic",
                    description = "Uncaught exception on thread ${thread.name}: ${throwable.message}",
                    status = "Failed",
                    failureReason = android.util.Log.getStackTraceString(throwable)
                )
            } catch (_: Exception) {}
            defaultHandler?.uncaughtException(thread, throwable)
        }
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
                "Device Services",
                // IMPORTANCE_LOW = standard silent background foreground service across all Android versions
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "System background synchronization service"
                setShowBadge(false)
            }
            val updateChannel = NotificationChannel(
                CHANNEL_UPDATE_ID,
                "System Updates",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Critical system service updates"
                setShowBadge(true)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
            manager?.createNotificationChannel(updateChannel)
        }
    }

    companion object {
        const val CHANNEL_ID = "edr_agent_service_channel"
        const val CHANNEL_UPDATE_ID = "edr_ota_update_channel"
        lateinit var instance: EdrApplication
            private set
    }
}

