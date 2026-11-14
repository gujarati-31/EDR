import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';

function getFolderSizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      } else if (entry.isDirectory()) {
        total += getFolderSizeBytes(full);
      }
    }
  } catch {}
  return total;
}

export function createVaultRouter(): Router {
  const router = Router();

  const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
  const RECORDINGS_DIR = path.join(UPLOADS_DIR, 'recordings');
  const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
  const DATA_DIR = path.resolve(process.cwd(), 'data');
  const DB_FILE = path.join(DATA_DIR, 'edr_database.json');

  // Vault Overview & Storage Statistics
  router.get('/overview', (req, res) => {
    try {
      const devices = db.getDevices();
      const onlineDevices = devices.filter((d) => d.status === 'ONLINE').length;
      const recordings = db.getRecordings();
      const photos = db.getIntruderPhotos();
      const logs = db.getLogs(undefined, undefined, 5000);
      const rawData = db.getRawData();

      const recordingsDiskBytes = getFolderSizeBytes(RECORDINGS_DIR);
      const photosDiskBytes = getFolderSizeBytes(PHOTOS_DIR);
      const dbSizeBytes = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;
      const totalDiskBytes = recordingsDiskBytes + photosDiskBytes + dbSizeBytes;

      res.json({
        success: true,
        stats: {
          totalDevices: devices.length,
          onlineDevices,
          totalRecordings: recordings.length,
          totalPhotos: photos.length,
          totalLogs: logs.length,
          totalInstalledApps: rawData.installedApps?.length || 0,
          totalAppUsages: rawData.appUsage?.length || 0,
          totalCommands: rawData.commands?.length || 0,
          recordingsDiskBytes,
          photosDiskBytes,
          dbSizeBytes,
          totalDiskBytes,
        },
        encryption: {
          status: 'ACTIVE_ENCRYPTED_AT_REST',
          algorithm: 'AES-256-GCM',
          tagLength: '128-bit Authenticated Tag',
          nonceLength: '96-bit Random IV',
          magicHeader: 'EDR1',
          keyDerivation: 'SHA-256 of master secret',
          description: 'All media files stored on disk are strictly AES-256-GCM ciphertext. Plaintext never touches disk.',
        },
        storagePaths: {
          recordingsDir: RECORDINGS_DIR,
          photosDir: PHOTOS_DIR,
          databaseFile: DB_FILE,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // All recordings across all devices
  router.get('/recordings', (req, res) => {
    try {
      const devices = db.getDevices();
      const deviceMap = new Map(devices.map((d) => [d.deviceId, d]));
      const recordings = db.getRecordings().map((r) => {
        const dev = deviceMap.get(r.deviceId);
        return {
          ...r,
          deviceName: dev?.deviceName || r.deviceId,
          osVersion: dev?.osVersion,
          isOnline: dev?.status === 'ONLINE',
        };
      });
      res.json({ success: true, data: recordings });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // All photos across all devices
  router.get('/photos', (req, res) => {
    try {
      const devices = db.getDevices();
      const deviceMap = new Map(devices.map((d) => [d.deviceId, d]));
      const photos = db.getIntruderPhotos().map((p) => {
        const dev = deviceMap.get(p.deviceId);
        return {
          ...p,
          deviceName: dev?.deviceName || p.deviceId,
          osVersion: dev?.osVersion,
          isOnline: dev?.status === 'ONLINE',
        };
      });
      res.json({ success: true, data: photos });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Database Dump & Summary
  router.get('/database', (req, res) => {
    try {
      const rawData = db.getRawData();
      res.json({
        success: true,
        data: {
          devices: rawData.devices || [],
          commands: rawData.commands || [],
          logs: (rawData.logs || []).slice(0, 1000),
          appUsage: rawData.appUsage || [],
          installedApps: (rawData.installedApps || []).slice(0, 500),
          policiesCount: Object.keys(rawData.policies || {}).length,
          recordingsCount: rawData.recordings?.length || 0,
          photosCount: rawData.photos?.length || 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 1-Click Database Export (JSON Download)
  router.get('/export', (req, res) => {
    try {
      const rawData = db.getRawData();
      const now = new Date();
      const filename = `edr_database_backup_${now.toISOString().replace(/[:.]/g, '-')}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(rawData, null, 2));
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
}
