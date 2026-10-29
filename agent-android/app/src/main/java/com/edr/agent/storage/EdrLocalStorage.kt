package com.edr.agent.storage

import android.content.Context
import android.os.Build
import android.os.Environment
import android.util.Log
import com.edr.agent.policy.EdrPolicyManager
import com.google.gson.GsonBuilder
import java.io.File
import java.io.FileWriter
import java.io.PrintWriter

object EdrLocalStorage {

    private const val TAG = "EdrLocalStorage"
    private val gson = GsonBuilder().setPrettyPrinting().create()

    /**
     * Resolves the primary /EDR directory on local phone storage.
     * Prefers /sdcard/EDR. Falls back to external files dir if /sdcard is blocked.
     */
    fun getEdrDir(context: Context): File {
        val candidates = listOf(
            File(Environment.getExternalStorageDirectory(), "EDR"),
            File("/sdcard/EDR"),
            File("/storage/emulated/0/EDR"),
            File(context.getExternalFilesDir(null), "EDR")
        )

        for (dir in candidates) {
            try {
                if (!dir.exists()) {
                    dir.mkdirs()
                }
                if (dir.exists() && dir.canWrite()) {
                    return dir
                }
            } catch (e: Exception) {
                Log.w(TAG, "Cannot access ${dir.absolutePath}: ${e.message}")
            }
        }

        // Ultimate fallback: internal app files
        val internalDir = File(context.filesDir, "EDR")
        internalDir.mkdirs()
        return internalDir
    }

    /**
     * Resolves the /EDR/photos directory where camera snapshots are temporarily stored
     */
    fun getPhotosDir(context: Context): File {
        val photosDir = File(getEdrDir(context), "photos")
        if (!photosDir.exists()) {
            photosDir.mkdirs()
        }
        return photosDir
    }

    /**
     * Saves all EDR configuration, device status, policy info to /EDR/edr_info.json
     */
    fun saveEdrInfo(context: Context) {
        try {
            val edrDir = getEdrDir(context)
            val infoFile = File(edrDir, "edr_info.json")

            val infoData = mapOf(
                "agentName" to "Android Enterprise EDR Agent",
                "version" to "1.2.0",
                "deviceId" to SyncPreferences.deviceId,
                "deviceName" to "${Build.MANUFACTURER} ${Build.MODEL}",
                "osVersion" to "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                "serverHost" to SyncPreferences.serverHost,
                "serverPort" to SyncPreferences.serverPort,
                "httpBaseUrl" to SyncPreferences.httpBaseUrl,
                "wsUrl" to SyncPreferences.wsUrl,
                "lastSyncedTimestamp" to SyncPreferences.getLastSyncedTimestamp(),
                "isDeviceOwner" to EdrPolicyManager.isDeviceOwner(context),
                "edrStoragePath" to edrDir.absolutePath,
                "lastUpdated" to SyncPreferences.getCurrentIsoTimestamp()
            )

            infoFile.writeText(gson.toJson(infoData))
            Log.i(TAG, "EDR device information successfully saved to ${infoFile.absolutePath}")
            appendEdrLog(context, "INFO", "EDR device info updated in ${infoFile.name}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed saving EDR info locally: ${e.message}")
        }
    }

    /**
     * Appends an audit event to /EDR/edr_telemetry.log
     */
    fun appendEdrLog(context: Context, tag: String, message: String) {
        try {
            val edrDir = getEdrDir(context)
            val logFile = File(edrDir, "edr_telemetry.log")
            val timestamp = SyncPreferences.getCurrentIsoTimestamp()

            PrintWriter(FileWriter(logFile, true)).use { out ->
                out.println("[$timestamp] [$tag] $message")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed appending to local EDR log: ${e.message}")
        }
    }
}

