package com.edr.agent.network

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.telephony.TelephonyManager
import android.util.Log

/**
 * Intelligent Network Classifier and Cloud Upload Policy Engine.
 *
 * Requirements:
 * - 4G (LTE / Cellular 4G) -> DO NOT upload media to cloud; save locked & encrypted locally in /EDR/.
 * - 5G (NR / 5G SA / 5G NSA) -> UPLOAD to cloud allowed.
 * - Wi-Fi (Standard broadband / office / home) -> UPLOAD to cloud allowed.
 * - Hotspot (Connected to portable hotspot / mobile Wi-Fi tethering) -> UPLOAD to cloud allowed.
 * - No Internet / Errors -> Save locally in /EDR/ folder, encrypted & locked with password "prit@312005".
 */
object EdrNetworkManager {

    private const val TAG = "EdrNetworkManager"

    enum class ConnectionType(val wireName: String, val displayName: String, val allowsCloudUpload: Boolean) {
        WIFI("WIFI", "Wi-Fi", true),
        HOTSPOT("HOTSPOT", "Hotspot", true),
        FIVE_G("5G", "5G Mobile", true),
        FOUR_G("4G", "4G LTE", true),
        THREE_G_OR_LESS("3G", "3G/2G Mobile", true),
        NO_INTERNET("NO_INTERNET", "Offline", false)
    }

    data class NetworkStatus(
        val type: ConnectionType,
        val typeName: String,
        val label: String,
        val isCloudUploadAllowed: Boolean,
        val downstreamKbps: Int,
        val networkQuality: String,
        val ssid: String? = null
    )

    /**
     * Inspects current network capabilities, carrier telephony state, and gateway topology
     * to determine the exact connection type.
     */
    fun getNetworkStatus(context: Context): NetworkStatus {
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val activeNetwork = cm?.activeNetwork
            val caps = cm?.getNetworkCapabilities(activeNetwork)

            if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                return NetworkStatus(
                    type = ConnectionType.NO_INTERNET,
                    typeName = ConnectionType.NO_INTERNET.wireName,
                    label = "No Internet Connection",
                    isCloudUploadAllowed = false,
                    downstreamKbps = 0,
                    networkQuality = "SLOW"
                )
            }

            val downstreamKbps = caps.linkDownstreamBandwidthKbps
            val isSlow = downstreamKbps in 1..1500
            val quality = if (isSlow) "SLOW" else "FAST"

            // 1. Check Wi-Fi vs Hotspot
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                val (isHotspot, ssid) = inspectWifiOrHotspot(wm)

                val connType = if (isHotspot) ConnectionType.HOTSPOT else ConnectionType.WIFI
                val label = if (isHotspot) {
                    if (!ssid.isNullOrEmpty()) "Mobile Hotspot ($ssid)" else "Mobile Hotspot"
                } else {
                    if (!ssid.isNullOrEmpty()) "Wi-Fi ($ssid)" else "Wi-Fi Connected"
                }

                return NetworkStatus(
                    type = connType,
                    typeName = connType.wireName,
                    label = label,
                    isCloudUploadAllowed = true,
                    downstreamKbps = downstreamKbps,
                    networkQuality = quality,
                    ssid = ssid
                )
            }

            // 2. Check Cellular (5G vs 4G vs 3G)
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                val cellType = inspectCellularTechnology(context, caps)
                val label = when (cellType) {
                    ConnectionType.FIVE_G -> "5G High Speed (Uploads Enabled)"
                    ConnectionType.FOUR_G -> "4G LTE (Uploads Enabled)"
                    else -> "Cellular Network (Uploads Enabled)"
                }

                return NetworkStatus(
                    type = cellType,
                    typeName = cellType.wireName,
                    label = label,
                    isCloudUploadAllowed = cellType.allowsCloudUpload,
                    downstreamKbps = downstreamKbps,
                    networkQuality = quality
                )
            }

            // 3. Ethernet / Other
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                return NetworkStatus(
                    type = ConnectionType.WIFI,
                    typeName = "ETHERNET",
                    label = "Ethernet LAN",
                    isCloudUploadAllowed = true,
                    downstreamKbps = downstreamKbps,
                    networkQuality = "FAST"
                )
            }

            // Default fallback
            return NetworkStatus(
                type = ConnectionType.FOUR_G,
                typeName = "4G",
                label = "Cellular Network (Uploads Paused)",
                isCloudUploadAllowed = false,
                downstreamKbps = downstreamKbps,
                networkQuality = quality
            )
        } catch (e: Exception) {
            Log.w(TAG, "Error determining network status: ${e.message}")
            return NetworkStatus(
                type = ConnectionType.FOUR_G,
                typeName = "4G",
                label = "Network (Uploads Paused)",
                isCloudUploadAllowed = false,
                downstreamKbps = 0,
                networkQuality = "SLOW"
            )
        }
    }

    /**
     * Quick policy check: can media files (recordings/photos) be uploaded to cloud?
     */
    fun isCloudUploadAllowed(context: Context): Boolean {
        return getNetworkStatus(context).isCloudUploadAllowed
    }

    /**
     * Human-friendly label for logs and UI.
     */
    fun getConnectionTypeLabel(context: Context): String {
        return getNetworkStatus(context).label
    }

    /**
     * Wire name for dashboard communication (5G, 4G, WIFI, HOTSPOT, NO_INTERNET).
     */
    fun getWireNetworkType(context: Context): String {
        return getNetworkStatus(context).typeName
    }

    /**
     * Inspects Wi-Fi connection to identify if it is a mobile phone portable hotspot.
     * Hotspots commonly use default gateway subnets (192.168.43.1 on Android, 172.20.10.1 on iOS, 192.168.137.1 on Windows),
     * or distinct hotspot SSIDs.
     */
    private fun inspectWifiOrHotspot(wm: WifiManager?): Pair<Boolean, String?> {
        if (wm == null) return Pair(false, null)
        try {
            val info = wm.connectionInfo
            var ssid: String? = null
            if (info != null && info.ssid != null && info.ssid != "<unknown ssid>") {
                ssid = info.ssid.replace("\"", "").trim()
            }

            val dhcp = wm.dhcpInfo
            val gatewayIp = if (dhcp != null && dhcp.gateway != 0) {
                String.format(
                    "%d.%d.%d.%d",
                    dhcp.gateway and 0xff,
                    dhcp.gateway shr 8 and 0xff,
                    dhcp.gateway shr 16 and 0xff,
                    dhcp.gateway shr 24 and 0xff
                )
            } else ""

            val isKnownHotspotGateway = gatewayIp in listOf(
                "192.168.43.1",  // Standard Android portable hotspot default
                "192.168.44.1",  // Secondary Android hotspot subnet
                "192.168.49.1",  // Wi-Fi Direct hotspot
                "172.20.10.1",   // Apple iPhone / iPad Personal Hotspot default
                "192.168.137.1"  // Windows 10/11 Mobile Hotspot default
            )

            val lowerSsid = ssid?.lowercase() ?: ""
            val isHotspotName = lowerSsid.contains("hotspot") ||
                lowerSsid.contains("iphone") ||
                lowerSsid.contains("androidap") ||
                lowerSsid.contains("portable") ||
                lowerSsid.contains("jiofi") ||
                lowerSsid.contains("airtel 4g") ||
                lowerSsid.contains("galaxy ")

            val isHotspot = isKnownHotspotGateway || isHotspotName
            return Pair(isHotspot, ssid)
        } catch (e: Exception) {
            return Pair(false, null)
        }
    }

    /**
     * Inspects cellular radio technology to distinguish 5G NR from 4G LTE and older 3G/2G.
     */
    @SuppressLint("MissingPermission")
    private fun inspectCellularTechnology(context: Context, caps: NetworkCapabilities): ConnectionType {
        try {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            val dataNetType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    tm?.dataNetworkType ?: TelephonyManager.NETWORK_TYPE_UNKNOWN
                } catch (_: SecurityException) {
                    TelephonyManager.NETWORK_TYPE_UNKNOWN
                }
            } else {
                TelephonyManager.NETWORK_TYPE_UNKNOWN
            }

            // 1. Direct 5G NR identification (NETWORK_TYPE_NR = 20)
            if (dataNetType == 20) {
                return ConnectionType.FIVE_G
            }

            // 2. High downstream bandwidth typical of 5G (> 80,000 Kbps = 80 Mbps)
            if (caps.linkDownstreamBandwidthKbps >= 80_000) {
                return ConnectionType.FIVE_G
            }

            // 3. 4G LTE check (NETWORK_TYPE_LTE = 13)
            if (dataNetType == TelephonyManager.NETWORK_TYPE_LTE ||
                dataNetType == TelephonyManager.NETWORK_TYPE_UNKNOWN ||
                caps.linkDownstreamBandwidthKbps > 5000
            ) {
                return ConnectionType.FOUR_G
            }

            // 4. Slower legacy networks (3G / 2G)
            return ConnectionType.THREE_G_OR_LESS
        } catch (e: Exception) {
            return ConnectionType.FOUR_G
        }
    }
}
