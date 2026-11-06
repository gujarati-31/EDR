import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';
import { encryptBuffer, encryptFileInPlace, readAndDecryptFile } from '../utils/crypto.js';

const execAsync = promisify(exec);

// Tracks whether the admin desires the device to be connected
const desiredConnectionMap = new Map<string, boolean>();

function getAdbPath(): string {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidatePaths = [
    path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'C:\\Users\\ASUS\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
    'C:\\Android\\platform-tools\\adb.exe',
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'adb';
}

async function getConnectedAdbSerial(adb: string): Promise<string | null> {
  try {
    let { stdout } = await execAsync(`"${adb}" devices`);
    let lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);

    // If an attached device is 'offline', trigger adb reconnect and re-check
    const offlineLine = lines.find((l) => l.includes('offline'));
    if (offlineLine) {
      try {
        await execAsync(`"${adb}" reconnect offline`);
        await new Promise((r) => setTimeout(r, 1500));
        const res = await execAsync(`"${adb}" devices`);
        lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      } catch (e) {}
    }

    for (const line of lines) {
      if (line.includes('\tdevice') && !line.includes('offline')) {
        return line.split('\t')[0].trim();
      }
    }
  } catch (e) {}
  return null;
}

async function checkDeviceInternetAndWake(
  device: any,
  gateway: EDRWebSocketGateway
): Promise<{
  success: boolean;
  internetOff?: boolean;
  errorType?: 'INTERNET_OFF' | 'SLOW_INTERNET' | 'APP_NOT_INSTALLED' | 'APP_STOPPED' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
}> {
  const deviceId = device.deviceId;

  // 1. If device is already online and connected
  if (gateway.isDeviceOnline(deviceId)) {
    return { success: true, message: `${device.deviceName} is already connected and online.` };
  }

  const adb = getAdbPath();
  const adbSerial = await getConnectedAdbSerial(adb);

  if (adbSerial) {
    // Check A: Is the EDR Agent APK actually installed on the phone?
    try {
      const { stdout: pkgCheck } = await execAsync(`"${adb}" -s ${adbSerial} shell pm path com.edr.agent`);
      if (!pkgCheck.includes('package:')) {
        return {
          success: false,
          errorType: 'APP_NOT_INSTALLED',
          message: 'EDR Agent app is NOT installed on the phone. Please install DeviceServices.apk first.',
        };
      }
    } catch (err) {}

    // Check B: Are Wi-Fi and Mobile Data both toggled OFF?
    let mobileData = false;
    let wifiOn = false;
    try {
      const { stdout: netSettings } = await execAsync(
        `"${adb}" -s ${adbSerial} shell "settings get global mobile_data; settings get global wifi_on"`,
        { timeout: 3000 }
      );
      const parts = netSettings.trim().split(/\s+/);
      mobileData = parts[0] === '1';
      wifiOn = parts[1] === '1';
    } catch (err) {}

    if (!mobileData && !wifiOn) {
      return {
        success: false,
        internetOff: true,
        errorType: 'INTERNET_OFF',
        message: 'Phone Internet is completely OFF (Both Wi-Fi and Mobile Data are disabled).',
      };
    }

    // Check C: Test real internet reachability and latency via ICMP ping from the phone
    let isPingSuccessful = false;
    let avgPingMs = 0;
    try {
      const { stdout: pingRes } = await execAsync(
        `"${adb}" -s ${adbSerial} shell "ping -c 2 -W 2 8.8.8.8"`,
        { timeout: 5000 }
      );
      if (pingRes.includes('bytes from')) {
        isPingSuccessful = true;
        const rttMatch = pingRes.match(/min\/avg\/max\/(?:mdev|stddev)\s*=\s*[\d.]+\/([\d.]+)/);
        if (rttMatch) {
          avgPingMs = parseFloat(rttMatch[1]);
        }
      }
    } catch (e) {}

    if (!isPingSuccessful) {
      return {
        success: false,
        internetOff: true,
        errorType: 'INTERNET_OFF',
        message: 'No Internet Access: Wi-Fi/Data toggle is ON, but phone cannot reach internet servers (no network signal or captive portal).',
      };
    }

    // Check D: Is the EDR process running?
    let isAppRunning = false;
    try {
      const { stdout: pidOut } = await execAsync(`"${adb}" -s ${adbSerial} shell pidof com.edr.agent`);
      isAppRunning = pidOut.trim().length > 0;
    } catch (e) {}

    // Wake up agent and establish connection
    try {
      // 1. Ensure USB reverse tunnel is forwarding port 3000
      await execAsync(`"${adb}" -s ${adbSerial} reverse tcp:3000 tcp:3000`);
      // 2. Broadcast wake-up to EDR Connect Receiver
      await execAsync(
        `"${adb}" -s ${adbSerial} shell am broadcast -a com.edr.agent.ACTION_RECONNECT -n com.edr.agent/.receiver.EdrConnectReceiver`
      );
      // 3. Ensure foreground service is running
      try {
        await execAsync(
          `"${adb}" -s ${adbSerial} shell am startforegroundservice -n com.edr.agent/.service.EdrForegroundService`
        );
      } catch (e1) {
        try {
          await execAsync(
            `"${adb}" -s ${adbSerial} shell am startservice -n com.edr.agent/.service.EdrForegroundService`
          );
        } catch (e2) {}
      }
      // 4. If app wasn't running, start it
      if (!isAppRunning) {
        await execAsync(
          `"${adb}" -s ${adbSerial} shell am start -n com.edr.agent/.ui.MainActivity -f 0x10000000`
        );
      }
    } catch (e) {}

    // Wait up to 8 seconds for WebSocket connection
    const startTime = Date.now();
    while (Date.now() - startTime < 8000) {
      await new Promise((r) => setTimeout(r, 500));
      if (gateway.isDeviceOnline(deviceId)) {
        if (avgPingMs > 500) {
          return {
            success: true,
            errorType: 'SLOW_INTERNET',
            message: `${device.deviceName} connected! (Note: Phone internet latency is high: ${Math.round(avgPingMs)}ms)`,
          };
        }
        return { success: true, message: `${device.deviceName} connected successfully!` };
      }
    }

    // Handshake timed out: inspect logcat for exact diagnostic reason
    let diagnostic = 'WebSocket handshake timed out.';
    let detectedErrorType: 'INTERNET_OFF' | 'SLOW_INTERNET' | 'APP_STOPPED' | 'TIMEOUT' = 'TIMEOUT';

    try {
      const { stdout: logcat } = await execAsync(
        `"${adb}" -s ${adbSerial} logcat -d -t 30 -s EdrWebSocketClient:V EdrForegroundService:V`
      );
      if (logcat.includes('SocketTimeoutException') || logcat.includes('timeout')) {
        diagnostic = 'Client internet is too slow: connection attempt timed out during handshake.';
        detectedErrorType = 'SLOW_INTERNET';
      } else if (logcat.includes('UnknownHostException')) {
        diagnostic = 'DNS resolution failed: phone network cannot resolve central server address.';
        detectedErrorType = 'INTERNET_OFF';
      } else if (logcat.includes('Connection refused')) {
        diagnostic = 'Connection refused by target server.';
      } else if (logcat.includes('WebSocket failure:')) {
        const match = logcat.match(/WebSocket failure:\s*([^\r\n]+)/);
        if (match) diagnostic = match[1].trim();
      }
    } catch (e) {}

    if (avgPingMs > 500) {
      detectedErrorType = 'SLOW_INTERNET';
      diagnostic = `Client Internet is SLOW (Ping: ${Math.round(avgPingMs)}ms). Handshake could not complete in time.`;
    } else if (!isAppRunning) {
      detectedErrorType = 'APP_STOPPED';
      diagnostic = 'EDR background service was stopped by OS battery saver. Please open the Device Services app on phone.';
    }

    return {
      success: false,
      errorType: detectedErrorType,
      message: `${device.deviceName} failed to connect. ${diagnostic}`,
    };
  }

  // Pure network mode: device is not connected via USB ADB (remote cellular / Wi-Fi)
  gateway.broadcastToDashboards('DEVICE_CONNECT_REQUESTED', { deviceId });

  // Wait up to 15 seconds for device background poller (10s cycle) to pick up connection request
  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    await new Promise((r) => setTimeout(r, 500));
    if (gateway.isDeviceOnline(deviceId)) {
      return { success: true, message: `${device.deviceName} connected successfully!` };
    }
  }

  // Diagnostic based on stored device telemetry
  const now = Date.now();
  const lastBeatTime = new Date(device.lastHeartbeat || 0).getTime();
  const minutesAgo = Math.round((now - lastBeatTime) / 60000);

  let diagMsg = `Connection request dispatched, but ${device.deviceName} did not respond within 15 seconds.`;
  let errorType: 'INTERNET_OFF' | 'SLOW_INTERNET' | 'APP_STOPPED' | 'TIMEOUT' = 'TIMEOUT';

  if (device.networkQuality === 'SLOW') {
    diagMsg = `Client Internet is SLOW: Phone was operating on low bandwidth. Ensure phone has strong Wi-Fi or 4G/5G signal.`;
    errorType = 'SLOW_INTERNET';
  } else if (minutesAgo < 5) {
    diagMsg = `Phone was online recently (${minutesAgo} min ago) but missed the wake-up signal. Internet connection on the phone is likely slow or disconnected.`;
    errorType = 'SLOW_INTERNET';
  } else if (minutesAgo > 120) {
    const timeText = minutesAgo > 1440 ? `${Math.round(minutesAgo / 1440)} day(s)` : `${Math.round(minutesAgo / 60)} hour(s)`;
    diagMsg = `Phone has been offline for ${timeText}. The device is powered off, out of battery, or EDR Agent was stopped.`;
    errorType = 'INTERNET_OFF';
  }

  if (device.batteryLevel !== undefined && device.batteryLevel < 10) {
    diagMsg += ` (Note: Battery was critical at ${device.batteryLevel}%, Android Doze may have killed background sync).`;
  }

  return {
    success: false,
    errorType,
    message: diagMsg,
  };
}

export function createDeviceRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // List all devices
  router.get('/', (req, res) => {
    const devices = db.getDevices().map((d) => ({
      ...d,
      isLiveConnected: gateway.isDeviceOnline(d.deviceId),
    }));
    res.json({ success: true, count: devices.length, data: devices });
  });

  // Get single device
  router.get('/:id', (req, res) => {
    const device = db.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    const policy = db.getPolicy(device.deviceId);
    const recentCommands = db.getCommands(device.deviceId).slice(0, 10);
    const isLiveConnected = gateway.isDeviceOnline(device.deviceId);

    res.json({
      success: true,
      data: {
        ...device,
        isLiveConnected,
        policy,
        recentCommands,
      },
    });
  });

  // Endpoint for Android Agent to check whether connection is desired by server
  router.get('/:id/connection-status', (req, res) => {
    const device = db.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    const shouldConnect = desiredConnectionMap.get(device.deviceId) !== false;
    res.json({
      success: true,
      deviceId: device.deviceId,
      shouldConnect,
      isLiveConnected: gateway.isDeviceOnline(device.deviceId),
    });
  });

  // Manual disconnect endpoint from dashboard
  router.post('/:id/disconnect', (req, res) => {
    const device = db.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    desiredConnectionMap.set(device.deviceId, false);

    // First try sending DISCONNECT_DEVICE command to phone if connected
    const command = db.addCommand({
      deviceId: device.deviceId,
      commandType: 'DISCONNECT_DEVICE',
      parameters: {},
    });
    gateway.sendCommand(device.deviceId, command);

    // Close socket from server side
    setTimeout(() => {
      gateway.disconnectDevice(device.deviceId);
    }, 400);

    res.json({ success: true, message: `${device.deviceName} disconnected from server` });
  });

  // Manual connect request from dashboard
  router.post('/:id/connect', async (req, res) => {
    const device = db.getDeviceById(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    desiredConnectionMap.set(device.deviceId, true);

    const result = await checkDeviceInternetAndWake(device, gateway);
    if (result.success) {
      db.updateDeviceStatus(device.deviceId, 'ONLINE');
      gateway.broadcastToDashboards('DEVICE_STATUS_CHANGED', {
        deviceId: device.deviceId,
        status: 'ONLINE',
      });
    }

    res.json({
      success: result.success,
      internetOff: result.internetOff ?? false,
      errorType: result.errorType,
      message: result.message,
    });
  });

  // Register device via HTTP (Agent bootstrap)
  router.post('/register', (req, res) => {
    const { deviceId, deviceName, osVersion, batteryLevel, isDeviceOwner } = req.body;
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }

    const device = db.upsertDevice({
      deviceId,
      deviceName,
      osVersion,
      batteryLevel,
      isDeviceOwner: isDeviceOwner ?? true,
      status: 'ONLINE',
    });

    const policy = db.getPolicy(deviceId);
    gateway.broadcastToDashboards('DEVICE_REGISTERED', device);

    res.json({
      success: true,
      message: 'Device enrolled successfully',
      data: { device, policy },
    });
  });

  // Deregister / remove device
  router.delete('/:id', (req, res) => {
    const success = db.deleteDevice(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    gateway.broadcastToDashboards('DEVICE_DELETED', { id: req.params.id });
    res.json({ success: true, message: 'Device removed successfully' });
  });

  // Upload Intruder Evidence Photos & Live Screen Proofs
  router.post('/:deviceId/photos', (req, res) => {
    const { deviceId } = req.params;
    const { frontPhotoBase64, backPhotoBase64, screenPhotoBase64, timestamp, triggerReason, photoType } = req.body;

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const PHOTOS_DIR = path.resolve(process.cwd(), 'uploads', 'photos');
    if (!fs.existsSync(PHOTOS_DIR)) {
      fs.mkdirSync(PHOTOS_DIR, { recursive: true });
    }

    const photoId = crypto.randomUUID();
    const timeSafe = (timestamp || new Date().toISOString()).replace(/[:.]/g, '-');
    const isLiveScreen =
      photoType === 'LIVE_SCREEN_PROOF' ||
      triggerReason?.toLowerCase().includes('live screen') ||
      triggerReason?.toLowerCase().includes('proof');

    const resolvedPhotoType: 'CAMERA_PHOTO' | 'LIVE_SCREEN_PROOF' = isLiveScreen
      ? 'LIVE_SCREEN_PROOF'
      : 'CAMERA_PHOTO';

    let frontPhotoUrl: string | undefined;
    let backPhotoUrl: string | undefined;
    let screenPhotoUrl: string | undefined;
    let frontPhotoPath: string | undefined;
    let backPhotoPath: string | undefined;
    let screenPhotoPath: string | undefined;

    if (isLiveScreen) {
      const imgBase64 = screenPhotoBase64 || frontPhotoBase64;
      if (imgBase64) {
        const screenFilename = `livescreen_${device.deviceId}_${timeSafe}.jpg`;
        screenPhotoPath = path.join(PHOTOS_DIR, screenFilename);
        const buffer = Buffer.from(imgBase64, 'base64');
        fs.writeFileSync(screenPhotoPath, encryptBuffer(buffer));
        screenPhotoUrl = `/api/devices/${device.deviceId}/photos/${photoId}/screen`;
        frontPhotoUrl = screenPhotoUrl; // fallback
        frontPhotoPath = screenPhotoPath;
      }
    } else {
      if (frontPhotoBase64) {
        const frontFilename = `front_${device.deviceId}_${timeSafe}.jpg`;
        frontPhotoPath = path.join(PHOTOS_DIR, frontFilename);
        const frontBuffer = Buffer.from(frontPhotoBase64, 'base64');
        fs.writeFileSync(frontPhotoPath, encryptBuffer(frontBuffer));
        frontPhotoUrl = `/api/devices/${device.deviceId}/photos/${photoId}/front`;
      }

      if (backPhotoBase64) {
        const backFilename = `back_${device.deviceId}_${timeSafe}.jpg`;
        backPhotoPath = path.join(PHOTOS_DIR, backFilename);
        const backBuffer = Buffer.from(backPhotoBase64, 'base64');
        fs.writeFileSync(backPhotoPath, encryptBuffer(backBuffer));
        backPhotoUrl = `/api/devices/${device.deviceId}/photos/${photoId}/back`;
      }
    }

    const reason = triggerReason || (isLiveScreen ? 'Live Screen Forensic Proof Snapshot' : 'Manual Camera Request');

    const photoRecord = db.addIntruderPhoto({
      deviceId: device.deviceId,
      photoType: resolvedPhotoType,
      frontPhotoUrl,
      backPhotoUrl,
      screenPhotoUrl,
      frontPhotoPath,
      backPhotoPath,
      screenPhotoPath,
      triggerReason: reason,
      timestamp: timestamp || new Date().toISOString(),
    });

    // Record security audit log
    db.addLogs([
      {
        deviceId: device.deviceId,
        eventType: 'SECURITY_ALERT',
        severity: isLiveScreen ? 'INFO' : 'WARNING',
        message: isLiveScreen
          ? `Live Screen Forensic Snapshot Saved: ${reason}`
          : `Intruder Snapshot [${reason}]: Camera photos captured [Front: ${frontPhotoUrl ? 'YES' : 'NO'}, Back: ${backPhotoUrl ? 'YES' : 'NO'}]`,
        payload: {
          photoId: photoRecord.id,
          photoType: resolvedPhotoType,
          triggerReason: reason,
          screenPhotoUrl,
          frontPhotoUrl,
          backPhotoUrl,
        },
        eventTimestamp: timestamp || new Date().toISOString(),
      },
    ]);

    // Broadcast to dashboards
    gateway.broadcastToDashboards('PHOTO_CAPTURED', photoRecord);

    res.json({
      success: true,
      message: isLiveScreen ? 'Live screen proof saved successfully' : 'Intruder evidence photo saved successfully',
      data: photoRecord,
    });
  });

  // Get all photos for a device
  router.get('/:deviceId/photos', (req, res) => {
    const { deviceId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const photos = db.getIntruderPhotos(targetId);

    // Ensure URLs point directly to the API endpoints so dashboard can always load them
    const mapped = photos.map((p) => {
      const isLiveScreen =
        p.photoType === 'LIVE_SCREEN_PROOF' ||
        p.triggerReason?.toLowerCase().includes('live screen') ||
        p.triggerReason?.toLowerCase().includes('proof');

      const photoType = isLiveScreen ? 'LIVE_SCREEN_PROOF' : 'CAMERA_PHOTO';

      return {
        ...p,
        photoType,
        screenPhotoUrl: p.screenPhotoPath && fs.existsSync(p.screenPhotoPath)
          ? `/api/devices/${targetId}/photos/${p.id}/screen`
          : (isLiveScreen ? `/api/devices/${targetId}/photos/${p.id}/screen` : undefined),
        frontPhotoUrl: !isLiveScreen && p.frontPhotoPath && fs.existsSync(p.frontPhotoPath)
          ? `/api/devices/${targetId}/photos/${p.id}/front`
          : (isLiveScreen ? undefined : p.frontPhotoUrl),
        backPhotoUrl: p.backPhotoPath && fs.existsSync(p.backPhotoPath)
          ? `/api/devices/${targetId}/photos/${p.id}/back`
          : p.backPhotoUrl,
      };
    });

    res.json({ success: true, count: mapped.length, data: mapped });
  });

  // Direct Image Stream: Live Screen Proof Snapshot (AES-256-GCM Decrypted on-the-fly)
  router.get('/:deviceId/photos/:photoId/screen', (req, res) => {
    const { deviceId, photoId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const photo = db.getIntruderPhotos(targetId).find((p) => p.id === photoId);

    const filePath = photo?.screenPhotoPath || photo?.frontPhotoPath;
    if (!photo || !filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Screen proof photo not found' });
    }

    try {
      const decrypted = readAndDecryptFile(filePath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(decrypted);
    } catch (e: any) {
      res.status(500).json({ success: false, message: 'Decryption failed: ' + e.message });
    }
  });

  // Direct Image Stream: Front Camera Photo (AES-256-GCM Decrypted on-the-fly)
  router.get('/:deviceId/photos/:photoId/front', (req, res) => {
    const { deviceId, photoId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const photo = db.getIntruderPhotos(targetId).find((p) => p.id === photoId);

    if (!photo || !photo.frontPhotoPath || !fs.existsSync(photo.frontPhotoPath)) {
      return res.status(404).json({ success: false, message: 'Front photo not found' });
    }

    try {
      const decrypted = readAndDecryptFile(photo.frontPhotoPath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(decrypted);
    } catch (e: any) {
      res.status(500).json({ success: false, message: 'Decryption failed: ' + e.message });
    }
  });

  // Direct Image Stream: Back Camera Photo (AES-256-GCM Decrypted on-the-fly)
  router.get('/:deviceId/photos/:photoId/back', (req, res) => {
    const { deviceId, photoId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const photo = db.getIntruderPhotos(targetId).find((p) => p.id === photoId);

    if (!photo || !photo.backPhotoPath || !fs.existsSync(photo.backPhotoPath)) {
      return res.status(404).json({ success: false, message: 'Back photo not found' });
    }

    try {
      const decrypted = readAndDecryptFile(photo.backPhotoPath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(decrypted);
    } catch (e: any) {
      res.status(500).json({ success: false, message: 'Decryption failed: ' + e.message });
    }
  });

  // Delete a photo evidence record
  router.delete('/:deviceId/photos/:photoId', (req, res) => {
    const { photoId } = req.params;
    const success = db.deleteIntruderPhoto(photoId);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Photo not found' });
    }
    gateway.broadcastToDashboards('PHOTO_DELETED', { photoId });
    res.json({ success: true, message: 'Photo evidence record deleted' });
  });

  // Recorded Live Screen Video Storage Configuration
  const RECORDINGS_DIR = path.resolve(process.cwd(), 'uploads', 'recordings');
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

  const recordingStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(RECORDINGS_DIR)) {
        fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
      }
      cb(null, RECORDINGS_DIR);
    },
    filename: (req, file, cb) => {
      const deviceId = req.params.deviceId || 'device';
      const timeSafe = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(file.originalname) || '.mp4';
      const isTrap = file.originalname.startsWith('trap_');
      const prefix = isTrap ? 'trap' : 'livescreen';
      cb(null, `${prefix}_${deviceId}_${timeSafe}${ext}`);
    },
  });

  const uploadRecording = multer({ storage: recordingStorage });

  // Upload a live screen or trap video recording
  router.post('/:deviceId/recordings', uploadRecording.single('video'), (req, res) => {
    const { deviceId } = req.params;
    const { duration, recordingType } = req.body;
    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file provided' });
    }

    const isTrap = req.file.filename.startsWith('trap_') || recordingType === 'APP_TRAP';
    const resolvedType: 'APP_TRAP' | 'LIVE_SCREEN' = isTrap ? 'APP_TRAP' : 'LIVE_SCREEN';

    // Encrypt video file in-place on disk with AES-256-GCM
    try {
      encryptFileInPlace(req.file.path);
    } catch (e: any) {
      console.error('[Crypto] Failed encrypting video recording on disk:', e.message);
    }

    const videoRecord = db.addRecording({
      deviceId: device.deviceId,
      filename: req.file.filename,
      url: `/uploads/recordings/${req.file.filename}`,
      recordingType: resolvedType,
      duration: duration || '00:00',
      sizeBytes: req.file.size,
      timestamp: new Date().toISOString(),
    });

    db.addLogs([
      {
        deviceId: device.deviceId,
        eventType: 'SECURITY_ALERT',
        severity: 'INFO',
        message: isTrap
          ? `App Trap Screen Video Recording Saved: ${req.file.filename} (Duration: ${duration || 'N/A'})`
          : `Live Screen Video Recording Saved: ${req.file.filename} (Duration: ${duration || 'N/A'})`,
        payload: {
          recordingId: videoRecord.id,
          recordingType: resolvedType,
          url: videoRecord.url,
          duration,
        },
        eventTimestamp: new Date().toISOString(),
      },
    ]);

    gateway.broadcastToDashboards('RECORDING_SAVED', videoRecord);
    res.json({ success: true, data: videoRecord });
  });

  // Get all recorded video sessions for device
  router.get('/:deviceId/recordings', (req, res) => {
    const { deviceId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const recordings = db.getRecordings(targetId).map((r) => ({
      ...r,
      recordingType: r.recordingType || (r.filename.startsWith('trap_') ? 'APP_TRAP' : 'LIVE_SCREEN'),
    }));
    res.json({ success: true, count: recordings.length, data: recordings });
  });

  // Direct Video Stream: AES-256-GCM Decrypted on-the-fly
  router.get('/:deviceId/recordings/:id/stream', (req, res) => {
    const { deviceId, id } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const rec = db.getRecordings(targetId).find((r) => r.id === id);
    if (!rec) return res.status(404).json({ success: false, message: 'Recording not found' });

    const filePath = path.join(RECORDINGS_DIR, rec.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'Recording file missing' });

    try {
      const decrypted = readAndDecryptFile(filePath);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', decrypted.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.send(decrypted);
    } catch (e: any) {
      res.status(500).json({ success: false, message: 'Decryption failed: ' + e.message });
    }
  });

  // Delete a recorded video
  router.delete('/:deviceId/recordings/:id', (req, res) => {
    const { deviceId, id } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const rec = db.getRecordings(targetId).find((r) => r.id === id);
    if (rec) {
      const filePath = path.join(RECORDINGS_DIR, rec.filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (ignored) {}
      }
      db.deleteRecording(id);
    }
    res.json({ success: true, message: 'Recording deleted' });
  });

  // ==========================================
  // ON-DEMAND DEVICE MEDIA EXPLORER (ZERO SERVER STORAGE)
  // Queries live photos/videos directly from device MediaStore.
  // Files are never saved to server disk or database.
  // ==========================================

  // 1. Fetch live media catalog with thumbnails from connected phone
  router.get('/:deviceId/live-media-list', async (req, res) => {
    const { deviceId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;

    // Retry grace period (up to 3 seconds) in case of brief reconnect
    let retries = 0;
    while (!gateway.isDeviceOnline(targetId) && retries < 6) {
      await new Promise((r) => setTimeout(r, 500));
      retries++;
    }

    if (!gateway.isDeviceOnline(targetId)) {
      return res.status(503).json({
        success: false,
        error: 'DEVICE_OFFLINE',
        message: 'Phone is offline. Device must be connected to browse live gallery photos & videos.',
      });
    }

    try {
      const typeFilter = ((req.query.type as string) || 'ALL').toUpperCase();
      const bucketFilter = (req.query.bucket as string) || undefined;
      const searchQuery = (req.query.search as string) || undefined;
      const offset = parseInt((req.query.offset as string) || '0', 10);
      const limit = parseInt((req.query.limit as string) || '60', 10);

      const result = await gateway.requestDeviceMediaList(targetId, {
        typeFilter,
        bucketFilter,
        searchQuery,
        offset,
        limit,
        includeThumbnails: true,
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error(`[Media] Error querying device ${targetId} media list:`, err.message);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed retrieving device media catalog',
      });
    }
  });

  // 2. Stream a specific photo or video file on-demand directly from phone to client HTTP response
  // ZERO server disk storage: chunks are piped in transient RAM directly to res.write()
  router.get('/:deviceId/live-media-file/:mediaId', async (req, res) => {
    const { deviceId, mediaId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;

    // Retry grace period (up to 3 seconds) in case of brief reconnect
    let retries = 0;
    while (!gateway.isDeviceOnline(targetId) && retries < 6) {
      await new Promise((r) => setTimeout(r, 500));
      retries++;
    }

    if (!gateway.isDeviceOnline(targetId)) {
      return res.status(503).send('Device is offline. Media streaming unavailable.');
    }

    const mediaType = ((req.query.type as string) || 'IMAGE').toUpperCase();
    const isDownload = req.query.download === '1' || req.query.download === 'true';
    const requestId = `med_file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const timer = setTimeout(() => {
      gateway.unregisterMediaStreamHandler(requestId);
      if (!res.headersSent) {
        res.status(504).send('Gateway timeout waiting for device media stream');
      } else {
        res.end();
      }
    }, 45000);

    gateway.registerMediaStreamHandler(requestId, {
      timer,
      onFirstChunk: (mimeType, fileName, totalBytes) => {
        const disposition = isDownload ? 'attachment' : 'inline';
        res.setHeader('Content-Type', mimeType || (mediaType === 'VIDEO' ? 'video/mp4' : 'image/jpeg'));
        if (totalBytes && totalBytes > 0) {
          res.setHeader('Content-Length', totalBytes);
        }
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName || `media_${mediaId}`)}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      },
      onChunk: (chunkBuffer) => {
        res.write(chunkBuffer);
      },
      onEnd: () => {
        clearTimeout(timer);
        res.end();
      },
      onError: (errMessage) => {
        clearTimeout(timer);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: errMessage });
        } else {
          res.end();
        }
      },
    });

    req.on('close', () => {
      clearTimeout(timer);
      gateway.unregisterMediaStreamHandler(requestId);
    });

    const sent = gateway.requestDeviceMediaFile(targetId, requestId, mediaId, mediaType);
    if (!sent) {
      clearTimeout(timer);
      gateway.unregisterMediaStreamHandler(requestId);
      if (!res.headersSent) {
        res.status(503).json({ success: false, message: 'Could not send stream request to device WebSocket' });
      }
    }
  });

  return router;
}

