package com.edr.agent.telemetry

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

data class InstalledAppRecord(
    val packageName: String,
    val appName: String,
    val versionName: String,
    val isSystemApp: Boolean,
    val apkSha256: String
)

object AppInventoryManager {
    private const val TAG = "EdrAppInventory"

    fun collectInstalledApps(context: Context): List<InstalledAppRecord> {
        val pm = context.packageManager
        val packages = pm.getInstalledPackages(0)

        return packages.mapNotNull { pkg ->
            try {
                val appInfo = pkg.applicationInfo ?: return@mapNotNull null
                val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                val appName = pm.getApplicationLabel(appInfo).toString()
                val versionName = pkg.versionName ?: "1.0"
                val apkPath = appInfo.sourceDir

                // Calculate APK SHA-256 for threat scanning
                val sha256 = calculateFileSha256(apkPath)

                InstalledAppRecord(
                    packageName = pkg.packageName,
                    appName = appName,
                    versionName = versionName,
                    isSystemApp = isSystem,
                    apkSha256 = sha256
                )
            } catch (e: Exception) {
                null
            }
        }
    }

    private fun calculateFileSha256(filePath: String): String {
        return try {
            val file = File(filePath)
            if (!file.exists()) return ""
            val digest = MessageDigest.getInstance("SHA-256")
            val fis = FileInputStream(file)
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (fis.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
            fis.close()
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            ""
        }
    }
}

