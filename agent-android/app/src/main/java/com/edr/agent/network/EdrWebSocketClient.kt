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
        .pingInterval(20, TimeUnit.SECONDS)    // OS-level keepalive ping (prevents Cloudflare/Render drop)
        .build()

    private val gson = Gson()
    private var webSocket: WebSocket? = null
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val mediaExecutor = Executors.newCachedThreadPool()
    private var heartbeatTask: ScheduledFuture<*>? = null
    private var reconnectTask: ScheduledFuture<*>? = null
    private var reconnectAttempt = 0
    private var currentHostInUse = SyncPreferences.serverHost
    private val isDisconnecting = AtomicBoolean(false)
    private val isSocketOpen = AtomicBoolean(false)

    val isConnected: Boolean
        get() = webSocket != null && !isDisconnecting.get() && isSocketOpen.get()

    fun getCandidateHosts(): List<String> {
        return listOf(
            "127.0.0.1",                  // USB ADB reverse tunnel (instant if cable is connected)
            SyncPreferences.serverHost,   // Wi-Fi LAN address (e.g. 192.168.1.6)
            "10.0.2.2"                    // Android emulator host
        ).distinct()
    }

    fun resetDisconnectAndConnect(targetHost: String? = null) {
        isDisconnecting.set(false)
        reconnectAttempt = 0
        val hostToTry = targetHost ?: getCandidateHosts().first()
        connect(hostToTry)
    }

    fun connect(targetHost: String = getCandidateHosts().first()) {
        if (isDisconnecting.get()) return
        try {
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

        val registerMsg = mapOf(
            "type" to "AGENT_REGISTER",
            "deviceId" to SyncPreferences.deviceId,
            "payload" to mapOf(
                "deviceId" to SyncPreferences.deviceId,
                "deviceName" to "${Build.MANUFACTURER} ${Build.MODEL}",
                "osVersion" to "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                "batteryLevel" to battery,
                "isDeviceOwner" to EdrPolicyManager.isDeviceOwner(context),
                "trapAppPackages" to SyncPreferences.getTrapAppPackages().toList()
            ),
            "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
        )
        webSocket.send(gson.toJson(registerMsg))

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

    private fun startHeartbeat() {
        heartbeatTask?.cancel(false)
        // 60 seconds — half the server's 120s timeout window, but saves significant battery vs 30s
        heartbeatTask = scheduler.scheduleAtFixedRate({
            try {
                val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
                val battery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
                val beat = mapOf(
                    "type" to "HEARTBEAT",
                    "deviceId" to SyncPreferences.deviceId,
                    "payload" to mapOf("batteryLevel" to battery),
                    "timestamp" to SyncPreferences.getCurrentIsoTimestamp()
                )
                webSocket?.send(gson.toJson(beat))
            } catch (e: Exception) {
                Log.w(TAG, "Heartbeat failed: ${e.message}")
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
            if (reconnectAttempt == 0) {
                // Fast fallback on initial connection failure: try the alternative host immediately
                reconnectAttempt++
                val candidates = getCandidateHosts()
                val nextHost = candidates[reconnectAttempt % candidates.size]
                Log.i(TAG, "Immediate fallback to candidate host: $nextHost")
                connect(nextHost)
            } else {
                scheduleReconnect()
            }
        }
    }

    /**
     * Reconnect with exponential backoff to save battery when server is unavailable.
     * Delays: 3s, 6s, 12s, 24s, 60s, 60s, 60s... (caps at 60 seconds)
     */
    private fun scheduleReconnect() {
        heartbeatTask?.cancel(false)
        reconnectTask?.cancel(false)

        val delaySeconds = minOf(3L * (1L shl minOf(reconnectAttempt, 4)), 60L)
        Log.d(TAG, "Reconnecting in ${delaySeconds}s (attempt #${reconnectAttempt + 1})")

        reconnectTask = scheduler.schedule({
            reconnectAttempt++
            val candidates = getCandidateHosts()
            val hostToTry = candidates[reconnectAttempt % candidates.size]
            connect(hostToTry)
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
