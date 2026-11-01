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

    private lateinit var prefs: SharedPreferences

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

    fun getCurrentIsoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}

