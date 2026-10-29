package com.edr.agent.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.edr.agent.service.EdrForegroundService

class EdrConnectReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i("EdrConnectReceiver", "Received connect broadcast: ${intent.action}")

        val service = EdrForegroundService.instance
        if (service != null) {
            service.reconnectWebSocket()
        } else {
            val serviceIntent = Intent(context, EdrForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        }
    }
}

