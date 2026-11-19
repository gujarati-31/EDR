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
        val action = intent?.action
        if (action == ACTION_SET_TEST_INTERVAL) {
            val newIntervalMs = intent.getLongExtra("interval_ms", ONE_HOUR_MS)
            val prefs = context.getSharedPreferences(PREFS_DEBUG, Context.MODE_PRIVATE)
            prefs.edit().putLong(KEY_TEST_INTERVAL, newIntervalMs).apply()
            Log.i(TAG, "Test check interval updated to ${newIntervalMs / 1000} seconds.")
            scheduleHourlyAlarm(context)
            EdrForegroundService.instance?.scheduleHourlyNetworkCheck()
            return
        }

        if (action == ACTION_TRIGGER_TEST_CLEANUP) {
            val retentionDays = intent.getIntExtra("retention_days", 1)
            Log.i(TAG, "Triggering test log cleanup for retention: $retentionDays days.")
            com.edr.agent.logging.EdrActionLogDatabase.getInstance(context).cleanupOldLogs(retentionDays)
            return
        }

        Log.i(TAG, "Hourly network check alarm fired.")
        try {
            EdrForegroundService.instance?.checkNetworkAndApplyPolicy("HOURLY_ALARM")
        } catch (e: Exception) {
            Log.w(TAG, "Error executing hourly check from alarm: ${e.message}")
        }
        // Re-schedule for next interval
        scheduleHourlyAlarm(context)
    }

    companion object {
        private const val TAG = "EdrHourlyCheck"
        private const val REQUEST_CODE = 4001
        const val ONE_HOUR_MS = 3600_000L
        const val PREFS_DEBUG = "edr_debug_prefs"
        const val KEY_TEST_INTERVAL = "test_check_interval_ms"
        const val ACTION_SET_TEST_INTERVAL = "com.edr.agent.SET_TEST_INTERVAL"
        const val ACTION_TRIGGER_TEST_CLEANUP = "com.edr.agent.TRIGGER_TEST_CLEANUP"

        fun getCheckIntervalMs(context: Context): Long {
            return try {
                val prefs = context.getSharedPreferences(PREFS_DEBUG, Context.MODE_PRIVATE)
                val interval = prefs.getLong(KEY_TEST_INTERVAL, ONE_HOUR_MS)
                if (interval < 10_000L) ONE_HOUR_MS else interval // min 10 seconds safety
            } catch (e: Exception) {
                ONE_HOUR_MS
            }
        }

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

                val intervalMs = getCheckIntervalMs(context)
                val triggerAt = SystemClock.elapsedRealtime() + intervalMs
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
                } else {
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
                }
                Log.d(TAG, "Scheduled next network check in ${intervalMs / 1000} seconds.")
            } catch (e: Exception) {
                Log.w(TAG, "Failed scheduling hourly alarm: ${e.message}")
            }
        }
    }
}
