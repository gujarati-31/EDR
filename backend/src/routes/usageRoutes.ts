import { Router } from 'express';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';

export function createUsageRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // Upload App Usage & Screen Time metrics from Android Agent
  router.post('/upload', (req, res) => {
    const { deviceId, usage } = req.body;
    if (!deviceId || !Array.isArray(usage)) {
      return res.status(400).json({ success: false, message: 'deviceId and usage array required' });
    }

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const recorded = db.recordAppUsage(
      usage.map((u: any) => ({
        deviceId: device.deviceId,
        packageName: u.packageName,
        appName: u.appName || u.packageName,
        foregroundSeconds: u.foregroundSeconds || 0,
        launchCount: u.launchCount || 0,
        usageDate: u.usageDate || new Date().toISOString().split('T')[0],
      }))
    );

    gateway.broadcastToDashboards('USAGE_UPDATED', { deviceId: device.deviceId, count: recorded.length });

    res.json({ success: true, count: recorded.length, data: recorded });
  });

  // Get App Usage / Screen Time for a device (Day-wise)
  router.get('/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const { date } = req.query as { date?: string };

    // Get all available dates for this device
    const allRecords = db.getAppUsage(deviceId);
    const availableDates = Array.from(new Set(allRecords.map((r) => r.usageDate))).sort().reverse();

    // Default to the requested date, or today, or the latest available date
    const todayStr = new Date().toISOString().split('T')[0];
    const selectedDate = date || (availableDates.length > 0 ? (availableDates.includes(todayStr) ? todayStr : availableDates[0]) : todayStr);

    const usage = db.getAppUsage(deviceId, selectedDate);

    // Calculate total screen time in hours and minutes for this selected day
    const totalSeconds = usage.reduce((sum, item) => sum + item.foregroundSeconds, 0);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    res.json({
      success: true,
      deviceId,
      selectedDate,
      availableDates,
      totalScreenTimeSeconds: totalSeconds,
      formattedScreenTime: `${hours}h ${minutes}m`,
      data: usage,
    });
  });

  // Sync installed apps from agent
  router.post('/apps/sync', (req, res) => {
    const { deviceId, apps } = req.body;
    if (!deviceId || !Array.isArray(apps)) {
      return res.status(400).json({ success: false, message: 'deviceId and apps array required' });
    }

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const synced = db.syncInstalledApps(device.deviceId, apps);
    gateway.broadcastToDashboards('APPS_SYNCED', { deviceId: device.deviceId, count: synced.length });

    res.json({ success: true, count: synced.length, message: 'Installed apps synchronized' });
  });

  // Get installed apps for device
  router.get('/apps/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const apps = db.getInstalledApps(deviceId);
    res.json({ success: true, count: apps.length, data: apps });
  });

  return router;
}

