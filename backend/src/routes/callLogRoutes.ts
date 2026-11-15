import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';
import { encryptFileInPlace, readAndDecryptFile } from '../utils/crypto.js';

const CALL_RECORDINGS_DIR = path.resolve(process.cwd(), 'uploads', 'call_recordings');
if (!fs.existsSync(CALL_RECORDINGS_DIR)) {
  fs.mkdirSync(CALL_RECORDINGS_DIR, { recursive: true });
}

const callStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, CALL_RECORDINGS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.m4a';
    const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${cleanBase}_${Date.now()}${ext}`);
  },
});

const callUpload = multer({
  storage: callStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per call audio
});

export function createCallLogRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // Upload Call Logs JSON from Android Agent
  router.post('/upload', (req, res) => {
    const { deviceId, callLogs } = req.body;
    if (!deviceId || !Array.isArray(callLogs)) {
      return res.status(400).json({ success: false, message: 'deviceId and callLogs array required' });
    }

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const recorded = db.recordCallLogs(device.deviceId, callLogs);

    gateway.broadcastToDashboards('CALL_LOGS_SYNCED', {
      deviceId: device.deviceId,
      count: recorded.length,
      totalCount: (db as any).data.callLogs?.filter((c: any) => c.deviceId === device.deviceId).length || 0,
    });

    res.json({
      success: true,
      count: recorded.length,
      message: `Synchronized ${recorded.length} new call log records.`,
      data: recorded,
    });
  });

  // Upload and encrypt call recording audio
  router.post('/upload-recording', callUpload.single('audio'), (req, res) => {
    const { deviceId, callId, phoneNumber, timestamp } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'Audio file is required' });
    }

    if (!deviceId) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ success: false, message: 'deviceId is required' });
    }

    // Encrypt call recording in-place on disk with AES-256-GCM
    try {
      encryptFileInPlace(file.path);
    } catch (e: any) {
      console.error('[Crypto] Failed encrypting call recording on disk:', e.message);
    }

    const ts = timestamp ? parseInt(timestamp, 10) : Date.now();
    const updatedEntry = db.attachCallRecording(
      deviceId,
      callId,
      phoneNumber,
      ts,
      file.filename,
      file.size
    );

    gateway.broadcastToDashboards('CALL_RECORDING_UPLOADED', {
      deviceId,
      callId,
      filename: file.filename,
      entry: updatedEntry,
    });

    res.json({
      success: true,
      filename: file.filename,
      url: `/api/call-logs/${deviceId}/recordings/${updatedEntry?.id || file.filename}/audio`,
      message: 'Call recording securely stored and encrypted with AES-256-GCM.',
    });
  });

  // Stream Decrypted Call Audio
  router.get('/:deviceId/recordings/:id/audio', (req, res) => {
    const { deviceId, id } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;

    // Find by call log ID or recordingFilename
    const allLogs = (db as any).data.callLogs || [];
    const log = allLogs.find(
      (c: any) => c.deviceId === targetId && (c.id === id || c.callId === id || c.recordingFilename === id)
    );

    const filename = log?.recordingFilename || (id.endsWith('.m4a') || id.endsWith('.mp3') || id.endsWith('.aac') || id.endsWith('.wav') ? id : null);

    if (!filename) {
      return res.status(404).json({ success: false, message: 'Call recording not found' });
    }

    const filePath = path.join(CALL_RECORDINGS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Call recording audio file missing from server disk' });
    }

    try {
      const decrypted = readAndDecryptFile(filePath);
      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === '.m4a' || ext === '.mp4' ? 'audio/mp4' : ext === '.aac' ? 'audio/aac' : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', decrypted.length);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(decrypted);
    } catch (e: any) {
      res.status(500).json({ success: false, message: 'Audio decryption failed: ' + e.message });
    }
  });

  // Get Call Logs & Duration Stats for a device
  router.get('/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const { type, date, search } = req.query as {
      type?: string;
      date?: string;
      search?: string;
    };

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const { logs, stats } = db.getCallLogs(device.deviceId, { type, date, search });

    const enrichedLogs = logs.map((l) => ({
      ...l,
      hasRecording: !!l.hasRecording || !!l.recordingFilename,
      recordingUrl: l.recordingFilename ? `/api/call-logs/${device.deviceId}/recordings/${l.id}/audio` : undefined,
    }));

    res.json({
      success: true,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      filters: { type: type || 'ALL', date: date || 'ALL', search: search || '' },
      stats,
      data: enrichedLogs,
    });
  });

  // Trigger Live Call Log Sync Command on Phone via WebSocket
  router.post('/:deviceId/sync', (req, res) => {
    const { deviceId } = req.params;
    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const command = db.addCommand({
      deviceId: device.deviceId,
      commandType: 'FETCH_CALL_LOGS',
      parameters: {
        timestamp: Date.now(),
        requestId: `callsync_${Date.now()}`,
      },
    });

    const sent = gateway.sendCommand(device.deviceId, command);

    res.json({
      success: sent,
      message: sent
        ? 'Sync command dispatched to phone. Harvesting latest call logs with duration...'
        : 'Device is offline. Sync command queued for next connection.',
    });
  });

  return router;
}
