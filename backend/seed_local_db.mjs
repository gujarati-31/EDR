import fs from 'fs';
import path from 'path';

const DB_FILE = path.resolve('data', 'edr_database.json');

const now = new Date();
const todayStr = now.toISOString().split('T')[0];
const yesterday = new Date(now.getTime() - 86400000);
const yesterdayStr = yesterday.toISOString().split('T')[0];

const fullData = {
  devices: [
    {
      id: "2b5e1656-7b29-479c-b805-bbef697e7706",
      deviceId: "1ab2f2adddf2c534",
      deviceName: "vivo V2334",
      isCustomName: false,
      osVersion: "Android 14 (OriginOS 4 / Funtouch OS 14)",
      ipAddress: "192.168.1.105",
      status: "ONLINE",
      batteryLevel: 82,
      isDeviceOwner: true,
      enrolledAt: "2026-10-29T18:12:27.756Z",
      lastHeartbeat: now.toISOString(),
      lastSyncedTimestamp: now.toISOString(),
      isLiveConnected: true,
      networkQuality: "FAST",
      downstreamKbps: 98500,
      networkType: "5G",
      networkLabel: "5G Standalone (Ultra-Fast)",
      isCloudUploadAllowed: true,
      appVersionCode: 13,
      appVersionName: "3.9.0",
      permissions: {
        accessibility: true,
        usageStats: true,
        batteryOptimization: true,
        manageStorage: true,
        camera: true,
        notifications: true,
        deviceAdmin: true,
        overlay: true,
        installPackages: true,
        callLog: true
      }
    }
  ],
  policies: {
    "1ab2f2adddf2c534": {
      deviceId: "1ab2f2adddf2c534",
      blockScreenCapture: false,
      disableCamera: false,
      disableUsbTransfer: false,
      blockUsbDebugging: false,
      blockUnknownSources: false,
      blockFactoryReset: false,
      isolateNetwork: false,
      nightlySyncEnabled: true,
      nightlySyncTime: "23:00",
      trapAppPackages: [
        "com.whatsapp",
        "com.google.android.apps.nbu.paisa.user",
        "com.instagram.android"
      ],
      updatedAt: now.toISOString()
    }
  },
  commands: [
    {
      id: "cmd_001",
      deviceId: "1ab2f2adddf2c534",
      commandType: "FETCH_CALL_LOGS",
      status: "EXECUTED",
      createdAt: now.toISOString(),
      resultMessage: "Call log harvesting triggered and synchronized with cloud.",
      executedAt: now.toISOString()
    }
  ],
  logs: [
    {
      id: "log_001",
      deviceId: "1ab2f2adddf2c534",
      eventType: "TRAP_ALERT",
      severity: "WARNING",
      message: "Trap app opened: WhatsApp. 30 FPS hardware screen recording started.",
      payload: { packageName: "com.whatsapp", fps: 30, mode: "HARDWARE_SURFACE" },
      eventTimestamp: new Date(now.getTime() - 120000).toISOString()
    },
    {
      id: "log_002",
      deviceId: "1ab2f2adddf2c534",
      eventType: "EVIDENCE",
      severity: "INFO",
      message: "Uploaded attacker video for WhatsApp (01:25) to EDR server. Removing local copy from phone.",
      payload: { app: "WhatsApp", duration: "01:25", network: "5G Standalone" },
      eventTimestamp: new Date(now.getTime() - 60000).toISOString()
    },
    {
      id: "log_003",
      deviceId: "1ab2f2adddf2c534",
      eventType: "CALL_SYNC",
      severity: "INFO",
      message: "Synchronized 7 call records with duration metrics to central vault.",
      payload: { count: 7 },
      eventTimestamp: now.toISOString()
    },
    {
      id: "log_004",
      deviceId: "1ab2f2adddf2c534",
      eventType: "DATA_SAVER",
      severity: "INFO",
      message: "Connected to 5G Ultra-Fast. Immediate cloud upload active.",
      payload: { network: "5G", downstreamKbps: 98500 },
      eventTimestamp: now.toISOString()
    }
  ],
  appUsage: [
    {
      id: "usage_001",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.whatsapp",
      appName: "WhatsApp",
      foregroundSeconds: 6300,
      launchCount: 18,
      usageDate: todayStr
    },
    {
      id: "usage_002",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.google.android.youtube",
      appName: "YouTube",
      foregroundSeconds: 7800,
      launchCount: 8,
      usageDate: todayStr
    },
    {
      id: "usage_003",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.android.chrome",
      appName: "Google Chrome",
      foregroundSeconds: 3300,
      launchCount: 12,
      usageDate: todayStr
    },
    {
      id: "usage_004",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.google.android.apps.nbu.paisa.user",
      appName: "Google Pay",
      foregroundSeconds: 720,
      launchCount: 4,
      usageDate: todayStr
    },
    {
      id: "usage_005",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.instagram.android",
      appName: "Instagram",
      foregroundSeconds: 4200,
      launchCount: 14,
      usageDate: todayStr
    }
  ],
  installedApps: [
    {
      id: "app_001",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.whatsapp",
      appName: "WhatsApp Messenger",
      versionName: "2.24.21.79",
      isSystemApp: false,
      installedAt: "2026-05-10T10:00:00Z"
    },
    {
      id: "app_002",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.google.android.apps.nbu.paisa.user",
      appName: "Google Pay (Tez)",
      versionName: "185.1.4",
      isSystemApp: false,
      installedAt: "2026-06-15T12:00:00Z"
    },
    {
      id: "app_003",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.instagram.android",
      appName: "Instagram",
      versionName: "354.0.0",
      isSystemApp: false,
      installedAt: "2026-07-20T14:30:00Z"
    },
    {
      id: "app_004",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.android.chrome",
      appName: "Google Chrome",
      versionName: "130.0.6723",
      isSystemApp: true,
      installedAt: "2026-01-01T00:00:00Z"
    },
    {
      id: "app_005",
      deviceId: "1ab2f2adddf2c534",
      packageName: "com.google.android.youtube",
      appName: "YouTube",
      versionName: "19.42.34",
      isSystemApp: true,
      installedAt: "2026-01-01T00:00:00Z"
    }
  ],
  photos: [],
  recordings: [
    {
      id: "rec_001",
      deviceId: "1ab2f2adddf2c534",
      filename: "trap_WhatsApp__2026-11-15__08-20-00.mp4",
      url: "/uploads/recordings/trap_WhatsApp__2026-11-15__08-20-00.mp4",
      recordingType: "APP_TRAP",
      appName: "WhatsApp",
      packageName: "com.whatsapp",
      duration: "01:25",
      sizeBytes: 15420000,
      timestamp: new Date(now.getTime() - 3600000).toISOString(),
      createdAt: new Date(now.getTime() - 3600000).toISOString()
    },
    {
      id: "rec_002",
      deviceId: "1ab2f2adddf2c534",
      filename: "trap_Google_Pay__2026-11-15__07-45-12.mp4",
      url: "/uploads/recordings/trap_Google_Pay__2026-11-15__07-45-12.mp4",
      recordingType: "APP_TRAP",
      appName: "Google Pay",
      packageName: "com.google.android.apps.nbu.paisa.user",
      duration: "00:48",
      sizeBytes: 9240000,
      timestamp: new Date(now.getTime() - 7200000).toISOString(),
      createdAt: new Date(now.getTime() - 7200000).toISOString()
    }
  ],
  callLogs: [
    {
      id: "call_001",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_1",
      phoneNumber: "+91 98250 12345",
      callerName: "Amit Sharma",
      callType: "INCOMING",
      timestamp: now.getTime() - 1800000,
      callDate: todayStr,
      durationSeconds: 345,
      formattedDuration: "5m 45s",
      simSlot: "SIM 1",
      createdAt: now.toISOString()
    },
    {
      id: "call_002",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_2",
      phoneNumber: "+91 98791 67890",
      callerName: "Priya Patel",
      callType: "OUTGOING",
      timestamp: now.getTime() - 7200000,
      callDate: todayStr,
      durationSeconds: 750,
      formattedDuration: "12m 30s",
      simSlot: "SIM 1",
      createdAt: now.toISOString()
    },
    {
      id: "call_003",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_3",
      phoneNumber: "+91 22 6123 4567",
      callerName: "ICICI Bank Alert",
      callType: "INCOMING",
      timestamp: now.getTime() - 14400000,
      callDate: todayStr,
      durationSeconds: 115,
      formattedDuration: "1m 55s",
      simSlot: "SIM 2",
      createdAt: now.toISOString()
    },
    {
      id: "call_004",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_4",
      phoneNumber: "+91 94260 99887",
      callerName: "Unknown Caller",
      callType: "MISSED",
      timestamp: now.getTime() - 28800000,
      callDate: todayStr,
      durationSeconds: 0,
      formattedDuration: "0s (Missed)",
      simSlot: "SIM 1",
      createdAt: now.toISOString()
    },
    {
      id: "call_005",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_5",
      phoneNumber: "+91 99090 11223",
      callerName: "Office Manager",
      callType: "OUTGOING",
      timestamp: now.getTime() - 43200000,
      callDate: todayStr,
      durationSeconds: 1820,
      formattedDuration: "30m 20s",
      simSlot: "SIM 1",
      createdAt: now.toISOString()
    },
    {
      id: "call_006",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_6",
      phoneNumber: "+91 140 9234567",
      callerName: "Suspected Spam",
      callType: "REJECTED",
      timestamp: now.getTime() - 57600000,
      callDate: yesterdayStr,
      durationSeconds: 0,
      formattedDuration: "0s (Rejected)",
      simSlot: "SIM 2",
      createdAt: now.toISOString()
    },
    {
      id: "call_007",
      deviceId: "1ab2f2adddf2c534",
      callId: "call_1731650000_7",
      phoneNumber: "+91 97240 55443",
      callerName: "Rahul Verma",
      callType: "INCOMING",
      timestamp: now.getTime() - 86400000,
      callDate: yesterdayStr,
      durationSeconds: 420,
      formattedDuration: "7m 00s",
      simSlot: "SIM 1",
      createdAt: now.toISOString()
    }
  ],
  releases: []
};

fs.writeFileSync(DB_FILE, JSON.stringify(fullData, null, 2), 'utf-8');
console.log('Successfully seeded local edr_database.json with device, call history with durations, app usage, and logs!');
