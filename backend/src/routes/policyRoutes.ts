import { Router } from 'express';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';

export function createPolicyRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // Get device policy
  router.get('/:deviceId', (req, res) => {
    const policy = db.getPolicy(req.params.deviceId);
    res.json({ success: true, data: policy });
  });

  // Update device policy toggles
  router.put('/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const updated = db.updatePolicy(device.deviceId, req.body);
    
    // Instantly push to device over WebSocket if connected
    const sent = gateway.sendPolicy(device.deviceId, updated);

    // Notify dashboards
    gateway.broadcastToDashboards('POLICY_UPDATED', {
      deviceId: device.deviceId,
      policy: updated,
      dispatchedImmediately: sent,
    });

    res.json({
      success: true,
      message: sent
        ? 'Policy updated and dispatched to device immediately'
        : 'Policy updated in server (device offline, will apply on next connect)',
      data: updated,
    });
  });

  return router;
}

