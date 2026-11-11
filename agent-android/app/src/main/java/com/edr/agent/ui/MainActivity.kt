package com.edr.agent.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.edr.agent.R
import com.edr.agent.permission.EdrPermissionManager
import com.edr.agent.permission.PermissionItem
import com.edr.agent.scheduler.SyncScheduler
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences

class MainActivity : AppCompatActivity() {

    private lateinit var tvProtectionScore: TextView
    private lateinit var tvProtectionSubtext: TextView
    private lateinit var cardAllGranted: LinearLayout
    private lateinit var tvPendingHeader: TextView
    private lateinit var containerPendingPermissions: LinearLayout
    private lateinit var sectionGranted: LinearLayout
    private lateinit var containerGrantedPermissions: LinearLayout
    private lateinit var btnRefreshStatus: Button
    private lateinit var tvConnectionStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvProtectionScore = findViewById(R.id.tvProtectionScore)
        tvProtectionSubtext = findViewById(R.id.tvProtectionSubtext)
        cardAllGranted = findViewById(R.id.cardAllGranted)
        tvPendingHeader = findViewById(R.id.tvPendingHeader)
        containerPendingPermissions = findViewById(R.id.containerPendingPermissions)
        sectionGranted = findViewById(R.id.sectionGranted)
        containerGrantedPermissions = findViewById(R.id.containerGrantedPermissions)
        btnRefreshStatus = findViewById(R.id.btnRefreshStatus)
        tvConnectionStatus = findViewById(R.id.tvConnectionStatus)

        val hostExtra = intent?.getStringExtra("server_host")
        if (!hostExtra.isNullOrBlank()) {
            SyncPreferences.serverHost = hostExtra
        }

        btnRefreshStatus.setOnClickListener {
            refreshPermissionsUI()
        }

        // Request battery optimization exemption for background EDR operation
        requestBatteryExemption()

        // Prompt OEM autostart permission on aggressive skins (Xiaomi MIUI/HyperOS, Vivo FuntouchOS, Oppo ColorOS)
        promptOemAutostartPermission()

        // Ensure EDR service & WebSocket are actively running without killing existing instance
        ensureServiceRunning()

        // Save & refresh all EDR info in /EDR folder
        EdrLocalStorage.saveEdrInfo(this)

        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val hostExtra = intent?.getStringExtra("server_host")
        if (!hostExtra.isNullOrBlank()) {
            SyncPreferences.serverHost = hostExtra
            ensureServiceRunning()
        }
        if (intent?.getBooleanExtra("trigger_sync", false) == true) {
            SyncScheduler.triggerImmediateSync(this)
        }
    }

    override fun onResume() {
        super.onResume()
        ensureServiceRunning()
        refreshPermissionsUI()
    }

    /**
     * Evaluates all permissions dynamically.
     * Permissions that are TURNED ON are hidden from the pending list.
     * Permissions that are TURNED OFF immediately appear so the user can turn them on.
     * Also syncs live permission states to the central backend.
     */
    private fun refreshPermissionsUI() {
        val allItems = EdrPermissionManager.getAllPermissionItems(this)
        val pendingItems = allItems.filter { !it.isGranted }
        val grantedItems = allItems.filter { it.isGranted }

        val isServiceRunning = EdrForegroundService.instance != null
        tvConnectionStatus.text = if (isServiceRunning) "ACTIVE" else "STARTING"
        tvConnectionStatus.setBackgroundColor(if (isServiceRunning) Color.parseColor("#064E3B") else Color.parseColor("#78350F"))
        tvConnectionStatus.setTextColor(if (isServiceRunning) Color.parseColor("#34D399") else Color.parseColor("#FBBF24"))

        // Update score
        tvProtectionScore.text = "${grantedItems.size}/${allItems.size} Protections Configured"

        if (pendingItems.isEmpty()) {
            // ALL GRANTED
            cardAllGranted.visibility = View.VISIBLE
            tvPendingHeader.visibility = View.GONE
            containerPendingPermissions.visibility = View.GONE
            tvProtectionSubtext.text = "All endpoint security shields are operating normally. 100% Protected."
        } else {
            cardAllGranted.visibility = View.GONE
            tvPendingHeader.visibility = View.VISIBLE
            tvPendingHeader.text = "REQUIRED PROTECTIONS (${pendingItems.size} NEEDED - TAP TO TURN ON)"
            containerPendingPermissions.visibility = View.VISIBLE
            tvProtectionSubtext.text = "Tap any protection item below to grant permission and secure the device."
        }

        // Render Pending Permissions ONLY (Turned Off permissions)
        containerPendingPermissions.removeAllViews()
        for (item in pendingItems) {
            containerPendingPermissions.addView(createPendingPermissionCard(item))
        }

        // Granted (Turned On) permissions are completely hidden from the phone screen
        containerGrantedPermissions.removeAllViews()
        sectionGranted.visibility = View.GONE

        // Sync latest status to central EDR backend & WebSocket gateway
        EdrPermissionManager.syncPermissionsToServer(this) { msg ->
            EdrForegroundService.instance?.sendWebSocketMessage(msg) ?: false
        }
    }

    private fun createPendingPermissionCard(item: PermissionItem): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E293B"))
            setPadding(36, 32, 36, 32)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 24)
            }
            layoutParams = lp
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val textContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val titleView = TextView(this).apply {
            text = item.title
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
        }

        val descView = TextView(this).apply {
            text = item.description
            textSize = 11f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 8, 0, 0)
        }

        textContainer.addView(titleView)
        textContainer.addView(descView)

        val turnOnButton = Button(this).apply {
            text = "TURN ON"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#2563EB"))
            setTextColor(Color.WHITE)
            setPadding(28, 12, 28, 12)
            setOnClickListener {
                val intent = EdrPermissionManager.getLaunchIntentForPermission(this@MainActivity, item.key)
                if (intent != null) {
                    try {
                        startActivity(intent)
                    } catch (e: Exception) {
                        android.util.Log.e("MainActivity", "Failed opening permission intent for ${item.key}: ${e.message}")
                    }
                }
            }
        }

        row.addView(textContainer)
        row.addView(turnOnButton)
        card.addView(row)

        card.setOnClickListener {
            turnOnButton.performClick()
        }

        return card
    }

    private fun createGrantedPermissionRow(item: PermissionItem): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0F172A"))
            setPadding(28, 18, 28, 18)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
            layoutParams = lp
        }

        val titleView = TextView(this).apply {
            text = "✓  ${item.title}"
            textSize = 12f
            setTypeface(null, Typeface.NORMAL)
            setTextColor(Color.parseColor("#CBD5E1"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val statusBadge = TextView(this).apply {
            text = "ACTIVE"
            textSize = 10f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#34D399"))
        }

        row.addView(titleView)
        row.addView(statusBadge)
        return row
    }

    private fun ensureServiceRunning() {
        try {
            if (EdrForegroundService.instance == null) {
                val serviceIntent = Intent(this, EdrForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
            } else {
                if (EdrForegroundService.instance?.isWebSocketConnected() != true) {
                    EdrForegroundService.instance?.reconnectWebSocket()
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed ensuring EDR service running: ${e.message}", e)
        }
    }

    private fun requestBatteryExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "Battery optimization prompt skipped: ${e.message}")
            }
        }
    }

    private fun promptOemAutostartPermission() {
        val prefs = getSharedPreferences("edr_oem_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("oem_autostart_prompted", false)) return

        val manufacturer = Build.MANUFACTURER.lowercase()
        val oemIntents = mutableListOf<Intent>()

        when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
            }
            manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")))
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")))
            }
            manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")))
            }
            manufacturer.contains("huawei") || manufacturer.contains("honor") -> {
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")))
                oemIntents.add(Intent().setComponent(android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")))
            }
        }

        for (intent in oemIntents) {
            try {
                if (packageManager.resolveActivity(intent, 0) != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(intent)
                    prefs.edit().putBoolean("oem_autostart_prompted", true).apply()
                    break
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "Failed to launch OEM autostart activity: ${e.message}")
            }
        }
    }
}
