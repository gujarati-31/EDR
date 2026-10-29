package com.edr.agent.scheduler

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private const val TAG = "EdrSyncScheduler"
    private const val NIGHTLY_SYNC_WORK_NAME = "EDR_NIGHTLY_11PM_SYNC"
    private const val IMMEDIATE_SYNC_WORK_NAME = "EDR_IMMEDIATE_SYNC"

    /**
     * Schedules the automatic 11:00 PM (23:00) nightly delta sync
     */
    fun scheduleNightlySync(context: Context) {
        val now = Calendar.getInstance()
        val target = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 23)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        // If it's already past 11:00 PM today, schedule for 11:00 PM tomorrow
        if (now.after(target)) {
            target.add(Calendar.DAY_OF_MONTH, 1)
        }

        val initialDelay = target.timeInMillis - now.timeInMillis
        Log.i(TAG, "Nightly 11:00 PM sync scheduled. Initial delay: ${initialDelay / 1000 / 60} minutes")

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val nightlyWork = PeriodicWorkRequestBuilder<DeltaSyncWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(initialDelay, TimeUnit.MILLISECONDS)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            NIGHTLY_SYNC_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            nightlyWork
        )
    }

    /**
     * Triggered immediately when admin clicks "Get Logs" on the EDR Dashboard
     */
    fun triggerImmediateSync(context: Context) {
        Log.i(TAG, "Triggering immediate on-demand Delta Log Sync ('Get Logs' command)")

        val immediateWork = OneTimeWorkRequestBuilder<DeltaSyncWorker>()
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_SYNC_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            immediateWork
        )
    }
}

