package com.edr.agent.receiver

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.edr.agent.service.EdrForegroundService

/**
 * Function 1: Hourly Network Check Receiver.
 * Uses AlarmManager to ensure the hourly network check triggers on time,
 * waking the CPU even when Android enters deep sleep / Doze mode.
 */
class EdrHourlyCheckReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        Log.i(TAG, "Hourly network check alarm fired.")
        try {
            EdrForegroundService.instance?.checkNetworkAndApplyPolicy("HOURLY_ALARM")
        } catch (e: Exception) {
            Log.w(TAG, "Error executing hourly check from alarm: ${e.message}")
        }
        // Re-schedule for next 1 hour (3600 seconds)
        scheduleHourlyAlarm(context)
    }

    companion object {
        private const val TAG = "EdrHourlyCheck"
        private const val REQUEST_CODE = 4001
        const val ONE_HOUR_MS = 3600_000L

        fun scheduleHourlyAlarm(context: Context) {
            try {
                val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(context, EdrHourlyCheckReceiver::class.java)
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pendingIntent = PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)

                val triggerAt = SystemClock.elapsedRealtime() + ONE_HOUR_MS
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
                } else {
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
                }
                Log.d(TAG, "Scheduled next hourly network check in 1 hour.")
            } catch (e: Exception) {
                Log.w(TAG, "Failed scheduling hourly alarm: ${e.message}")
            }
        }
    }
}
