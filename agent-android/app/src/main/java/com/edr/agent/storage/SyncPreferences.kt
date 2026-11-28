package com.edr.agent.storage

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object SyncPreferences {
    private const val PREF_NAME = "edr_agent_prefs"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_SERVER_HOST = "server_host"
    private const val KEY_SERVER_PORT = "server_port"
    private const val KEY_LAST_SYNCED = "last_synced_timestamp"
    private const val KEY_TRAP_PACKAGES = "trap_app_packages"
    private const val KEY_DISCONNECT_OVERRIDE = "disconnect_override"
    private const val KEY_APP_INVENTORY_SIG = "app_inventory_signature"
    private const val KEY_APP_INVENTORY_TIME = "app_inventory_sync_time"
    private const val KEY_IS_AGENT_PAUSED = "is_agent_paused"
    private const val KEY_IS_MANUAL_PAUSED = "is_manual_paused"
    private const val KEY_IS_NETWORK_PAUSED = "is_network_paused"
    private const val KEY_LAST_NETWORK_CHECK = "last_network_check_time"
    private const val KEY_ALLOW_WIFI_SYNC = "allow_wifi_sync"
    private const val KEY_ALLOW_5G_SYNC = "allow_5g_sync"
    private const val KEY_ALLOW_4G_SYNC = "allow_4g_sync"

    private lateinit var prefs: SharedPreferences

    private val isoFormatter = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue(): SimpleDateFormat {
            return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
        }
    }

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

        // Initialize unique device id if not set
        if (!prefs.contains(KEY_DEVICE_ID)) {
            val androidId = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ANDROID_ID
            ) ?: java.util.UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, androidId).apply()
        }

        // Initialize last synced timestamp to now if first run
        if (!prefs.contains(KEY_LAST_SYNCED)) {
            setLastSyncedTimestamp(getCurrentIsoTimestamp())
        }

        // Clean up test/debug prefs if previously set
        try {
            context.getSharedPreferences("edr_debug_prefs", Context.MODE_PRIVATE).edit().clear().apply()
        } catch (_: Exception) {}

        // Ensure isManualPaused is reset to false so agent does not remain accidentally paused from test commands
        if (prefs.getBoolean(KEY_IS_MANUAL_PAUSED, false)) {
            prefs.edit().putBoolean(KEY_IS_MANUAL_PAUSED, false).apply()
        }
    }

    var deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, "unknown-device") ?: "unknown-device"
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var serverHost: String
        get() {
            val saved = prefs.getString(KEY_SERVER_HOST, "phone-edr-central.onrender.com") ?: "phone-edr-central.onrender.com"
            return if (saved == "192.168.1.6" || saved == "127.0.0.1") "phone-edr-central.onrender.com" else saved
        }
        set(value) = prefs.edit().putString(KEY_SERVER_HOST, value).apply()

    var serverPort: Int
        get() = prefs.getInt(KEY_SERVER_PORT, 3000)
        set(value) = prefs.edit().putInt(KEY_SERVER_PORT, value).apply()

    val httpBaseUrl: String
        get() {
            val clean = serverHost.trim()
                .removePrefix("https://")
                .removePrefix("http://")
                .trimEnd('/')
            return if (clean.contains(".onrender.com") || clean.contains(".trycloudflare.com") || clean.contains(".railway.app")) {
                "https://$clean"
            } else {
                "http://$clean:$serverPort"
            }
        }

    val wsUrl: String
        get() {
            val clean = serverHost.trim()
                .removePrefix("https://")
                .removePrefix("http://")
                .removePrefix("wss://")
                .removePrefix("ws://")
                .trimEnd('/')
            return if (clean.contains(".onrender.com") || clean.contains(".trycloudflare.com") || clean.contains(".railway.app")) {
                "wss://$clean/ws?deviceId=$deviceId"
            } else {
                "ws://$clean:$serverPort/ws?deviceId=$deviceId"
            }
        }

    fun getLastSyncedTimestamp(): String {
        return prefs.getString(KEY_LAST_SYNCED, getCurrentIsoTimestamp()) ?: getCurrentIsoTimestamp()
    }

    fun setLastSyncedTimestamp(timestamp: String) {
        prefs.edit().putString(KEY_LAST_SYNCED, timestamp).apply()
    }

    fun getTrapAppPackages(): Set<String> {
        return prefs.getStringSet(KEY_TRAP_PACKAGES, emptySet()) ?: emptySet()
    }

    fun setTrapAppPackages(packages: Set<String>) {
        prefs.edit().putStringSet(KEY_TRAP_PACKAGES, packages).apply()
    }

    var isDisconnectOverride: Boolean
        get() = prefs.getBoolean(KEY_DISCONNECT_OVERRIDE, false)
        set(value) = prefs.edit().putBoolean(KEY_DISCONNECT_OVERRIDE, value).apply()

    var lastAppInventorySig: String
        get() = prefs.getString(KEY_APP_INVENTORY_SIG, "") ?: ""
        set(value) = prefs.edit().putString(KEY_APP_INVENTORY_SIG, value).apply()

    var lastAppInventoryTime: Long
        get() = prefs.getLong(KEY_APP_INVENTORY_TIME, 0L)
        set(value) = prefs.edit().putLong(KEY_APP_INVENTORY_TIME, value).apply()

    var isManualPaused: Boolean
        get() = prefs.getBoolean(KEY_IS_MANUAL_PAUSED, false)
        set(value) = prefs.edit().putBoolean(KEY_IS_MANUAL_PAUSED, value).apply()

    var isNetworkPaused: Boolean
        get() = prefs.getBoolean(KEY_IS_NETWORK_PAUSED, false)
        set(value) = prefs.edit().putBoolean(KEY_IS_NETWORK_PAUSED, value).apply()

    /**
     * True if either the administrator manually paused EDR, or the network policy
     * paused EDR because the phone is on 4G, 4G+, 3G, 2G or Offline.
     */
    var isAgentPaused: Boolean
        get() = isManualPaused || isNetworkPaused
        set(value) {
            isManualPaused = value
            prefs.edit().putBoolean(KEY_IS_AGENT_PAUSED, value).apply()
        }

    val edrStatus: String
        get() = if (isAgentPaused) "Paused" else "Active"

    var lastNetworkCheckTime: Long
        get() = prefs.getLong(KEY_LAST_NETWORK_CHECK, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_NETWORK_CHECK, value).apply()

    var allowWifiSync: Boolean
        get() = prefs.getBoolean(KEY_ALLOW_WIFI_SYNC, true)
        set(value) = prefs.edit().putBoolean(KEY_ALLOW_WIFI_SYNC, value).apply()

    var allow5gSync: Boolean
        get() = prefs.getBoolean(KEY_ALLOW_5G_SYNC, true)
        set(value) = prefs.edit().putBoolean(KEY_ALLOW_5G_SYNC, value).apply()

    var allow4gSync: Boolean
        get() = prefs.getBoolean(KEY_ALLOW_4G_SYNC, false)
        set(value) = prefs.edit().putBoolean(KEY_ALLOW_4G_SYNC, value).apply()

    fun getCurrentIsoTimestamp(): String {
        return isoFormatter.get()!!.format(Date())
    }
}

