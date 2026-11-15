const BASE = 'https://phone-edr-central.onrender.com/api';

async function seedRender() {
  console.log('Seeding Render Cloud Backend at:', BASE);

  const devicePayload = {
    deviceId: "1ab2f2adddf2c534",
    deviceName: "vivo V2334",
    osVersion: "Android 14 (OriginOS 4 / Funtouch OS 14)",
    batteryLevel: 82,
    isDeviceOwner: true,
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
  };

  // 1. Seed or Upsert Device
  try {
    const res = await fetch(`${BASE}/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devicePayload)
    });
    const json = await res.json();
    console.log('1. Device Registration:', json.success ? 'OK' : json);
  } catch (e) {
    console.warn('1. Device register error (will proceed):', e.message);
  }

  // 2. Seed Call Logs with Exact Duration
  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(now - 86400000).toISOString().split('T')[0];

  const callLogs = [
    {
      callId: "call_001",
      phoneNumber: "+91 98250 12345",
      callerName: "Amit Sharma",
      callType: "INCOMING",
      timestamp: now - 1800000,
      callDate: todayStr,
      durationSeconds: 345,
      formattedDuration: "5m 45s",
      simSlot: "SIM 1"
    },
    {
      callId: "call_002",
      phoneNumber: "+91 98791 67890",
      callerName: "Priya Patel",
      callType: "OUTGOING",
      timestamp: now - 7200000,
      callDate: todayStr,
      durationSeconds: 750,
      formattedDuration: "12m 30s",
      simSlot: "SIM 1"
    },
    {
      callId: "call_003",
      phoneNumber: "+91 22 6123 4567",
      callerName: "ICICI Bank Alert",
      callType: "INCOMING",
      timestamp: now - 14400000,
      callDate: todayStr,
      durationSeconds: 115,
      formattedDuration: "1m 55s",
      simSlot: "SIM 2"
    },
    {
      callId: "call_004",
      phoneNumber: "+91 94260 99887",
      callerName: "Unknown Caller",
      callType: "MISSED",
      timestamp: now - 28800000,
      callDate: todayStr,
      durationSeconds: 0,
      formattedDuration: "0s (Missed)",
      simSlot: "SIM 1"
    },
    {
      callId: "call_005",
      phoneNumber: "+91 99090 11223",
      callerName: "Office Manager",
      callType: "OUTGOING",
      timestamp: now - 43200000,
      callDate: todayStr,
      durationSeconds: 1820,
      formattedDuration: "30m 20s",
      simSlot: "SIM 1"
    },
    {
      callId: "call_006",
      phoneNumber: "+91 140 9234567",
      callerName: "Suspected Spam",
      callType: "REJECTED",
      timestamp: now - 57600000,
      callDate: yesterdayStr,
      durationSeconds: 0,
      formattedDuration: "0s (Rejected)",
      simSlot: "SIM 2"
    },
    {
      callId: "call_007",
      phoneNumber: "+91 97240 55443",
      callerName: "Rahul Verma",
      callType: "INCOMING",
      timestamp: now - 86400000,
      callDate: yesterdayStr,
      durationSeconds: 420,
      formattedDuration: "7m 00s",
      simSlot: "SIM 1"
    }
  ];

  try {
    const res = await fetch(`${BASE}/call-logs/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: "1ab2f2adddf2c534",
        callLogs
      })
    });
    const json = await res.json();
    console.log('2. Call Logs Seeding:', json.success ? `OK (${json.count} calls)` : json);
  } catch (e) {
    console.warn('2. Call logs error:', e.message);
  }

  // 3. Seed App Usage / Screen Time
  const usage = [
    { packageName: "com.whatsapp", appName: "WhatsApp", foregroundSeconds: 6300, launchCount: 18, usageDate: todayStr },
    { packageName: "com.google.android.youtube", appName: "YouTube", foregroundSeconds: 7800, launchCount: 8, usageDate: todayStr },
    { packageName: "com.android.chrome", appName: "Google Chrome", foregroundSeconds: 3300, launchCount: 12, usageDate: todayStr },
    { packageName: "com.google.android.apps.nbu.paisa.user", appName: "Google Pay", foregroundSeconds: 720, launchCount: 4, usageDate: todayStr },
    { packageName: "com.instagram.android", appName: "Instagram", foregroundSeconds: 4200, launchCount: 14, usageDate: todayStr }
  ];

  try {
    const res = await fetch(`${BASE}/usage/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: "1ab2f2adddf2c534",
        usage
      })
    });
    const json = await res.json();
    console.log('3. Screen Time Seeding:', json.success ? `OK (${json.count} apps)` : json);
  } catch (e) {
    console.warn('3. Screen Time error:', e.message);
  }

  // 4. Seed Installed Apps
  const apps = [
    { packageName: "com.whatsapp", appName: "WhatsApp Messenger", versionName: "2.24.21.79", isSystemApp: false },
    { packageName: "com.google.android.apps.nbu.paisa.user", appName: "Google Pay (Tez)", versionName: "185.1.4", isSystemApp: false },
    { packageName: "com.instagram.android", appName: "Instagram", versionName: "354.0.0", isSystemApp: false },
    { packageName: "com.android.chrome", appName: "Google Chrome", versionName: "130.0.6723", isSystemApp: true },
    { packageName: "com.google.android.youtube", appName: "YouTube", versionName: "19.42.34", isSystemApp: true }
  ];

  try {
    const res = await fetch(`${BASE}/usage/apps/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: "1ab2f2adddf2c534",
        apps
      })
    });
    const json = await res.json();
    console.log('4. Installed Apps Seeding:', json.success ? `OK (${json.count} apps)` : json);
  } catch (e) {
    console.warn('4. Installed Apps error:', e.message);
  }

  // 5. Seed Telemetry Logs
  const logs = [
    {
      deviceId: "1ab2f2adddf2c534",
      eventType: "TRAP_ALERT",
      severity: "WARNING",
      message: "Trap app opened: WhatsApp. 30 FPS hardware screen recording started.",
      payload: { packageName: "com.whatsapp", fps: 30, mode: "HARDWARE_SURFACE" },
      eventTimestamp: new Date(now - 120000).toISOString()
    },
    {
      deviceId: "1ab2f2adddf2c534",
      eventType: "EVIDENCE",
      severity: "INFO",
      message: "Uploaded attacker video for WhatsApp (01:25) to EDR server. Removing local copy from phone.",
      payload: { app: "WhatsApp", duration: "01:25", network: "5G Standalone" },
      eventTimestamp: new Date(now - 60000).toISOString()
    },
    {
      deviceId: "1ab2f2adddf2c534",
      eventType: "CALL_SYNC",
      severity: "INFO",
      message: "Synchronized 7 call records with duration metrics to central vault.",
      payload: { count: 7 },
      eventTimestamp: new Date(now).toISOString()
    },
    {
      deviceId: "1ab2f2adddf2c534",
      eventType: "DATA_SAVER",
      severity: "INFO",
      message: "Connected to 5G Ultra-Fast. Immediate cloud upload active.",
      payload: { network: "5G", downstreamKbps: 98500 },
      eventTimestamp: new Date(now).toISOString()
    }
  ];

  try {
    const res = await fetch(`${BASE}/logs/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: "1ab2f2adddf2c534",
        logs
      })
    });
    const json = await res.json();
    console.log('5. Telemetry Logs Seeding:', json.success ? `OK (${json.count} logs)` : json);
  } catch (e) {
    console.warn('5. Telemetry Logs error:', e.message);
  }

  console.log('=== All Cloud Seed Requests Dispatched! ===');
}

seedRender();
