import { Router } from 'express';
import { db } from '../db/index.js';
import { EDRWebSocketGateway } from '../gateway/wsServer.js';
import { CommandType } from '../types/index.js';

export function createCommandRouter(gateway: EDRWebSocketGateway) {
  const router = Router();

  // Get command history for a device
  router.get('/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const device = db.getDeviceById(deviceId);
    const targetId = device ? device.deviceId : deviceId;
    const commands = db.getCommands(targetId);
    res.json({ success: true, count: commands.length, data: commands });
  });

  // Dispatch an active response command
  router.post('/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const { commandType, parameters } = req.body as {
      commandType: CommandType;
      parameters?: Record<string, any>;
    };

    if (!commandType) {
      return res.status(400).json({ success: false, message: 'commandType is required' });
    }

    const device = db.getDeviceById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Create command record
    const command = db.addCommand({
      deviceId: device.deviceId,
      commandType,
      parameters,
    });

    // Try sending immediately via WebSocket
    const dispatched = gateway.sendCommand(device.deviceId, command);

    res.json({
      success: true,
      message: dispatched
        ? `Command ${commandType} dispatched to device`
        : `Device is offline. Command ${commandType} queued for execution on reconnect.`,
      data: command,
    });
  });

  return router;
}

