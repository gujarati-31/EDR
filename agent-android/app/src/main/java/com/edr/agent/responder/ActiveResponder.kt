package com.edr.agent.responder

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.util.Log
import com.edr.agent.admin.EdrDeviceAdminReceiver
import com.edr.agent.scheduler.SyncScheduler
import java.io.File

object ActiveResponder {
    private const val TAG = "EdrActiveResponder"

    fun execute(
        context: Context,
        commandId: String,
        commandType: String,
        parameters: Map<String, Any>?
    ): Pair<String, String> {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = EdrDeviceAdminReceiver.getComponentName(context)
        val isDeviceOwner = dpm.isDeviceOwnerApp(context.packageName)

        Log.i(TAG, "Executing active command: $commandType (id: $commandId)")

        val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
        val wakeLock = pm?.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "edr:responder_$commandType")

        return try {
            wakeLock?.acquire(10000L) // Keep CPU active for 10s on Redmi / Vivo deep sleep
            when (commandType) {
                "LOCK_DEVICE" -> {
                    dpm.lockNow()
                    Pair("EXECUTED", "Device successfully locked")
                }

                "REBOOT_DEVICE" -> {
                    if (isDeviceOwner && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        dpm.reboot(admin)
                        Pair("EXECUTED", "Reboot command initiated")
                    } else {
                        Pair("FAILED", "Reboot requires Device Owner privileges on Android 7.0+")
                    }
                }

                "WIPE_DEVICE" -> {
                    if (isDeviceOwner) {
                        dpm.wipeData(0)
                        Pair("EXECUTED", "Device wipe initiated")
                    } else {
                        Pair("FAILED", "Device wipe requires Device Owner")
                    }
                }

                "UNINSTALL_APP" -> {
                    val pkg = parameters?.get("packageName") as? String
                    if (pkg.isNullOrBlank()) {
                        Pair("FAILED", "Missing packageName parameter")
                    } else {
                        uninstallPackage(context, pkg)
                    }
                }

                "DELETE_FILE" -> {
                    val filePath = parameters?.get("filePath") as? String
                    if (filePath.isNullOrBlank()) {
                        Pair("FAILED", "Missing filePath parameter")
                    } else {
                        deleteFileFromDevice(filePath)
                    }
                }

                "GET_APPS" -> {
                    com.edr.agent.telemetry.AppInventoryManager.syncNow(context, { msg ->
                        com.edr.agent.service.EdrForegroundService.instance?.sendWebSocketMessage(msg) ?: false
                    }, force = true)
                    Pair("EXECUTED", "Instant application inventory scan and sync initiated")
                }

                "GET_DATA", "GET_LOGS" -> {
                    // Trigger immediate delta harvest, device info, screen time, and app inventory forward!
                    com.edr.agent.telemetry.AppInventoryManager.syncNow(context, { msg ->
                        com.edr.agent.service.EdrForegroundService.instance?.sendWebSocketMessage(msg) ?: false
                    }, force = false)
                    SyncScheduler.triggerImmediateSync(context)
                    Pair("EXECUTED", "Immediate device telemetry & log harvest initiated")
                }

                "CAPTURE_PHOTO" -> {
                    com.edr.agent.camera.SilentCameraCapturer.capture(context, "Manual Admin Request")
                    Pair("EXECUTED", "Intruder silent camera capture initiated (Front & Back)")
                }

                "START_SCREEN_STREAM" -> {
                    com.edr.agent.screen.ScreenStreamManager.startStreaming(context)
                }

                "STOP_SCREEN_STREAM" -> {
                    com.edr.agent.screen.ScreenStreamManager.stopStreaming()
                }

                "CAPTURE_SCREENSHOT_PROOF" -> {
                    com.edr.agent.screen.ScreenStreamManager.captureProofSnapshot(context) { _, _ -> }
                    Pair("EXECUTED", "Live screen proof snapshot captured and sent to server")
                }

                "DISCONNECT_DEVICE" -> {
                    // Schedule disconnect shortly after sending ACK
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        com.edr.agent.service.EdrForegroundService.instance?.disconnectWebSocket()
                    }, 500)
                    Pair("EXECUTED", "Device WebSocket disconnected from server by dashboard command.")
                }

                "CONNECT_DEVICE" -> {
                    com.edr.agent.service.EdrForegroundService.instance?.reconnectWebSocket()
                    Pair("EXECUTED", "Device reconnecting to EDR Gateway...")
                }

                "UPDATE_AGENT" -> {
                    val downloadUrl = parameters?.get("downloadUrl") as? String ?: ""
                    if (downloadUrl.isBlank()) {
                        Pair("FAILED", "Missing downloadUrl parameter for UPDATE_AGENT")
                    } else {
                        val versionCode = (parameters?.get("versionCode") as? Number)?.toLong() ?: 0L
                        val versionName = parameters?.get("versionName") as? String ?: "latest"
                        val sha256 = parameters?.get("sha256") as? String
                        val force = parameters?.get("force") as? Boolean ?: false
                        com.edr.agent.update.AppUpdateManager.startOtaUpdate(
                            context = context,
                            downloadUrl = downloadUrl,
                            targetVersionCode = versionCode,
                            targetVersionName = versionName,
                            expectedSha256 = sha256,
                            force = force
                        )
                    }
                }

                else -> {
                    Pair("FAILED", "Unknown command type: $commandType")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Command execution failed: ${e.message}", e)
            Pair("FAILED", "Execution exception: ${e.message}")
        } finally {
            try {
                if (wakeLock?.isHeld == true) {
                    wakeLock.release()
                }
            } catch (ignored: Exception) {}
        }
    }

    private fun uninstallPackage(context: Context, packageName: String): Pair<String, String> {
        return try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                // In Device Owner mode, uninstall silently via PackageInstaller
                val packageInstaller = context.packageManager.packageInstaller
                val intent = Intent("com.edr.agent.UNINSTALL_RESULT")
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    0,
                    intent,
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                )
                packageInstaller.uninstall(packageName, pendingIntent.intentSender)
                Pair("EXECUTED", "Silent uninstall requested for package: $packageName")
            } else {
                // Standard mode: prompt user with system uninstaller
                val intent = Intent(Intent.ACTION_DELETE).apply {
                    data = Uri.parse("package:$packageName")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
                Pair("EXECUTED", "Initiated uninstallation prompt on device for package: $packageName")
            }
        } catch (e: Exception) {
            Pair("FAILED", "Uninstall failed: ${e.message}")
        }
    }

    private fun deleteFileFromDevice(path: String): Pair<String, String> {
        return try {
            val file = File(path)
            if (!file.exists()) {
                Pair("FAILED", "File not found at path: $path")
            } else {
                val deleted = file.delete()
                if (deleted) {
                    Pair("EXECUTED", "File successfully deleted from device: $path")
                } else {
                    Pair("FAILED", "Permission denied or unable to delete file at: $path")
                }
            }
        } catch (e: Exception) {
            Pair("FAILED", "File deletion error: ${e.message}")
        }
    }
}

