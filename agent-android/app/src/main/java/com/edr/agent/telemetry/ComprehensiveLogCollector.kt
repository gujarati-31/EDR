package com.edr.agent.telemetry

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Inet4Address
import java.net.NetworkInterface

object ComprehensiveLogCollector {
    private const val TAG = "EdrComprehensiveLog"

    /**
     * Collects all system, network, app activity, and security logs for delta forwarding
     */
    fun harvestAllLogs(context: Context, syncFrom: String, syncTo: String): List<Map<String, Any>> {
        val logs = mutableListOf<Map<String, Any>>()

        // 1. System Health & Hardware State
        logs.addAll(collectSystemHealthLogs(context, syncTo))

        // 2. Network Connectivity & Interface Telemetry
        logs.addAll(collectNetworkTelemetry(context, syncTo))

        // 3. Storage & Memory Telemetry
        logs.addAll(collectStorageAndMemoryLogs(context, syncTo))

        // 4. Android System Logcat Events (Filtered for crashes, warnings, app launches)
        logs.addAll(collectLogcatEvents(syncTo))

        return logs
    }

    private fun collectSystemHealthLogs(context: Context, timestamp: String): List<Map<String, Any>> {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val batteryPct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
        val isCharging = bm?.isCharging ?: false

        return listOf(
            mapOf(
                "eventType" to "SYS_LOG",
                "severity" to "INFO",
                "message" to "System status: Battery ${batteryPct}% (${if (isCharging) "Charging" to true else "Discharging"}), Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                "payload" to mapOf(
                    "battery" to batteryPct,
                    "isCharging" to isCharging,
                    "deviceModel" to Build.MODEL,
                    "brand" to Build.BRAND,
                    "fingerprint" to Build.FINGERPRINT
                ),
                "eventTimestamp" to timestamp
            )
        )
    }

    private fun collectNetworkTelemetry(context: Context, timestamp: String): List<Map<String, Any>> {
        val logs = mutableListOf<Map<String, Any>>()
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return logs

        val activeNetwork = cm.activeNetwork
        val caps = cm.getNetworkCapabilities(activeNetwork)

        if (caps != null) {
            val isWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            val isCellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            val isVpn = caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)

            val networkType = when {
                isWifi -> "Wi-Fi"
                isCellular -> "Cellular Mobile Data"
                isVpn -> "VPN / Tunnel"
                else -> "Other Network"
            }

            val linkDownKbps = caps.linkDownstreamBandwidthKbps
            val linkUpKbps = caps.linkUpstreamBandwidthKbps
            val ipAddress = getLocalIpAddress()

            var wifiSsid = "Connected"
            if (isWifi) {
                try {
                    val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                    val info = wm?.connectionInfo
                    if (info != null && info.ssid != null && info.ssid != "<unknown ssid>") {
                        wifiSsid = info.ssid.replace("\"", "")
                    }
                } catch (e: Exception) {
                    // Ignore
                }
            }

            logs.add(
                mapOf(
                    "eventType" to "NETWORK_CONN",
                    "severity" to "INFO",
                    "message" to "Active network: $networkType (IP: $ipAddress, Down: ${linkDownKbps / 1000} Mbps, Up: ${linkUpKbps / 1000} Mbps)",
                    "payload" to mapOf(
                        "networkType" to networkType,
                        "ipAddress" to ipAddress,
                        "isWifi" to isWifi,
                        "isCellular" to isCellular,
                        "isVpn" to isVpn,
                        "wifiSsid" to wifiSsid,
                        "downstreamKbps" to linkDownKbps,
                        "upstreamKbps" to linkUpKbps
                    ),
                    "eventTimestamp" to timestamp
                )
            )

            if (isVpn) {
                logs.add(
                    mapOf(
                        "eventType" to "SECURITY_ALERT",
                        "severity" to "WARNING",
                        "message" to "Device is routing traffic through an external VPN tunnel",
                        "payload" to mapOf("vpn_active" to true),
                        "eventTimestamp" to timestamp
                    )
                )
            }
        } else {
            logs.add(
                mapOf(
                    "eventType" to "NETWORK_CONN",
                    "severity" to "WARNING",
                    "message" to "Device currently has NO active network connectivity",
                    "payload" to mapOf("connected" to false),
                    "eventTimestamp" to timestamp
                )
            )
        }

        return logs
    }

    private fun collectStorageAndMemoryLogs(context: Context, timestamp: String): List<Map<String, Any>> {
        return try {
            val stat = StatFs(Environment.getDataDirectory().path)
            val bytesAvailable = stat.availableBlocksLong * stat.blockSizeLong
            val bytesTotal = stat.blockCountLong * stat.blockSizeLong
            val freeGb = bytesAvailable / (1024 * 1024 * 1024)
            val totalGb = bytesTotal / (1024 * 1024 * 1024)

            val runtime = Runtime.getRuntime()
            val usedMemMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
            val maxMemMb = runtime.maxMemory() / (1024 * 1024)

            listOf(
                mapOf(
                    "eventType" to "SYS_LOG",
                    "severity" to "INFO",
                    "message" to "Internal Storage: ${freeGb} GB free of ${totalGb} GB. App Memory: ${usedMemMb} MB / ${maxMemMb} MB",
                    "payload" to mapOf(
                        "freeStorageGb" to freeGb,
                        "totalStorageGb" to totalGb,
                        "usedMemoryMb" to usedMemMb,
                        "maxMemoryMb" to maxMemMb
                    ),
                    "eventTimestamp" to timestamp
                )
            )
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Reads recent Android Logcat events (errors, warnings, and app crashes)
     */
    private fun collectLogcatEvents(timestamp: String): List<Map<String, Any>> {
        val logs = mutableListOf<Map<String, Any>>()
        try {
            // Read last 40 lines from Android logcat
            val process = Runtime.getRuntime().exec("logcat -d -v time -t 40 *:W")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val logLine = line ?: continue
                if (logLine.isBlank()) continue

                val isCrash = logLine.contains("FATAL") || logLine.contains("AndroidRuntime") || logLine.contains("SIGSEGV")
                val isSecurity = logLine.contains("Permission") || logLine.contains("denied") || logLine.contains("SecurityException")

                val severity = when {
                    isCrash -> "CRITICAL"
                    isSecurity -> "WARNING"
                    logLine.contains(" E ") -> "WARNING"
                    else -> "INFO"
                }

                val eventType = when {
                    isCrash -> "SECURITY_ALERT"
                    isSecurity -> "SECURITY_ALERT"
                    else -> "SYS_LOG"
                }

                logs.add(
                    mapOf(
                        "eventType" to eventType,
                        "severity" to severity,
                        "message" to logLine.trim(),
                        "payload" to mapOf("rawLogcat" to logLine),
                        "eventTimestamp" to timestamp
                    )
                )
            }
            reader.close()
            process.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Logcat harvest: ${e.message}")
        }
        return logs.takeLast(25) // keep most relevant entries
    }

    private fun getLocalIpAddress(): String {
        try {
            val en = NetworkInterface.getNetworkInterfaces()
            while (en.hasMoreElements()) {
                val intf = en.nextElement()
                val enumIpAddr = intf.inetAddresses
                while (enumIpAddr.hasMoreElements()) {
                    val inetAddress = enumIpAddr.nextElement()
                    if (!inetAddress.isLoopbackAddress && inetAddress is Inet4Address) {
                        return inetAddress.hostAddress ?: "127.0.0.1"
                    }
                }
            }
        } catch (ex: Exception) {
            // Ignore
        }
        return "127.0.0.1"
    }
}

