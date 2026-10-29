package com.edr.agent.telemetry

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.FileReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class SiemEvent(
    val eventId: String,          // e.g. "ANDROID_PROC_START", "ANDROID_SYS_ERR", "SYS_NET_CONN"
    val eventCategory: String,    // "PROCESS", "NETWORK", "SYSTEM", "SECURITY", "CRASH", "APPLICATION"
    val sourceBuffer: String,     // "events", "system", "crash", "main", "procfs"
    val severity: String,         // "INFO", "WARNING", "CRITICAL"
    val message: String,          // Human-readable summary
    val provider: String,         // Subsystem e.g. "ActivityManager", "PackageManager", "LinuxKernel"
    val timestamp: String,        // ISO-8601 UTC
    val details: Map<String, Any> // Structured metadata for Wazuh/SIEM JSON parsing
)

object RawSecurityAuditHarvester {
    private const val TAG = "RawAuditHarvester"

    /**
     * Harvests all raw system, application, network, and crash logs formatted for SIEM / Wazuh
     */
    fun harvestAllRawEvents(context: Context, timestamp: String): List<SiemEvent> {
        val events = mutableListOf<SiemEvent>()

        // 1. Android Event Log Buffer (Equivalent to Windows Event ID / Sysmon Process Activity)
        events.addAll(harvestEventLogBuffer(timestamp))

        // 2. Android Crash Buffer (Uncaught exceptions, tombstones, ANRs)
        events.addAll(harvestCrashBuffer(timestamp))

        // 3. Android System Log Buffer (OS Framework, DevicePolicyManager, PackageManager)
        events.addAll(harvestSystemBuffer(timestamp))

        // 4. Android Main Buffer (Application Warnings & Security Exceptions)
        events.addAll(harvestMainBuffer(timestamp))

        // 5. Active Raw Sockets from /proc/net/tcp (Sysmon Event ID 3: Network Connections)
        events.addAll(harvestRawNetworkSockets(context, timestamp))

        return events
    }

    /**
     * Harvests the binary events buffer: am_proc_start, am_proc_died, am_resume_activity, etc.
     */
    private fun harvestEventLogBuffer(fallbackTimestamp: String): List<SiemEvent> {
        val events = mutableListOf<SiemEvent>()
        try {
            val process = Runtime.getRuntime().exec("logcat -b events -d -v epoch -t 60")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val raw = line?.trim() ?: continue
                if (raw.isBlank() || raw.startsWith("---------")) continue

                // Format: <epoch_time> <pid> <tid> <level> <tag>: <message>
                val parts = raw.split(":", limit = 2)
                if (parts.size < 2) continue

                val header = parts[0].trim()
                val payload = parts[1].trim()

                // Extract tag (e.g. am_proc_start, am_proc_died)
                val tag = header.substringAfterLast(" ").trim()

                val (eventId, category, severity) = when {
                    tag.contains("am_proc_start") -> Triple("PROC_CREATE_4688", "PROCESS", "INFO")
                    tag.contains("am_proc_died") -> Triple("PROC_TERMINATE_4689", "PROCESS", "INFO")
                    tag.contains("am_kill") -> Triple("PROC_KILL", "PROCESS", "WARNING")
                    tag.contains("am_anr") -> Triple("APP_HANG_ANR", "CRASH", "CRITICAL")
                    tag.contains("am_crash") -> Triple("APP_CRASH_1000", "CRASH", "CRITICAL")
                    tag.contains("am_resume_activity") -> Triple("ACTIVITY_RESUMED", "APPLICATION", "INFO")
                    tag.contains("am_pause_activity") -> Triple("ACTIVITY_PAUSED", "APPLICATION", "INFO")
                    tag.contains("dpm_") -> Triple("SECURITY_POLICY_DPM", "SECURITY", "WARNING")
                    tag.contains("screen_toggled") || tag.contains("keyguard") -> Triple("AUTH_LOCK_SCREEN", "SECURITY", "INFO")
                    else -> Triple("EVENT_LOG", "SYSTEM", "INFO")
                }

                events.add(
                    SiemEvent(
                        eventId = eventId,
                        eventCategory = category,
                        sourceBuffer = "events",
                        severity = severity,
                        message = "[$tag] $payload",
                        provider = tag,
                        timestamp = fallbackTimestamp,
                        details = mapOf(
                            "tag" to tag,
                            "payload" to payload,
                            "rawLog" to raw
                        )
                    )
                )
            }
            reader.close()
            process.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Failed harvesting events buffer: ${e.message}")
        }
        return events.takeLast(35)
    }

    /**
     * Harvests native crashes, Java exceptions, and SIGSEGV events
     */
    private fun harvestCrashBuffer(fallbackTimestamp: String): List<SiemEvent> {
        val events = mutableListOf<SiemEvent>()
        try {
            val process = Runtime.getRuntime().exec("logcat -b crash -d -v time -t 30")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val raw = line?.trim() ?: continue
                if (raw.isBlank() || raw.startsWith("---------")) continue

                events.add(
                    SiemEvent(
                        eventId = "CRASH_SIGSEGV_ANR",
                        eventCategory = "CRASH",
                        sourceBuffer = "crash",
                        severity = "CRITICAL",
                        message = raw,
                        provider = "AndroidRuntime",
                        timestamp = fallbackTimestamp,
                        details = mapOf("rawCrash" to raw)
                    )
                )
            }
            reader.close()
            process.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Failed harvesting crash buffer: ${e.message}")
        }
        return events
    }

    /**
     * Harvests system buffer (OS framework, services, DevicePolicyManager)
     */
    private fun harvestSystemBuffer(fallbackTimestamp: String): List<SiemEvent> {
        val events = mutableListOf<SiemEvent>()
        try {
            val process = Runtime.getRuntime().exec("logcat -b system -d -v time -t 40 *:W")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val raw = line?.trim() ?: continue
                if (raw.isBlank() || raw.startsWith("---------")) continue

                val isWarn = raw.contains(" W ")
                val isError = raw.contains(" E ")

                events.add(
                    SiemEvent(
                        eventId = if (isError) "SYS_ERROR" else "SYS_WARNING",
                        eventCategory = "SYSTEM",
                        sourceBuffer = "system",
                        severity = if (isError) "WARNING" else "INFO",
                        message = raw,
                        provider = "AndroidFramework",
                        timestamp = fallbackTimestamp,
                        details = mapOf("rawSystemLog" to raw)
                    )
                )
            }
            reader.close()
            process.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Failed harvesting system buffer: ${e.message}")
        }
        return events.takeLast(25)
    }

    /**
     * Harvests main buffer (Application exceptions, permission issues)
     */
    private fun harvestMainBuffer(fallbackTimestamp: String): List<SiemEvent> {
        val events = mutableListOf<SiemEvent>()
        try {
            val process = Runtime.getRuntime().exec("logcat -b main -d -v time -t 30 *:W")
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val raw = line?.trim() ?: continue
                if (raw.isBlank() || raw.startsWith("---------")) continue

                events.add(
                    SiemEvent(
                        eventId = "APP_LOG_EVENT",
                        eventCategory = "APPLICATION",
                        sourceBuffer = "main",
                        severity = "INFO",
                        message = raw,
                        provider = "ApplicationMain",
                        timestamp = fallbackTimestamp,
                        details = mapOf("rawLog" to raw)
                    )
                )
            }
            reader.close()
            process.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Failed harvesting main buffer: ${e.message}")
        }
        return events.takeLast(20)
    }

    /**
     * Reads /proc/net/tcp to extract raw active network connections (Sysmon Event ID 3)
     */
    private fun harvestRawNetworkSockets(context: Context, timestamp: String): List<SiemEvent> {
        val events = mutableListOf<SiemEvent>()
        val pm = context.packageManager

        try {
            val tcpFile = File("/proc/net/tcp")
            if (tcpFile.exists()) {
                val reader = BufferedReader(FileReader(tcpFile))
                var line = reader.readLine() // skip header line

                while (reader.readLine().also { line = it } != null) {
                    val raw = line?.trim() ?: continue
                    val tokens = raw.split("\\s+".toRegex())
                    if (tokens.size < 10) continue

                    val localHex = tokens[1]
                    val remoteHex = tokens[2]
                    val stateHex = tokens[3]
                    val uidStr = tokens[7]

                    val (remoteIp, remotePort) = parseHexAddress(remoteHex)
                    if (remotePort == 0 || remoteIp == "0.0.0.0") continue

                    val (localIp, localPort) = parseHexAddress(localHex)
                    val state = when (stateHex) {
                        "01" -> "ESTABLISHED"
                        "02" -> "SYN_SENT"
                        "03" -> "SYN_RECV"
                        "0A" -> "LISTEN"
                        else -> "STATE_$stateHex"
                    }

                    val uid = uidStr.toIntOrNull() ?: 0
                    val packageName = try {
                        pm.getNameForUid(uid) ?: "UID_$uid"
                    } catch (e: Exception) {
                        "UID_$uid"
                    }

                    events.add(
                        SiemEvent(
                            eventId = "NET_CONN_SYSMON_3",
                            eventCategory = "NETWORK",
                            sourceBuffer = "procfs_tcp",
                            severity = "INFO",
                            message = "TCP Connection: $packageName connected to $remoteIp:$remotePort ($state)",
                            provider = "LinuxNetfilter",
                            timestamp = timestamp,
                            details = mapOf(
                                "localAddress" to "$localIp:$localPort",
                                "remoteAddress" to "$remoteIp:$remotePort",
                                "destinationIp" to remoteIp,
                                "destinationPort" to remotePort,
                                "state" to state,
                                "uid" to uid,
                                "packageName" to packageName
                            )
                        )
                    )
                }
                reader.close()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed harvesting raw sockets: ${e.message}")
        }

        return events.takeLast(20)
    }

    private fun parseHexAddress(hexAddr: String): Pair<String, Int> {
        return try {
            val parts = hexAddr.split(":")
            if (parts.size != 2) return Pair("0.0.0.0", 0)

            val ipHex = parts[0]
            val portHex = parts[1]

            val port = portHex.toInt(16)
            val ipBytes = ByteArray(4)
            for (i in 0 until 4) {
                val byteStr = ipHex.substring(i * 2, (i + 1) * 2)
                ipBytes[3 - i] = byteStr.toInt(16).toByte() // Little-endian to big-endian
            }
            val ip = InetAddress.getByAddress(ipBytes).hostAddress ?: "0.0.0.0"
            Pair(ip, port)
        } catch (e: Exception) {
            Pair("0.0.0.0", 0)
        }
    }
}

