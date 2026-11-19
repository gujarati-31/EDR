package com.edr.agent.logging

import java.util.UUID

/**
 * Universal Action Log Entry Data Model.
 * Represents an activity performed by the EDR app.
 *
 * Requirements:
 * - Log ID and Action ID
 * - Date and time (ISO-8601 UTC)
 * - Device ID
 * - Event type and module
 * - Triggered by: Admin, Automatic, Hourly check, or User
 * - Short description of the action
 * - Status: Started, Success, Failed, or Skipped
 * - Data used (uploaded and downloaded bytes)
 * - Network type at that time (5G, WiFi, Hotspot, 4G+, 4G, 3G, 2G, Offline)
 * - Never saves raw content (only metadata: type, name, size, time)
 */
data class EdrActionLog(
    val logId: String = UUID.randomUUID().toString(),
    val actionId: String,
    val timestamp: String,
    val deviceId: String,
    val eventType: String,
    val module: String,
    val triggeredBy: String, // "Admin" | "Automatic" | "Hourly check" | "User"
    val description: String,
    val status: String, // "Started" | "Success" | "Failed" | "Skipped"
    val failureReason: String? = null,
    val bytesUploaded: Long = 0L,
    val bytesDownloaded: Long = 0L,
    val networkType: String
)
