package com.edr.agent.telemetry

import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

data class AppUsageRecord(
    val packageName: String,
    val appName: String,
    val foregroundSeconds: Long,
    val launchCount: Int,
    val usageDate: String // YYYY-MM-DD
)

object UsageStatsTracker {
    private const val TAG = "EdrUsageTracker"

    /**
     * Collects exact day-wise usage (12:00 AM to 11:59 PM) for the past [daysBack] days
     */
    fun collectDayWiseUsage(context: Context, daysBack: Int = 7): List<AppUsageRecord> {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return emptyList()

        val pm = context.packageManager
        val records = mutableListOf<AppUsageRecord>()
        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

        for (i in 0 until daysBack) {
            val calendar = Calendar.getInstance()
            calendar.add(Calendar.DAY_OF_YEAR, -i)

            // Start of day: 12:00:00 AM (00:00:00)
            calendar.set(Calendar.HOUR_OF_DAY, 0)
            calendar.set(Calendar.MINUTE, 0)
            calendar.set(Calendar.SECOND, 0)
            calendar.set(Calendar.MILLISECOND, 0)
            val startTime = calendar.timeInMillis
            val dateStr = dateFormat.format(calendar.time)

            // End of day: 11:59:59 PM (23:59:59)
            calendar.set(Calendar.HOUR_OF_DAY, 23)
            calendar.set(Calendar.MINUTE, 59)
            calendar.set(Calendar.SECOND, 59)
            calendar.set(Calendar.MILLISECOND, 999)
            val endTime = if (i == 0) System.currentTimeMillis() else calendar.timeInMillis

            try {
                val statsList: List<UsageStats> = usm.queryUsageStats(
                    UsageStatsManager.INTERVAL_DAILY,
                    startTime,
                    endTime
                ) ?: emptyList()

                // Filter apps with foreground time > 0 on this specific date
                for (stats in statsList) {
                    val foregroundSec = stats.totalTimeInForeground / 1000
                    if (foregroundSec > 0) {
                        val appName = try {
                            val appInfo = pm.getApplicationInfo(stats.packageName, 0)
                            pm.getApplicationLabel(appInfo).toString()
                        } catch (e: PackageManager.NameNotFoundException) {
                            stats.packageName
                        }

                        records.add(
                            AppUsageRecord(
                                packageName = stats.packageName,
                                appName = appName,
                                foregroundSeconds = foregroundSec,
                                launchCount = 1,
                                usageDate = dateStr
                            )
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed reading day stats for $dateStr: ${e.message}")
            }
        }

        return records
    }
}
