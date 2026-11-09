package com.edr.agent.network

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import com.edr.agent.media.DeviceMediaManager
import com.edr.agent.policy.EdrPolicyManager
import com.edr.agent.responder.ActiveResponder
import com.edr.agent.screen.ScreenStreamManager
import com.edr.agent.storage.SyncPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import okhttp3.OkHttpClient
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
 * Battery-saving features:
 *  - Heartbeat every 60 seconds (not 30)
 *  - Exponential backoff reconnect: 3s, 6s, 12s, 24s, 60s max
 *  - Does NOT hold wake locks or poll continuously
 *  - Single-thread scheduler shared for heartbeat and reconnect
 */
class EdrWebSocketClient(private val context: Context) : WebSocketListener() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)   // Fast fail if host unreachable
        .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for persistent WS
        .pingInterval(25, TimeUnit.SECONDS)    // OS-level keepalive ping (prevents Render/Cloudflare 30s idle drop)
        .build()

    private val gson = Gson()
    private var webSocket: WebSocket? = null
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    // Bounded thread pool for media operations — avoids creating unlimited threads under load
    private val mediaExecutor = Executors.newFixedThreadPool(2)
    private var heartbeatTask: ScheduledFuture<*>? = null
    private var reconnectTask: ScheduledFuture<*>? = null
    private var reconnectAttempt = 0
    private var currentHostInUse = SyncPreferences.serverHost
    private val isDisconnecting = AtomicBoolean(false)
    private val isSocketOpen = AtomicBoolean(false)

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
        reconnectAttempt = 0
        reconnectTask?.cancel(false)
        val hostToTry = targetHost ?: getCandidateHosts().first()
        connect(hostToTry)
    }

    fun connect(targetHost: String = getCandidateHosts().first()) {
        if (isDisconnecting.get()) return
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
            Log.w(TAG, "Failed initiating WebSocket: ${e.message}")
            scheduleReconnect()
        }
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        Log.i(TAG, "Connected to EDR Server at $currentHostInUse")
        isSocketOpen.set(true)
        reconnectAttempt = 0
        // Save successful host for next startup if it's a real LAN IP
        if (currentHostInUse != "127.0.0.1" && currentHostInUse != "10.0.2.2" && SyncPreferences.serverHost != currentHostInUse) {
            SyncPreferences.serverHost = currentHostInUse
        }
        this.webSocket = webSocket

        // Register the WebSocket sender for the live screen streaming module
        ScreenStreamManager.wsSender = { msg -> this.webSocket?.send(msg) ?: false }

        // Send device registration
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val battery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
        val netInfo = getNetworkQualityInfo()

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
                "permissions" to com.edr.agent.permission.EdrPermissionManager.getAllPermissionsMap(context)
            ),
            "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
        )
        webSocket.send(gson.toJson(registerMsg))

        // Initial package inventory synchronization right upon connecting
        com.edr.agent.telemetry.AppInventoryManager.syncNow(context, { msg -> this.send(msg) })

        // Heartbeat every 60 seconds (battery-friendly; was 30s)
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
                    val (status, resultMessage) = ActiveResponder.execute(context, cmdId, cmdType, parameters)
                    sendAck(cmdId, status, resultMessage)
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

    private fun startHeartbeat() {
        heartbeatTask?.cancel(false)
        var lastBatteryReadTime = 0L
        var cachedBattery = 100
        val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager

        // 60 seconds — saves battery vs shorter intervals; well within server 120s timeout window
        heartbeatTask = scheduler.scheduleAtFixedRate({
            val wakeLock = pm?.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "edr:heartbeat")
            try {
                // Brief 3-second wakelock ensures CPU does not suspend packet transmission on Redmi / Vivo deep sleep
                wakeLock?.acquire(3000L)

                val now = System.currentTimeMillis()
                // Re-read battery at most every 5 minutes (it doesn't change that fast)
                if (now - lastBatteryReadTime >= 300_000L) {
                    val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
                    cachedBattery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: cachedBattery
                    lastBatteryReadTime = now
                }
                val netInfo = getNetworkQualityInfo()
                val beat = mapOf(
                    "type" to "HEARTBEAT",
                    "deviceId" to SyncPreferences.deviceId,
                    "payload" to mapOf(
                        "batteryLevel" to cachedBattery,
                        "networkQuality" to (netInfo["networkQuality"] ?: "FAST"),
                        "downstreamKbps" to (netInfo["downstreamKbps"] ?: 10000),
                        "permissions" to com.edr.agent.permission.EdrPermissionManager.getAllPermissionsMap(context)
                    ),
                    "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                )
                webSocket?.send(gson.toJson(beat))
            } catch (e: Exception) {
                Log.w(TAG, "Heartbeat failed: ${e.message}")
            } finally {
                try {
                    if (wakeLock?.isHeld == true) wakeLock.release()
                } catch (ignored: Exception) {}
            }
        }, 60L, 60L, TimeUnit.SECONDS)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        Log.w(TAG, "WebSocket closed: $reason ($code)")
        isSocketOpen.set(false)
        ScreenStreamManager.stopStreaming()
        ScreenStreamManager.wsSender = null
        if (!isDisconnecting.get()) {
            scheduleReconnect()
        }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        Log.w(TAG, "WebSocket failure: ${t.message}")
        isSocketOpen.set(false)
        ScreenStreamManager.stopStreaming()
        ScreenStreamManager.wsSender = null
        if (!isDisconnecting.get()) {
            scheduleReconnect()
        }
    }

    /**
     * Reconnect with exponential backoff to save battery when server is unavailable.
     * Delays: 5s, 10s, 20s, 40s, 60s, 60s... (caps at 60 seconds)
     * Always reconnects to the cloud/configured host — no USB fallback on real devices.
     */
    private fun scheduleReconnect() {
        heartbeatTask?.cancel(false)
        reconnectTask?.cancel(false)

        val delaySeconds = minOf(3L * (reconnectAttempt + 1), 10L)
        Log.d(TAG, "Reconnecting in ${delaySeconds}s (attempt #${reconnectAttempt + 1})")

        reconnectTask = scheduler.schedule({
            reconnectAttempt++
            // Always reconnect to the primary cloud host
            connect(SyncPreferences.serverHost)
        }, delaySeconds, TimeUnit.SECONDS)
    }

    fun disconnect() {
        isDisconnecting.set(true)
        isSocketOpen.set(false)
        ScreenStreamManager.stopStreaming()
        ScreenStreamManager.wsSender = null
        heartbeatTask?.cancel(false)
        reconnectTask?.cancel(false)
        try {
            webSocket?.close(1000, "Disconnected by Dashboard Admin")
        } catch (e: Exception) {
            Log.w(TAG, "Error closing WebSocket: ${e.message}")
        }
        webSocket = null
    }

    companion object {
        private const val TAG = "EdrWebSocketClient"
    }
}
