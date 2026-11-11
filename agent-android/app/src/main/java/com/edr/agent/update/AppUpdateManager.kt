package com.edr.agent.update

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.edr.agent.EdrApplication
import com.edr.agent.R
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object AppUpdateManager {
    private const val TAG = "AppUpdateManager"
    const val ACTION_INSTALL_RESULT = "com.edr.agent.ACTION_INSTALL_RESULT"
    private val isUpdating = AtomicBoolean(false)

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    fun getCurrentVersionCode(context: Context): Long {
        return try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        } catch (_: Exception) {
            0L
        }
    }

    fun getCurrentVersionName(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "1.0.0"
        } catch (_: Exception) {
            "1.0.0"
        }
    }

    fun startOtaUpdate(
        context: Context,
        downloadUrl: String,
        targetVersionCode: Long,
        targetVersionName: String,
        expectedSha256: String?,
        force: Boolean = false
    ): Pair<String, String> {
        val currentCode = getCurrentVersionCode(context)
        if (!force && targetVersionCode > 0 && currentCode >= targetVersionCode) {
            return Pair("EXECUTED", "Device is already running v${getCurrentVersionName(context)} ($currentCode).")
        }
        if (!isUpdating.compareAndSet(false, true)) {
            return Pair("EXECUTED", "An OTA update download/installation is already in progress.")
        }

        val appCtx = context.applicationContext
        val resolvedUrl = if (downloadUrl.startsWith("http://") || downloadUrl.startsWith("https://")) {
            downloadUrl
        } else {
            val path = if (downloadUrl.startsWith("/")) downloadUrl else "/$downloadUrl"
            "${SyncPreferences.httpBaseUrl}$path"
        }

        Thread {
            val apkFile = File(appCtx.cacheDir, "edr_ota_update.apk")
            try {
                Log.i(TAG, "Starting OTA download for v$targetVersionName ($targetVersionCode) from $resolvedUrl")
                EdrLocalStorage.appendEdrLog(appCtx, "OTA_UPDATE", "Downloading update v$targetVersionName ($targetVersionCode) from $resolvedUrl")

                val req = Request.Builder().url(resolvedUrl).get().build()
                httpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        throw IllegalStateException("HTTP ${resp.code} downloading APK")
                    }
                    val body = resp.body ?: throw IllegalStateException("Empty APK response body")
                    val digest = MessageDigest.getInstance("SHA-256")
                    FileOutputStream(apkFile).use { fos ->
                        body.byteStream().use { input ->
                            val buf = ByteArray(16 * 1024)
                            while (true) {
                                val read = input.read(buf)
                                if (read <= 0) break
                                fos.write(buf, 0, read)
                                digest.update(buf, 0, read)
                            }
                            fos.flush()
                        }
                    }

                    val actualSha = digest.digest().joinToString("") { "%02x".format(it) }
                    if (!expectedSha256.isNullOrBlank() && !actualSha.equals(expectedSha256.trim(), ignoreCase = true)) {
                        apkFile.delete()
                        throw SecurityException("APK SHA-256 checksum mismatch! Expected $expectedSha256, got $actualSha")
                    }
                }

                EdrLocalStorage.appendEdrLog(appCtx, "OTA_UPDATE", "Verified APK (${apkFile.length()} bytes). Committing PackageInstaller session...")
                installApkViaSession(appCtx, apkFile, targetVersionName)
            } catch (e: Exception) {
                Log.e(TAG, "OTA update failed: ${e.message}", e)
                EdrLocalStorage.appendEdrLog(appCtx, "OTA_ERR", "OTA update failed: ${e.message}")
                try { apkFile.delete() } catch (_: Exception) {}
            } finally {
                isUpdating.set(false)
            }
        }.start()

        return Pair("EXECUTED", "Downloading v$targetVersionName ($targetVersionCode) on device...")
    }

    private fun installApkViaSession(context: Context, apkFile: File, targetVersionName: String) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setSize(apkFile.length())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }

        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("edr_update", 0, apkFile.length()).use { out ->
                FileInputStream(apkFile).use { input ->
                    input.copyTo(out, 16 * 1024)
                }
                session.fsync(out)
            }

            val intent = Intent(context, UpdateInstallReceiver::class.java).apply {
                action = ACTION_INSTALL_RESULT
                putExtra("versionName", targetVersionName)
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val callbackIntent = PendingIntent.getBroadcast(context, sessionId, intent, flags)
            session.commit(callbackIntent.intentSender)
        }
    }
}

class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val versionName = intent.getStringExtra("versionName") ?: "latest"

        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirmIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirmIntent != null) {
                    confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(confirmIntent)
                    } catch (e: Exception) {
                        Log.w("UpdateInstallReceiver", "Background prompt blocked, showing update notification: ${e.message}")
                    }
                    // Also post notification so if screen is locked or OEM blocked background launch, tapping installs immediately
                    try {
                        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                        } else {
                            PendingIntent.FLAG_UPDATE_CURRENT
                        }
                        val pi = PendingIntent.getActivity(context, 9012, confirmIntent, piFlags)
                        val notif = NotificationCompat.Builder(context, EdrApplication.CHANNEL_ID)
                            .setSmallIcon(R.mipmap.ic_launcher)
                            .setContentTitle("Device Services Update Ready")
                            .setContentText("Tap to apply required update v$versionName")
                            .setPriority(NotificationCompat.PRIORITY_HIGH)
                            .setAutoCancel(true)
                            .setContentIntent(pi)
                            .build()
                        nm?.notify(9012, notif)
                    } catch (_: Exception) {}
                }
            }

            PackageInstaller.STATUS_SUCCESS -> {
                EdrLocalStorage.appendEdrLog(context, "OTA_UPDATE", "Update v$versionName installed cleanly.")
                File(context.cacheDir, "edr_ota_update.apk").delete()
            }

            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Unknown installer error ($status)"
                Log.e("UpdateInstallReceiver", "PackageInstaller failed ($status): $msg")
                EdrLocalStorage.appendEdrLog(context, "OTA_ERR", "Install failed ($status): $msg")
                File(context.cacheDir, "edr_ota_update.apk").delete()
            }
        }
    }
}
