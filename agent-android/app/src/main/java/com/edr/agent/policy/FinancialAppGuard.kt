package com.edr.agent.policy

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * FinancialAppGuard: Excludes Google Pay (GPay), UPI wallets, and banking applications
 * from EDR Accessibility Service scope, screenshots, live streams, and trap recordings.
 */
object FinancialAppGuard {
    private const val TAG = "FinancialAppGuard"

    private val classificationCache = ConcurrentHashMap<String, Boolean>()

    @Volatile
    var currentForegroundPkg: String = ""

    @Volatile
    var isFinancialForegroundActive: Boolean = false

    @Volatile
    private var lastForegroundQueryTime: Long = 0L

    /**
     * Explicit registry of UPI, Wallet, Payment, and Major Banking package names.
     */
    private val EXPLICIT_FINANCIAL_PACKAGES = setOf(
        // UPI & Payment Wallets
        "com.google.android.apps.nbu.paisa.user",     // Google Pay (India)
        "com.google.android.apps.walletnfcrel",       // Google Wallet
        "com.phonepe.app",                            // PhonePe
        "com.phonepe.app.business",                   // PhonePe Business
        "net.one97.paytm",                            // Paytm
        "com.paytm.merchants",                        // Paytm for Business
        "com.paytmmall",                              // Paytm Mall
        "in.org.npci.upiapp",                         // BHIM UPI
        "org.npci.upi.security.pinactivitycomponent", // NPCI Common Library / UPI PIN Pad
        "com.dreamplug.androidapp",                   // CRED
        "com.mobikwik_new",                           // MobiKwik
        "com.freecharge.android",                     // Freecharge
        "com.bharatpe.app",                           // BharatPe
        "com.bharatpe.merchant",                      // BharatPe Merchant
        "com.slice",                                  // Slice
        "indwin.c3.shareapp",                         // Slice / Pay
        "money.jupiter",                              // Jupiter Money
        "com.epifi.paisa",                            // Fi Money
        "com.naviapp",                                // Navi
        "com.paypal.android.p2pmobile",               // PayPal
        "com.samsung.android.spay",                   // Samsung Pay / Wallet
        "com.mipay.wallet.in",                        // Mi Pay
        "com.airtel.money",                           // Airtel Payments Bank
        "com.android.systemui.plugin.globalactions.wallet",

        // Major Indian & Global Banks
        "com.sbi.lotusintouch",                       // YONO SBI
        "com.sbi.SBIFreedomPlus",                     // YONO Lite SBI
        "com.sbi.upi",                                // BHIM SBI Pay
        "com.snapwork.hdfc",                          // HDFC Bank MobileBanking
        "com.hdfc.retail.netbanking",                 // HDFC Bank
        "com.enstage.wibmo.hdfc",                     // HDFC PayZapp
        "com.hdfcbank.payzapp",                       // HDFC PayZapp v2
        "com.csam.icici.bank.imobile",                // ICICI iMobile Pay
        "com.icicibank.pockets",                      // ICICI Pockets
        "com.axis.mobile",                            // Axis Mobile (open)
        "com.axis.netbanking",                        // Axis Bank
        "com.msf.kbank.mobile",                       // Kotak Mahindra Bank
        "com.kotak811mobilebankingapp.instep",        // Kotak811
        "com.kotak.bank.kotak811",                    // Kotak811
        "com.bankofbaroda.mconnect",                  // bob World
        "com.bankofbaroda.upi",                       // bob World UPI
        "com.Version1",                               // PNB ONE
        "com.fss.pnbpsp",                             // BHIM PNB
        "com.canarabank.mobility",                    // Canara ai1
        "com.unionbank.ecommerce.mobile.android",     // Vyom Union Bank
        "com.idfcfirstbank.optimus",                  // IDFC FIRST Bank
        "com.indusind.mobilebanking",                 // IndusMobile
        "com.indusind.indie",                         // INDIE by IndusInd
        "com.yesbank.yesmobile",                      // YES Mobile
        "in.co.yesbank.paynext",                      // IRIS by YES BANK
        "com.rblbank.mobank",                         // RBL MoBank
        "com.aubank.aubank",                          // AU 0101
        "com.federalbank.fedmobile",                  // FedMobile
        "com.konylabs.cbapp",                         // Central Bank Cent Mobile
        "com.iob.iobmobile",                          // IOB Mobile
        "com.indianbank.indpay",                      // IndOASIS Indian Bank
        "com.infrasofttech.indianBank",               // Indian Bank
        "com.bankofindia.boi",                        // BOI Mobile
        "com.dbs.in.digibank",                        // digibank by DBS
        "com.scb.breezemobile.in",                    // Standard Chartered India
        "com.citi.citimobile",                        // Citibank
        "com.hsbc.hsbcindia",                         // HSBC India
        "com.fss.jnkpsp",                             // J&K Bank mPay
        "com.lcode.ucopay",                           // UCO mBanking
        "com.mgs.indusmobile",                        // IndusInd
        "com.barclays.android.barclaysmobilebanking"  // Barclays
    )

    private val PACKAGE_KEYWORDS = listOf(
        "paisa", "gpay", "phonepe", "paytm", "bhim", "yono", "imobile",
        "netbanking", "bobworld", "payzapp", "kotak", "hdfc", "icici",
        "axisbank", "idfcfirst", "indusind", "canarabank", "yesbank",
        "rblbank", "aubank", "federalbank", "bankofbaroda", "bankofindia",
        "unionbank", "npci", "mconnect", "passbook", "finserv"
    )

    private val LABEL_KEYWORDS = listOf(
        "google pay", "gpay", "phonepe", "paytm", "bhim", "yono",
        "imobile", "payzapp", "netbanking", "mobile banking", "passbook",
        "upi", "bob world", "kotak", "hdfc bank", "icici", "axis mobile"
    )

    private val CORE_SYSTEM_PREFIXES = listOf(
        "com.android.",
        "com.google.android.gms",
        "com.google.android.gsf",
        "com.google.android.inputmethod",
        "com.google.android.permissioncontroller",
        "com.google.android.packageinstaller",
        "com.vivo.",
        "com.bbk.",
        "com.iqoo.",
        "com.miui.",
        "com.xiaomi.",
        "com.mediatek.",
        "com.qualcomm."
    )

    fun isFinancialApp(context: Context, packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val pkg = packageName.trim()
        if (pkg == context.packageName) return false

        classificationCache[pkg]?.let { return it }

        val result = evaluateFinancialApp(context, pkg)
        classificationCache[pkg] = result
        return result
    }

    private fun evaluateFinancialApp(context: Context, pkg: String): Boolean {
        if (pkg in EXPLICIT_FINANCIAL_PACKAGES) return true

        // Skip generic OS/framework packages (except explicit wallet packages checked above)
        val lowerPkg = pkg.lowercase()
        if (lowerPkg == "android") return false
        for (prefix in CORE_SYSTEM_PREFIXES) {
            if (lowerPkg.startsWith(prefix)) return false
        }

        // Check package name segments & strong financial identifiers
        val tokens = lowerPkg.split('.', '_', '-')
        if ("bank" in tokens || "upi" in tokens || "banking" in tokens || "sbi" in tokens || "cred" in tokens) {
            return true
        }
        for (kw in PACKAGE_KEYWORDS) {
            if (lowerPkg.contains(kw)) return true
        }

        // Check resolved app label (only for installed third-party packages)
        try {
            val pm = context.packageManager
            val appInfo = pm.getApplicationInfo(pkg, 0)
            val label = pm.getApplicationLabel(appInfo).toString().lowercase()
            for (kw in LABEL_KEYWORDS) {
                if (label.contains(kw)) return true
            }
            if (Regex("\\bbank\\b|\\bbanking\\b").containsMatchIn(label)) {
                return true
            }
        } catch (_: Exception) {
        }

        return false
    }

    /**
     * Transient system overlays (biometric/fingerprint prompts, keyboards, NPCI PIN screens,
     * system dialogs) that frequently appear over GPay / bank apps mid-payment.
     * Keep any active Banking Shield state intact while these are briefly shown.
     */
    fun isPaymentBridgeOrOverlay(pkg: String): Boolean {
        if (pkg.isBlank()) return true
        val p = pkg.lowercase()
        return p == "android" ||
            p == "com.android.systemui" ||
            p.contains("fingerprint") ||
            p.contains("biometric") ||
            p.contains("faceui") ||
            p.contains("inputmethod") ||
            p.contains("keyboard") ||
            p.contains("permissioncontroller") ||
            p.contains("npci") ||
            p.contains("gms.wallet") ||
            p.contains("autofill") ||
            p.contains("chooser") ||
            p.contains("resolver")
    }

    /**
     * Queries UsageStatsManager for the most recent foreground app (ACTIVITY_RESUMED).
     * Automatically widens lookback to 15 minutes if no transition occurred in the immediate window.
     */
    fun queryLatestForegroundPackage(context: Context, lookbackMs: Long = 5000L): String? {
        return try {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
                ?: return null
            val now = System.currentTimeMillis()
            val immediate = findLastResumedInWindow(usm, now - lookbackMs, now)
            if (immediate != null) return immediate
            findLastResumedInWindow(usm, now - 900_000L, now)
        } catch (_: Exception) {
            null
        }
    }

    private fun findLastResumedInWindow(usm: UsageStatsManager, startMs: Long, endMs: Long): String? {
        val events = usm.queryEvents(startMs, endMs) ?: return null
        val event = UsageEvents.Event()
        var latestPkg: String? = null
        var latestTs = 0L

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED && event.timeStamp >= latestTs) {
                val pkg = event.packageName
                if (!pkg.isNullOrBlank()) {
                    latestPkg = pkg
                    latestTs = event.timeStamp
                }
            }
        }
        return latestPkg
    }

    /**
     * Master exclusion check: returns true if the package is a statically excluded financial/banking app
     * OR if it has been dynamically selected for exclusion by the administrator from the dashboard.
     * Note: GPay and banking apps are excluded statically by default and cannot be accidentally un-excluded.
     */
    fun isAppExcluded(context: Context, packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val pkg = packageName.trim()
        if (pkg == context.packageName) return false

        // 1. Dynamic admin-selected exclusion
        if (com.edr.agent.storage.SyncPreferences.isAppExcludedByAdmin(pkg)) {
            return true
        }

        // 2. Static baseline: Google Pay, UPI wallets & Banking apps (always excluded by default)
        return isFinancialApp(context, pkg)
    }

    /**
     * Real-time check before capturing any screen frame, screenshot, or video.
     * Throttles UsageStats queries to avoid overhead during high-FPS screen streaming.
     */
    fun isCurrentForegroundFinancial(context: Context): Boolean {
        val now = System.currentTimeMillis()
        if (now - lastForegroundQueryTime > 300L) {
            lastForegroundQueryTime = now
            val latest = queryLatestForegroundPackage(context, 4000L)
            if (!latest.isNullOrBlank()) {
                if (isAppExcluded(context, latest)) {
                    currentForegroundPkg = latest
                    isFinancialForegroundActive = true
                } else if (!isPaymentBridgeOrOverlay(latest)) {
                    currentForegroundPkg = latest
                    isFinancialForegroundActive = false
                }
            }
        }
        return isFinancialForegroundActive ||
            (currentForegroundPkg.isNotBlank() && isAppExcluded(context, currentForegroundPkg))
    }

    /**
     * Builds the allowed Accessibility package list containing ALL installed applications
     * EXCEPT EDR itself, EXCEPT all GPay / UPI / Banking apps, and EXCEPT admin-excluded apps.
     */
    fun getAllowedAccessibilityPackages(context: Context): Array<String> {
        return try {
            val pm = context.packageManager
            val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            val allowed = ArrayList<String>(installed.size)
            var excludedCount = 0
            for (appInfo in installed) {
                val pkg = appInfo.packageName
                if (pkg == context.packageName) continue
                if (isAppExcluded(context, pkg)) {
                    excludedCount++
                    continue
                }
                allowed.add(pkg)
            }
            Log.i(TAG, "Built Accessibility package scope: ${allowed.size} allowed, $excludedCount apps excluded (banking/GPay defaults + admin selections).")
            allowed.toTypedArray()
        } catch (e: Exception) {
            Log.w(TAG, "Failed building allowed package list: ${e.message}")
            emptyArray()
        }
    }

    fun clearCache() {
        classificationCache.clear()
    }
}
