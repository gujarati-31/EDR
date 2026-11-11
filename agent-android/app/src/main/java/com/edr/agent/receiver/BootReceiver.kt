package com.edr.agent.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.edr.agent.service.EdrForegroundService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON" ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            Log.i("EdrBootReceiver", "Lifecycle trigger (${intent.action}). Scheduling EDR Service start in 1500ms...")
            // Small delay so the system is fully up before we bind to framework services
            Handler(Looper.getMainLooper()).postDelayed({
                try {
                    val serviceIntent = Intent(context, EdrForegroundService::class.java)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                    Log.i("EdrBootReceiver", "EDR Foreground Service started after boot.")
                } catch (e: Exception) {
                    Log.e("EdrBootReceiver", "Failed to start service after boot: ${e.message}")
                }
            }, 1500L)
        }
    }
}

