package com.edr.agent.logging

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log

/**
 * Local SQLite storage for Universal EDR Action Logs.
 * Stores action logs securely inside the app's protected internal database sandbox.
 * Users cannot edit or delete entries.
 */
class EdrActionLogDatabase private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE_NAME (
                $COL_LOG_ID TEXT PRIMARY KEY,
                $COL_ACTION_ID TEXT NOT NULL,
                $COL_TIMESTAMP TEXT NOT NULL,
                $COL_DEVICE_ID TEXT NOT NULL,
                $COL_EVENT_TYPE TEXT NOT NULL,
                $COL_MODULE TEXT NOT NULL,
                $COL_TRIGGERED_BY TEXT NOT NULL,
                $COL_DESCRIPTION TEXT NOT NULL,
                $COL_STATUS TEXT NOT NULL,
                $COL_FAILURE_REASON TEXT,
                $COL_BYTES_UPLOADED INTEGER NOT NULL DEFAULT 0,
                $COL_BYTES_DOWNLOADED INTEGER NOT NULL DEFAULT 0,
                $COL_NETWORK_TYPE TEXT NOT NULL,
                $COL_IS_UPLOADED INTEGER NOT NULL DEFAULT 0,
                $COL_CREATED_AT_MS INTEGER NOT NULL
            );
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_action_id ON $TABLE_NAME ($COL_ACTION_ID);")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_uploaded ON $TABLE_NAME ($COL_IS_UPLOADED);")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_timestamp ON $TABLE_NAME ($COL_CREATED_AT_MS);")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Migration if table changes in future
    }

    @Synchronized
    fun insert(log: EdrActionLog) {
        try {
            val db = writableDatabase
            val values = ContentValues().apply {
                put(COL_LOG_ID, log.logId)
                put(COL_ACTION_ID, log.actionId)
                put(COL_TIMESTAMP, log.timestamp)
                put(COL_DEVICE_ID, log.deviceId)
                put(COL_EVENT_TYPE, log.eventType)
                put(COL_MODULE, log.module)
                put(COL_TRIGGERED_BY, log.triggeredBy)
                put(COL_DESCRIPTION, log.description)
                put(COL_STATUS, log.status)
                put(COL_FAILURE_REASON, log.failureReason)
                put(COL_BYTES_UPLOADED, log.bytesUploaded)
                put(COL_BYTES_DOWNLOADED, log.bytesDownloaded)
                put(COL_NETWORK_TYPE, log.networkType)
                put(COL_IS_UPLOADED, 0)
                put(COL_CREATED_AT_MS, System.currentTimeMillis())
            }
            db.insertWithOnConflict(TABLE_NAME, null, values, SQLiteDatabase.CONFLICT_REPLACE)
        } catch (e: Exception) {
            Log.e(TAG, "Failed inserting action log: ${e.message}")
        }
    }

    @Synchronized
    fun getPendingUpload(limit: Int = 100): List<EdrActionLog> {
        val list = mutableListOf<EdrActionLog>()
        try {
            val db = readableDatabase
            val cursor = db.query(
                TABLE_NAME,
                null,
                "$COL_IS_UPLOADED = 0",
                null,
                null,
                null,
                "$COL_CREATED_AT_MS ASC",
                limit.toString()
            )
            cursor.use { c ->
                val idLogId = c.getColumnIndexOrThrow(COL_LOG_ID)
                val idActionId = c.getColumnIndexOrThrow(COL_ACTION_ID)
                val idTime = c.getColumnIndexOrThrow(COL_TIMESTAMP)
                val idDev = c.getColumnIndexOrThrow(COL_DEVICE_ID)
                val idEvt = c.getColumnIndexOrThrow(COL_EVENT_TYPE)
                val idMod = c.getColumnIndexOrThrow(COL_MODULE)
                val idTrig = c.getColumnIndexOrThrow(COL_TRIGGERED_BY)
                val idDesc = c.getColumnIndexOrThrow(COL_DESCRIPTION)
                val idStat = c.getColumnIndexOrThrow(COL_STATUS)
                val idFail = c.getColumnIndexOrThrow(COL_FAILURE_REASON)
                val idUp = c.getColumnIndexOrThrow(COL_BYTES_UPLOADED)
                val idDown = c.getColumnIndexOrThrow(COL_BYTES_DOWNLOADED)
                val idNet = c.getColumnIndexOrThrow(COL_NETWORK_TYPE)

                while (c.moveToNext()) {
                    list.add(
                        EdrActionLog(
                            logId = c.getString(idLogId),
                            actionId = c.getString(idActionId),
                            timestamp = c.getString(idTime),
                            deviceId = c.getString(idDev),
                            eventType = c.getString(idEvt),
                            module = c.getString(idMod),
                            triggeredBy = c.getString(idTrig),
                            description = c.getString(idDesc),
                            status = c.getString(idStat),
                            failureReason = if (!c.isNull(idFail)) c.getString(idFail) else null,
                            bytesUploaded = c.getLong(idUp),
                            bytesDownloaded = c.getLong(idDown),
                            networkType = c.getString(idNet)
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed reading pending action logs: ${e.message}")
        }
        return list
    }

    @Synchronized
    fun markUploaded(logIds: List<String>) {
        if (logIds.isEmpty()) return
        try {
            val db = writableDatabase
            db.beginTransaction()
            try {
                val values = ContentValues().apply {
                    put(COL_IS_UPLOADED, 1)
                }
                for (id in logIds) {
                    db.update(TABLE_NAME, values, "$COL_LOG_ID = ?", arrayOf(id))
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed marking action logs uploaded: ${e.message}")
        }
    }

    @Synchronized
    fun cleanupOldLogs(retentionDays: Int = 90) {
        try {
            val cutoff = System.currentTimeMillis() - (retentionDays.toLong() * 24L * 60L * 60L * 1000L)
            val db = writableDatabase
            // Delete logs older than retention period that were uploaded, or if table exceeds 50,000 rows
            val deleted = db.delete(TABLE_NAME, "$COL_CREATED_AT_MS < ? AND $COL_IS_UPLOADED = 1", arrayOf(cutoff.toString()))
            if (deleted > 0) {
                Log.i(TAG, "Cleaned up $deleted expired action logs (older than $retentionDays days).")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed cleaning up old action logs: ${e.message}")
        }
    }

    @Synchronized
    fun getTotalDataUsage(): Triple<Long, Long, Long> {
        var totalUp = 0L
        var totalDown = 0L
        try {
            val db = readableDatabase
            val cursor = db.rawQuery(
                "SELECT SUM($COL_BYTES_UPLOADED), SUM($COL_BYTES_DOWNLOADED) FROM $TABLE_NAME",
                null
            )
            cursor.use { c ->
                if (c.moveToFirst()) {
                    totalUp = if (!c.isNull(0)) c.getLong(0) else 0L
                    totalDown = if (!c.isNull(1)) c.getLong(1) else 0L
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error calculating total data usage: ${e.message}")
        }
        return Triple(totalUp + totalDown, totalUp, totalDown)
    }

    companion object {
        private const val TAG = "EdrActionLogDb"
        private const val DB_NAME = "edr_action_logs.db"
        private const val DB_VERSION = 1

        private const val TABLE_NAME = "action_logs"
        private const val COL_LOG_ID = "log_id"
        private const val COL_ACTION_ID = "action_id"
        private const val COL_TIMESTAMP = "timestamp"
        private const val COL_DEVICE_ID = "device_id"
        private const val COL_EVENT_TYPE = "event_type"
        private const val COL_MODULE = "module"
        private const val COL_TRIGGERED_BY = "triggered_by"
        private const val COL_DESCRIPTION = "description"
        private const val COL_STATUS = "status"
        private const val COL_FAILURE_REASON = "failure_reason"
        private const val COL_BYTES_UPLOADED = "bytes_uploaded"
        private const val COL_BYTES_DOWNLOADED = "bytes_downloaded"
        private const val COL_NETWORK_TYPE = "network_type"
        private const val COL_IS_UPLOADED = "is_uploaded"
        private const val COL_CREATED_AT_MS = "created_at_ms"

        @Volatile
        private var instance: EdrActionLogDatabase? = null

        fun getInstance(context: Context): EdrActionLogDatabase {
            return instance ?: synchronized(this) {
                instance ?: EdrActionLogDatabase(context.applicationContext).also { instance = it }
            }
        }
    }
}
