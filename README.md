# Android Phone EDR & Device Policy Controller (MDM) Platform

A full-stack, enterprise-grade Android Endpoint Detection and Response (EDR) and Mobile Device Management (MDM) platform built with:
- **Central Backend Server**: Node.js, Express, TypeScript, SQLite/PostgreSQL persistence, and Bi-Directional WebSocket Gateway.
- **Web Management Dashboard**: React, TypeScript, Tailwind CSS, Lucide Icons (live policy toggle switchboard, real-time telemetry stream, screen time charts, active response action center).
- **Android EDR Agent**: Native Android (Kotlin), Device Policy Controller (DPC / Device Owner), WorkManager (11:00 PM scheduled delta sync & on-demand triggers), UsageStatsManager (screen time & app analytics), and tamper-proof protection.

---

## 📁 Project Architecture

```
Phone EDR/
├── backend/                  # Node.js + Express + TypeScript + WebSockets
│   ├── src/
│   │   ├── db/               # Local DB persistence with delta tracking
│   │   ├── gateway/          # WebSocket Bus for live commands & telemetry
│   │   ├── routes/           # REST endpoints (/devices, /policies, /commands, /logs, /usage)
│   │   └── types/            # Shared data contracts
├── management-dashboard/     # React + Vite + Tailwind CSS Web Portal
│   ├── src/
│   │   ├── components/       # Policy Switchboard, Action Center, Screen Time, Log Stream
│   │   ├── hooks/            # useWebSocket real-time hook
│   │   └── services/         # REST API client
└── agent-android/            # Android Kotlin Device Owner (DPC) Agent
    └── app/src/main/java/com/edr/agent/
        ├── admin/            # DeviceAdminReceiver & Device Owner provisioning
        ├── policy/           # Hardware & OS policy enforcer (Camera, USB, Screenshots)
        ├── responder/        # Remote Lock, Reboot, Wipe, Delete File, App Uninstall
        ├── scheduler/        # 11:00 PM WorkManager & "Get Logs" immediate sync
        ├── service/          # Persistent Foreground Service & WebSocket client
        └── telemetry/        # Screen Time (UsageStats) & App Inventory
```

---

## 🚀 How to Run in VS Code

You can run all three components concurrently inside VS Code using separate terminal tabs:

### 1. Terminal 1: Start Central Backend
```powershell
cd backend
npm run dev
```
* **API Server**: `http://localhost:3000/api`
* **WebSocket Bus**: `ws://localhost:3000/ws`

### 2. Terminal 2: Start Web Management Dashboard
```powershell
cd management-dashboard
npm run dev
```
* **Open in browser**: `http://localhost:5173`

### 3. Terminal 3: Build & Install Android EDR Agent

#### A. Compile APK
```powershell
cd agent-android
.\gradlew assembleDebug
```

#### B. Install onto Phone or Emulator
```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

#### C. Provision as Device Owner (Anti-Tamper & Security Control)
```powershell
adb shell dpm set-device-owner com.edr.agent/.admin.EdrDeviceAdminReceiver
```
> **Note**: Setting Device Owner gives the app enterprise management privileges so the user cannot uninstall or stop it from phone settings. To test on a personal device without factory resetting, remove any existing Google accounts before running the command, or test on an Android Emulator.

#### D. Launch the Agent
```powershell
adb shell am start -n com.edr.agent/.ui.MainActivity
```

#### E. Connecting Physical Phone over USB (Port Forwarding)
If using a physical phone connected via USB cable:
```powershell
adb reverse tcp:3000 tcp:3000
```
This routes `localhost:3000` from the phone directly to your computer!

---

## 🛡️ Key Features & Workflows

### 1. Delta Log Collection (Nightly 11:00 PM & Manual "Get Logs")
- **Last Sync Timestamp Anchor**: The agent and backend track `lastSyncedTimestamp`.
- **Scheduled 11:00 PM Sync**: Fires every night at 23:00 via Android `WorkManager`, uploading logs created between the last timestamp and 23:00.
- **On-Demand "Get Logs"**: Click **"Get Logs"** in the web dashboard. The backend dispatches `CMD_GET_LOGS` over WebSocket. The agent immediately collects delta logs from the previous timestamp up to right now, uploads them, and advances the anchor.

### 2. Security & Policy Switchboard (Live Remote ON/OFF)
From the dashboard, toggle any of the following switches in real-time:
* **Block Screen Capture & Recording** (`setScreenCaptureDisabled`)
* **Disable Hardware Camera** (`setCameraDisabled`)
* **Disable USB File Transfer** (`DISALLOW_USB_FILE_TRANSFER`)
* **Block USB Debugging (ADB)** (`DISALLOW_DEBUGGING_FEATURES`)
* **Block App Sideloading** (`DISALLOW_INSTALL_UNKNOWN_SOURCES`)
* **Block Factory Reset** (`DISALLOW_FACTORY_RESET`)
* **Network Containment / Isolation**

### 3. Active Response Capabilities
* **Lock Device**: Instantly locks phone screen.
* **Reboot Device**: Remotely reboots target phone.
* **Emergency Wipe**: Enterprise factory reset for lost or stolen devices.
* **Silent App Uninstall**: Remotely uninstalls unauthorized applications.
* **Remote File Deletion**: Delete photos, videos, PDFs, or APK files by specifying their file path.
* **Screen Time Analytics**: Daily breakdown of app foreground usage and launch counts.

