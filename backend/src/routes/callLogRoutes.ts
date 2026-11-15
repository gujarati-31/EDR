import { Router } from 'express';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';

export function createCallLogRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // Upload Call Logs from Android Agent
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

    res.json({
      success: true,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      filters: { type: type || 'ALL', date: date || 'ALL', search: search || '' },
      stats,
      data: logs,
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
