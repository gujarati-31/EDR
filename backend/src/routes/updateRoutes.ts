import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';

export function createUpdateRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  const RELEASES_DIR = path.resolve(process.cwd(), 'uploads', 'releases');
  if (!fs.existsSync(RELEASES_DIR)) {
    fs.mkdirSync(RELEASES_DIR, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(RELEASES_DIR)) {
        fs.mkdirSync(RELEASES_DIR, { recursive: true });
      }
      cb(null, RELEASES_DIR);
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `edr_agent_${Date.now()}_${safeName.endsWith('.apk') ? safeName : `${safeName}.apk`}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 120 * 1024 * 1024 }, // 120 MB max APK
    fileFilter: (_req, file, cb) => {
      if (file.originalname.toLowerCase().endsWith('.apk') || file.mimetype === 'application/vnd.android.package-archive') {
        cb(null, true);
      } else {
        cb(new Error('Only .apk files are allowed'));
      }
    },
  });

  // Get latest uploaded agent release metadata
  router.get('/latest', (_req, res) => {
    const latest = db.getLatestRelease();
    res.json({ success: true, data: latest });
  });

  // Get release upload history
  router.get('/history', (_req, res) => {
    res.json({ success: true, data: db.getReleases() });
  });

  // Admin uploads a new APK release from the Dashboard
  router.post('/', upload.single('apk'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No .apk file provided' });
    }

    const versionCode = parseInt(String(req.body.versionCode || '0'), 10);
    const versionName = String(req.body.versionName || '').trim();
    const releaseNotes = String(req.body.releaseNotes || '').trim();
    const pushToAll = String(req.body.pushToAll || 'false') === 'true';

    if (!versionCode || versionCode < 1 || !versionName) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        success: false,
        message: 'Both numeric versionCode (e.g. 7) and versionName (e.g. 3.4.0) are required',
      });
    }

    const fileBuf = fs.readFileSync(req.file.path);
    const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

    const release = db.saveRelease({
      versionCode,
      versionName,
      filename: req.file.filename,
      fileSize: req.file.size,
      sha256,
      releaseNotes: releaseNotes || `Agent release v${versionName}`,
      downloadUrl: `/api/updates/download/${encodeURIComponent(req.file.filename)}`,
    });

    let pushedCount = 0;
    if (pushToAll) {
      for (const dev of db.getDevices()) {
        if (gateway.isDeviceOnline(dev.deviceId)) {
          const cmd = db.addCommand({
            deviceId: dev.deviceId,
            commandType: 'UPDATE_AGENT',
            parameters: {
              versionCode: release.versionCode,
              versionName: release.versionName,
              downloadUrl: release.downloadUrl,
              sha256: release.sha256,
              releaseNotes: release.releaseNotes,
            },
          });
          if (gateway.sendCommand(dev.deviceId, cmd)) {
            pushedCount++;
          }
        }
      }
    }

    gateway.broadcastToDashboards('AGENT_RELEASE_UPLOADED', release);

    res.status(201).json({
      success: true,
      message: pushToAll
        ? `Uploaded v${release.versionName} (${release.versionCode}) and pushed to ${pushedCount} online device(s).`
        : `Uploaded v${release.versionName} (${release.versionCode}) cleanly.`,
      data: release,
      pushedCount,
    });
  });

  // Download APK file directly onto Android devices
  router.get('/download/:filename', (req, res) => {
    const safeFile = path.basename(req.params.filename);
    const fullPath = path.join(RELEASES_DIR, safeFile);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return res.status(404).json({ success: false, message: 'APK release file not found on server' });
    }

    const stat = fs.statSync(fullPath);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
    fs.createReadStream(fullPath).pipe(res);
  });

  // Push latest uploaded APK update to a specific device (or 'all' online devices)
  router.post('/push/:deviceId', (req, res) => {
    const latest = db.getLatestRelease();
    if (!latest) {
      return res.status(404).json({
        success: false,
        message: 'No APK release uploaded yet. Upload a new .apk first.',
      });
    }

    const force = Boolean(req.body?.force);
    const { deviceId } = req.params;

    const dispatchForDevice = (targetId: string) => {
      const cmd = db.addCommand({
        deviceId: targetId,
        commandType: 'UPDATE_AGENT',
        parameters: {
          versionCode: latest.versionCode,
          versionName: latest.versionName,
          downloadUrl: latest.downloadUrl,
          sha256: latest.sha256,
          releaseNotes: latest.releaseNotes,
          force,
        },
      });
      return gateway.sendCommand(targetId, cmd);
    };

    if (deviceId === 'all') {
      let sentCount = 0;
      for (const dev of db.getDevices()) {
        if (gateway.isDeviceOnline(dev.deviceId) && dispatchForDevice(dev.deviceId)) {
          sentCount++;
        }
      }
      return res.json({
        success: true,
        sentCount,
        message: `Update v${latest.versionName} pushed to ${sentCount} online device(s).`,
      });
    }

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const dispatched = dispatchForDevice(device.deviceId);
    res.json({
      success: true,
      dispatched,
      message: dispatched
        ? `Update v${latest.versionName} (${latest.versionCode}) pushed to ${device.deviceName}!`
        : `${device.deviceName} is offline — update v${latest.versionName} queued for reconnect.`,
    });
  });

  return router;
}
