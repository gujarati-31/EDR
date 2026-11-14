package com.edr.agent.service

import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.edr.agent.EdrApplication
import com.edr.agent.monitor.TrapAppMonitor
import com.edr.agent.network.EdrHttpClient
import com.edr.agent.network.EdrWebSocketClient
import com.edr.agent.screen.AppTrapScreenRecorder
import com.edr.agent.storage.SyncPreferences
import okhttp3.Request
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class EdrForegroundService : Service() {

    private var wsClient: EdrWebSocketClient? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var screenReceiver: BroadcastReceiver? = null

    private val pollClient = EdrHttpClient.pollClient

    private val monitorScheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var trapFallbackFuture: ScheduledFuture<*>? = null
    private var connectionPollFuture: ScheduledFuture<*>? = null
    @Volatile
    private var isScreenInteractive = true
    @Volatile
    private var lastPollAttemptTime = 0L

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Starting EDR Endpoint Protection Service v3.0 (Battery Optimized)")

        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        isScreenInteractive = pm?.isInteractive ?: true

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

        // Monitor Screen ON / OFF so background pollers sleep completely when screen is off
        registerScreenStateReceiver()

        // Register system network callback for immediate reconnect when internet returns
        registerNetworkCallback()

        // Connect to EDR management server
        wsClient = EdrWebSocketClient(this)
        wsClient?.connect()

        // Start fallback pollers ONLY if currently needed
        updateTrapFallbackSchedule()
        scheduleNextConnectionPoll(delayMs = 4000L)

        // Retry and upload any pending offline locked recordings & clean up old trashed files
        AppTrapScreenRecorder.flushPendingLockedRecordings(this)
    }

    private fun registerScreenStateReceiver() {
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            }
            screenReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent?) {
                    when (intent?.action) {
                        Intent.ACTION_SCREEN_ON -> {
                            isScreenInteractive = true
                            updateTrapFallbackSchedule()
                            val client = wsClient
                            if (client == null || !client.isConnected) {
                                // Fast responsiveness when user unlocks / admin tests "Connect Phone"
                                scheduleNextConnectionPoll(delayMs = 500L)
                            }
                        }
                        Intent.ACTION_SCREEN_OFF -> {
                            isScreenInteractive = false
                            // If user locked phone or screen turned off during a trap recording, finalize it cleanly
                            if (AppTrapScreenRecorder.isCurrentlyRecording()) {
                                Log.i(TAG, "Screen turned OFF. Finalizing active trap recording cleanly.")
                                AppTrapScreenRecorder.stopRecording(this@EdrForegroundService)
                            }
                            // Cancel UsageStats fallback poller completely while screen is off
                            updateTrapFallbackSchedule()
                        }
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(screenReceiver, filter)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not register screen state receiver: ${e.message}")
        }
    }

    fun onWebSocketStateChanged(connected: Boolean) {
        if (connected) {
            connectionPollFuture?.cancel(false)
            connectionPollFuture = null
            // Connected to admin gateway: flush any offline locked recordings
            AppTrapScreenRecorder.flushPendingLockedRecordings(this)
        } else {
            val delay = if (isScreenInteractive) 8_000L else 45_000L
            scheduleNextConnectionPoll(delayMs = delay)
        }
    }

    @Synchronized
    fun updateTrapFallbackSchedule() {
        val shouldPollTrap = isScreenInteractive &&
            !EdrAccessibilityService.isReady &&
            TrapAppMonitor.hasActiveTrapsOrRecording()

        if (!shouldPollTrap) {
            trapFallbackFuture?.cancel(false)
            trapFallbackFuture = null
            return
        }

        if (trapFallbackFuture == null || trapFallbackFuture!!.isCancelled || trapFallbackFuture!!.isDone) {
            trapFallbackFuture = monitorScheduler.scheduleWithFixedDelay({
                try {
                    if (!isScreenInteractive || EdrAccessibilityService.isReady || !TrapAppMonitor.hasActiveTrapsOrRecording()) {
                        updateTrapFallbackSchedule()
                        return@scheduleWithFixedDelay
                    }
                    TrapAppMonitor.checkForegroundApp(this)
                } catch (e: Exception) {
                    Log.w(TAG, "TrapAppMonitor check error: ${e.message}")
                }
            }, 8L, 8L, TimeUnit.SECONDS)
        }
    }

    @Synchronized
    private fun scheduleNextConnectionPoll(delayMs: Long) {
        connectionPollFuture?.cancel(false)
        val client = wsClient
        if (client != null && client.isConnected) {
            connectionPollFuture = null
            return
        }
        connectionPollFuture = monitorScheduler.schedule({
            try {
                val curClient = wsClient
                if (curClient != null && curClient.isConnected) {
                    return@schedule
                }
                if (hasValidatedInternet()) {
                    val now = System.currentTimeMillis()
                    if (now - lastPollAttemptTime >= 2000L) {
                        lastPollAttemptTime = now
                        checkServerConnectionRequest()
                    }
                    // Reschedule only if still disconnected and network exists
                    val stillDisconnected = wsClient?.isConnected != true
                    if (stillDisconnected) {
                        val nextDelay = if (isScreenInteractive) 8_000L else 45_000L
                        scheduleNextConnectionPoll(nextDelay)
                    }
                } else {
                    // No internet: do NOT burn CPU/radio polling; NetworkCallback.onAvailable wakes us instantly!
                    connectionPollFuture = null
                }
            } catch (_: Exception) {
                if (wsClient?.isConnected != true && hasValidatedInternet()) {
                    val nextDelay = if (isScreenInteractive) 15_000L else 60_000L
                    scheduleNextConnectionPoll(nextDelay)
                }
            }
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun hasValidatedInternet(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
            val net = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(net) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        } catch (_: Exception) {
            false
        }
    }

    private fun registerNetworkCallback() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "Internet network detected as AVAILABLE.")
                    val client = wsClient
                    if (client == null || !client.isConnected) {
                        scheduleNextConnectionPoll(delayMs = 500L)
                    }
                    AppTrapScreenRecorder.flushPendingLockedRecordings(this@EdrForegroundService)
                }
            }
            cm.registerNetworkCallback(request, networkCallback!!)
            Log.i(TAG, "Registered network callback for live connectivity detection.")
        } catch (e: Exception) {
            Log.w(TAG, "Could not register network callback: ${e.message}")
        }
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
        if (intent?.action == "com.edr.agent.ACTION_RECONNECT") {
            reconnectWebSocket()
        }
        return START_STICKY
    }

    fun isWebSocketConnected(): Boolean = wsClient?.isConnected == true

    fun sendWebSocketMessage(msg: String): Boolean {
        return wsClient?.send(msg) ?: false
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
        try {
            screenReceiver?.let { unregisterReceiver(it) }
        } catch (ignored: Exception) {}
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            networkCallback?.let { cm?.unregisterNetworkCallback(it) }
        } catch (ignored: Exception) {}
        trapFallbackFuture?.cancel(true)
        connectionPollFuture?.cancel(true)
        monitorScheduler.shutdownNow()
        wsClient?.shutdown()
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
