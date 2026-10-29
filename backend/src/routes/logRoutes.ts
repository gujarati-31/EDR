import { Router } from 'express';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';

export function createLogRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // Query logs with filters
  router.get('/', (req, res) => {
    const { deviceId, severity, limit } = req.query as {
      deviceId?: string;
      severity?: string;
      limit?: string;
    };

    const maxLimit = limit ? parseInt(limit, 10) : 500;
    const logs = db.getLogs(deviceId, severity, maxLimit);
    res.json({ success: true, count: logs.length, data: logs });
  });

  // Upload delta logs batch from phone (11:00 PM or "Get Logs" response)
  router.post('/upload', (req, res) => {
    const { deviceId, syncFrom, syncTo, logs } = req.body;

    if (!deviceId || !Array.isArray(logs)) {
      return res.status(400).json({
        success: false,
        message: 'deviceId and logs array are required',
      });
    }

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Insert log batch
    const inserted = db.addLogs(
      logs.map((l: any) => ({
        deviceId: device.deviceId,
        eventType: l.eventType || 'SYS_LOG',
        severity: l.severity || 'INFO',
        message: l.message || '',
        payload: l.payload || {},
        eventTimestamp: l.eventTimestamp || new Date().toISOString(),
      }))
    );

    // Update the device delta timestamp anchor!
    const effectiveSyncTo = syncTo || new Date().toISOString();
    db.updateLastSyncedTimestamp(device.deviceId, effectiveSyncTo);

    // Broadcast update to all dashboard viewers
    gateway.broadcastToDashboards('LOGS_RECEIVED', {
      deviceId: device.deviceId,
      count: inserted.length,
      syncFrom,
      syncTo: effectiveSyncTo,
    });

    console.log(
      `[LOGS] Received ${inserted.length} delta logs from device ${device.deviceId} (Range: ${syncFrom} -> ${effectiveSyncTo})`
    );

    res.json({
      success: true,
      message: `Successfully processed ${inserted.length} delta logs`,
      processedCount: inserted.length,
      lastSyncedTimestamp: effectiveSyncTo,
    });
  });

  // Summary statistics for dashboard widgets
  router.get('/stats', (req, res) => {
    const { deviceId } = req.query as { deviceId?: string };
    const logs = db.getLogs(deviceId, undefined, 2000);

    const stats = {
      total: logs.length,
      critical: logs.filter((l) => l.severity === 'CRITICAL').length,
      warning: logs.filter((l) => l.severity === 'WARNING').length,
      info: logs.filter((l) => l.severity === 'INFO').length,
    };

    res.json({ success: true, data: stats });
  });

  // SIEM / Wazuh Export Endpoint (Elastic Common Schema - ECS format)
  router.get('/wazuh', (req, res) => {
    const { deviceId, limit } = req.query as { deviceId?: string; limit?: string };
    const maxLimit = limit ? parseInt(limit, 10) : 1000;
    const logs = db.getLogs(deviceId, undefined, maxLimit);

    const wazuhEvents = logs.map((log) => {
      const payload = log.payload || {};
      return {
        '@timestamp': log.eventTimestamp || log.createdAt,
        agent: {
          id: log.deviceId,
          type: 'android_edr',
        },
        event: {
          id: payload.eventId || 'ANDROID_GENERIC',
          category: payload.eventCategory || log.eventType,
          provider: payload.provider || 'AndroidEDR',
          severity: log.severity,
        },
        message: log.message,
        android: payload,
      };
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="wazuh_edr_audit.json"');
    res.json(wazuhEvents);
  });

  return router;
}

