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

    @Volatile
    var cachedOverrideNetworkType: Int = 0
    private var isTelephonyListenerRegistered = false

    fun registerTelephonyListener(context: Context) {
        if (isTelephonyListenerRegistered) return
        try {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val executor = androidx.core.content.ContextCompat.getMainExecutor(context)
                tm.registerTelephonyCallback(executor, object : android.telephony.TelephonyCallback(), android.telephony.TelephonyCallback.DisplayInfoListener {
                    override fun onDisplayInfoChanged(telephonyDisplayInfo: android.telephony.TelephonyDisplayInfo) {
                        cachedOverrideNetworkType = telephonyDisplayInfo.overrideNetworkType
                        Log.d(TAG, "TelephonyDisplayInfo overrideNetworkType: $cachedOverrideNetworkType")
                    }
                })
                isTelephonyListenerRegistered = true
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                @Suppress("DEPRECATION")
                tm.listen(object : android.telephony.PhoneStateListener() {
                    @Deprecated("Deprecated in Java")
                    override fun onDisplayInfoChanged(telephonyDisplayInfo: android.telephony.TelephonyDisplayInfo) {
                        cachedOverrideNetworkType = telephonyDisplayInfo.overrideNetworkType
                        Log.d(TAG, "TelephonyDisplayInfo overrideNetworkType: $cachedOverrideNetworkType")
                    }
                }, android.telephony.PhoneStateListener.LISTEN_DISPLAY_INFO_CHANGED)
                isTelephonyListenerRegistered = true
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not register TelephonyDisplayInfo listener: ${e.message}")
        }
    }

    enum class ConnectionType(val wireName: String, val displayName: String, val shouldWorkNormally: Boolean) {
        FIVE_G("5G", "5G", true),
        WIFI("WiFi", "WiFi", true),
        HOTSPOT("Hotspot", "Hotspot", true),
        FOUR_G_PLUS("4G+", "4G+", false),
        FOUR_G("4G", "4G", false),
        THREE_G("3G", "3G", false),
        TWO_G("2G", "2G", false),
        OFFLINE("Offline", "Offline", false)
    }

    data class NetworkStatus(
        val type: ConnectionType,
        val typeName: String,
        val label: String,
        val isCloudUploadAllowed: Boolean,
        val shouldWorkNormally: Boolean,
        val downstreamKbps: Int,
        val networkQuality: String,
        val ssid: String? = null
    )

    /**
     * Checks whether EDR should work normally or stop all background activity.
     * 5G, WiFi, Hotspot -> true (Work normally)
     * 4G, 4G+, 3G, 2G, Offline -> false (Stop all background activity)
     */
    fun shouldWorkNormally(type: ConnectionType): Boolean = type.shouldWorkNormally

    /**
     * Inspects current network capabilities, carrier telephony state, and gateway topology
     * to determine the exact connection type.
     */
    fun getNetworkStatus(context: Context): NetworkStatus {
        try {
            registerTelephonyListener(context.applicationContext)
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val activeNetwork = cm?.activeNetwork
            val caps = cm?.getNetworkCapabilities(activeNetwork)

            if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                return NetworkStatus(
                    type = ConnectionType.OFFLINE,
                    typeName = ConnectionType.OFFLINE.wireName,
                    label = "Offline (Internet OFF)",
                    isCloudUploadAllowed = false,
                    shouldWorkNormally = false,
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
                    if (!ssid.isNullOrEmpty()) "Hotspot ($ssid)" else "Hotspot"
                } else {
                    if (!ssid.isNullOrEmpty()) "WiFi ($ssid)" else "WiFi Connected"
                }

                return NetworkStatus(
                    type = connType,
                    typeName = connType.wireName,
                    label = label,
                    isCloudUploadAllowed = true,
                    shouldWorkNormally = true,
                    downstreamKbps = downstreamKbps,
                    networkQuality = quality,
                    ssid = ssid
                )
            }

            // 2. Check Cellular (5G vs 4G+ vs 4G vs 3G vs 2G)
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                val cellType = inspectCellularTechnology(context, caps)
                val label = when (cellType) {
                    ConnectionType.FIVE_G -> "5G Mobile (High Speed)"
                    ConnectionType.FOUR_G_PLUS -> "4G+ LTE-A (Background Paused)"
                    ConnectionType.FOUR_G -> "4G LTE (Background Paused)"
                    ConnectionType.THREE_G -> "3G Mobile (Background Paused)"
                    ConnectionType.TWO_G -> "2G Mobile (Background Paused)"
                    else -> "${cellType.displayName} (Background Paused)"
                }

                return NetworkStatus(
                    type = cellType,
                    typeName = cellType.wireName,
                    label = label,
                    isCloudUploadAllowed = cellType.shouldWorkNormally,
                    shouldWorkNormally = cellType.shouldWorkNormally,
                    downstreamKbps = downstreamKbps,
                    networkQuality = quality
                )
            }

            // 3. Ethernet LAN
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                return NetworkStatus(
                    type = ConnectionType.WIFI,
                    typeName = ConnectionType.WIFI.wireName,
                    label = "Ethernet LAN",
                    isCloudUploadAllowed = true,
                    shouldWorkNormally = true,
                    downstreamKbps = downstreamKbps,
                    networkQuality = "FAST"
                )
            }

            // Default fallback
            return NetworkStatus(
                type = ConnectionType.FOUR_G,
                typeName = "4G",
                label = "4G Mobile (Background Paused)",
                isCloudUploadAllowed = false,
                shouldWorkNormally = false,
                downstreamKbps = downstreamKbps,
                networkQuality = quality
            )
        } catch (e: Exception) {
            Log.w(TAG, "Error determining network status: ${e.message}")
            return NetworkStatus(
                type = ConnectionType.OFFLINE,
                typeName = "Offline",
                label = "Offline",
                isCloudUploadAllowed = false,
                shouldWorkNormally = false,
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

            // 2. TelephonyDisplayInfo 5G NSA (3) or 5G Advanced (5)
            // TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_NSA = 3
            // TelephonyDisplayInfo.OVERRIDE_NETWORK_TYPE_NR_ADVANCED = 5
            if (cachedOverrideNetworkType == 3 || cachedOverrideNetworkType == 5) {
                return ConnectionType.FIVE_G
            }

            // 3. Inspect ServiceState radio status string for 5G indicators (5G NSA / SA)
            try {
                val ss = tm?.serviceState
                if (ss != null) {
                    val ssStr = ss.toString()
                    val is5gRadio = ssStr.contains("nrState=CONNECTED", ignoreCase = true) ||
                        ssStr.contains("nrState=NOT_RESTRICTED", ignoreCase = true) ||
                        ssStr.contains("mNrState=CONNECTED", ignoreCase = true) ||
                        ssStr.contains("mNrState=NOT_RESTRICTED", ignoreCase = true) ||
                        ssStr.contains("NR_NSA", ignoreCase = true) ||
                        ssStr.contains("NR_SA", ignoreCase = true) ||
                        ssStr.contains("radioTechnology=20", ignoreCase = true) ||
                        (ssStr.contains("5G", ignoreCase = true) && !ssStr.contains("5GHz", ignoreCase = true))

                    if (is5gRadio) {
                        return ConnectionType.FIVE_G
                    }
                }
            } catch (_: Exception) {}

            // 4. Bandwidth-assisted 5G detection
            // When on cellular, link downstream bandwidth >= 40,000 Kbps (40 Mbps) indicates 5G link
            if (caps.linkDownstreamBandwidthKbps >= 40_000) {
                return ConnectionType.FIVE_G
            }

            // 5. Check if carrier has temporarily unmetered capability (often used for 5G unlimited plans)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED)) {
                        return ConnectionType.FIVE_G
                    }
                } catch (_: Exception) {}
            }

            // 6. 4G+ / LTE-Advanced (Carrier Aggregation: overrideNetworkType == 1 or 2)
            if (cachedOverrideNetworkType == 1 || cachedOverrideNetworkType == 2) {
                return ConnectionType.FOUR_G_PLUS
            }

            // 7. Standard 4G LTE check
            val isLte = dataNetType == TelephonyManager.NETWORK_TYPE_LTE ||
                dataNetType == TelephonyManager.NETWORK_TYPE_UNKNOWN
            if (isLte || caps.linkDownstreamBandwidthKbps > 5_000) {
                return ConnectionType.FOUR_G
            }

            // 8. Slower legacy networks (3G / 2G)
            val is3gType = dataNetType in listOf(
                TelephonyManager.NETWORK_TYPE_UMTS,
                TelephonyManager.NETWORK_TYPE_EVDO_0,
                TelephonyManager.NETWORK_TYPE_EVDO_A,
                TelephonyManager.NETWORK_TYPE_HSDPA,
                TelephonyManager.NETWORK_TYPE_HSUPA,
                TelephonyManager.NETWORK_TYPE_HSPA,
                TelephonyManager.NETWORK_TYPE_EVDO_B,
                TelephonyManager.NETWORK_TYPE_EHRPD,
                TelephonyManager.NETWORK_TYPE_HSPAP,
                TelephonyManager.NETWORK_TYPE_TD_SCDMA
            )
            if (is3gType || caps.linkDownstreamBandwidthKbps in 400..5_000) {
                return ConnectionType.THREE_G
            }

            val is2gType = dataNetType in listOf(
                TelephonyManager.NETWORK_TYPE_GPRS,
                TelephonyManager.NETWORK_TYPE_EDGE,
                TelephonyManager.NETWORK_TYPE_CDMA,
                TelephonyManager.NETWORK_TYPE_1xRTT,
                TelephonyManager.NETWORK_TYPE_IDEN,
                TelephonyManager.NETWORK_TYPE_GSM
            )
            if (is2gType || caps.linkDownstreamBandwidthKbps < 400) {
                return ConnectionType.TWO_G
            }

            return ConnectionType.FOUR_G
        } catch (e: Exception) {
            return ConnectionType.FOUR_G
        }
    }
}
