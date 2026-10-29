import { WebSocket, WebSocketServer } from 'ws';
import { Server as HttpServer } from 'http';
import { db } from '../db/index.js';
import { Command, DevicePolicy, WsMessage } from '../types/index.js';

export interface MediaStreamHandler {
  onFirstChunk?: (mimeType: string, fileName: string, totalBytes: number) => void;
  onChunk: (chunkBuffer: Buffer, chunkIndex: number, totalChunks: number) => void;
  onEnd: () => void;
  onError: (errMessage: string) => void;
  timer: NodeJS.Timeout;
}

export class EDRWebSocketGateway {
  private wss: WebSocketServer;
  private deviceSockets = new Map<string, WebSocket>();
  private dashboardSockets = new Set<WebSocket>();
  private pendingListRequests = new Map<
    string,
    { resolve: (data: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
  >();
  private activeMediaStreams = new Map<string, MediaStreamHandler>();

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.init();
    this.startHeartbeatCheck();
  }

  private init() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const clientType = url.searchParams.get('type') || 'device'; // 'device' | 'dashboard'
      const deviceIdParam = url.searchParams.get('deviceId');

      if (clientType === 'dashboard') {
        this.dashboardSockets.add(ws);
        console.log(`[WS] Dashboard client connected. Total dashboards: ${this.dashboardSockets.size}`);

        // Send initial connection ACK
        ws.send(JSON.stringify({
          type: 'CONNECTED',
          payload: { role: 'dashboard', timestamp: new Date().toISOString() },
        }));

        ws.on('close', () => {
          this.dashboardSockets.delete(ws);
          console.log(`[WS] Dashboard client disconnected. Total: ${this.dashboardSockets.size}`);
        });
        return;
      }

      // If phone client connects
      let currentDeviceId = deviceIdParam || '';
      if (currentDeviceId) {
        this.deviceSockets.set(currentDeviceId, ws);
        db.updateDeviceStatus(currentDeviceId, 'ONLINE');
        this.broadcastToDashboards('DEVICE_STATUS_CHANGED', { deviceId: currentDeviceId, status: 'ONLINE' });
        console.log(`[WS] Android device connected: ${currentDeviceId}`);
      }

      ws.on('message', (data: string) => {
        try {
          const message: WsMessage = JSON.parse(data.toString());
          this.handleDeviceMessage(ws, message, (id) => {
            currentDeviceId = id;
            this.deviceSockets.set(id, ws);
          });
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      });

      ws.on('close', () => {
        if (currentDeviceId) {
          this.deviceSockets.delete(currentDeviceId);
          db.updateDeviceStatus(currentDeviceId, 'OFFLINE');
          this.broadcastToDashboards('DEVICE_STATUS_CHANGED', { deviceId: currentDeviceId, status: 'OFFLINE' });
          console.log(`[WS] Android device disconnected: ${currentDeviceId}`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[WS] Socket error on device ${currentDeviceId}:`, err);
      });
    });
  }

  private handleDeviceMessage(
    ws: WebSocket,
    msg: WsMessage,
    setDeviceId: (id: string) => void
  ) {
    const { type, deviceId, payload } = msg;

    switch (type) {
      case 'AGENT_REGISTER': {
        const id = deviceId || payload.deviceId;
        setDeviceId(id);
        const device = db.upsertDevice({
          deviceId: id,
          deviceName: payload.deviceName,
          osVersion: payload.osVersion,
          batteryLevel: payload.batteryLevel,
          isDeviceOwner: payload.isDeviceOwner ?? true,
          status: 'ONLINE',
        });

        // Send back registration confirmation + current policies
        const policy = db.getPolicy(id);
        ws.send(JSON.stringify({
          type: 'REGISTRATION_ACK',
          payload: { device, policy },
          timestamp: new Date().toISOString(),
        }));

        this.broadcastToDashboards('DEVICE_REGISTERED', device);
        break;
      }

      case 'HEARTBEAT': {
        const id = deviceId || payload.deviceId;
        if (id) {
          db.updateDeviceStatus(id, 'ONLINE', payload.batteryLevel);
          this.broadcastToDashboards('DEVICE_HEARTBEAT', {
            deviceId: id,
            batteryLevel: payload.batteryLevel,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'COMMAND_ACK': {
        const { commandId, status, resultMessage } = payload;
        db.updateCommandStatus(commandId, status, resultMessage);
        this.broadcastToDashboards('COMMAND_UPDATED', { commandId, status, resultMessage });
        break;
      }

      case 'POLICY_ACK': {
        const id = deviceId || payload.deviceId;
        this.broadcastToDashboards('POLICY_ACK', { deviceId: id, status: payload.status });
        break;
      }

      case 'SECURITY_ALERT': {
        const id = deviceId || payload.deviceId;
        const log = db.addLogs([
          {
            deviceId: id,
            eventType: 'SECURITY_ALERT',
            severity: payload.severity || 'CRITICAL',
            message: payload.message,
            payload: payload.details,
            eventTimestamp: payload.timestamp || new Date().toISOString(),
          },
        ])[0];

        this.broadcastToDashboards('SECURITY_ALERT', log);
        break;
      }

      case 'SCREEN_FRAME': {
        const id = deviceId || payload.deviceId;
        this.broadcastToDashboards('SCREEN_FRAME', {
          deviceId: id,
          ...payload,
        });
        break;
      }

      case 'SCREEN_STREAM_STATUS': {
        const id = deviceId || payload.deviceId;
        this.broadcastToDashboards('SCREEN_STREAM_STATUS', {
          deviceId: id,
          ...payload,
        });
        break;
      }

      case 'AUDIO_CHUNK': {
        const id = deviceId || payload.deviceId;
        this.broadcastToDashboards('AUDIO_CHUNK', {
          deviceId: id,
          ...payload,
        });
        break;
      }

      case 'AUDIO_STREAM_STATUS': {
        const id = deviceId || payload.deviceId;
        this.broadcastToDashboards('AUDIO_STREAM_STATUS', {
          deviceId: id,
          ...payload,
        });
        break;
      }

      case 'DEVICE_MEDIA_LIST_RESULT': {
        const reqId = payload?.requestId;
        const pending = this.pendingListRequests.get(reqId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingListRequests.delete(reqId);
          if (payload.error) {
            pending.reject(new Error(payload.error));
          } else {
            pending.resolve(payload.result);
          }
        }
        break;
      }

      case 'DEVICE_MEDIA_CHUNK': {
        const reqId = payload?.requestId;
        const handler = this.activeMediaStreams.get(reqId);
        if (handler) {
          // Reset inactivity timer
          clearTimeout(handler.timer);
          handler.timer = setTimeout(() => {
            this.activeMediaStreams.delete(reqId);
            handler.onError('Media streaming timed out after 30s');
          }, 30000);

          if (payload.chunkIndex === 0 && handler.onFirstChunk) {
            handler.onFirstChunk(payload.mimeType, payload.fileName, payload.totalBytes);
          }

          if (payload.dataBase64) {
            try {
              const buf = Buffer.from(payload.dataBase64, 'base64');
              handler.onChunk(buf, payload.chunkIndex, payload.totalChunks);
            } catch (err: any) {
              console.error('[WS] Error decoding media chunk base64:', err);
            }
          }

          if (payload.isLast) {
            clearTimeout(handler.timer);
            this.activeMediaStreams.delete(reqId);
            handler.onEnd();
          }
        }
        break;
      }

      case 'MEDIA_FILE_ERROR': {
        const reqId = payload?.requestId;
        const handler = this.activeMediaStreams.get(reqId);
        if (handler) {
          clearTimeout(handler.timer);
          this.activeMediaStreams.delete(reqId);
          handler.onError(payload.error || 'Failed to stream media from device');
        }
        break;
      }

      default:
        console.log(`[WS] Unhandled message type from device ${deviceId}: ${type}`);
    }
  }

  public sendCommand(deviceId: string, command: Command): boolean {
    const ws = this.deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WS] Device ${deviceId} not connected to WebSocket. Command queued.`);
      return false;
    }

    ws.send(JSON.stringify({
      type: 'EXECUTE_COMMAND',
      payload: command,
      timestamp: new Date().toISOString(),
    }));

    db.updateCommandStatus(command.id, 'SENT');
    this.broadcastToDashboards('COMMAND_UPDATED', { commandId: command.id, status: 'SENT' });
    return true;
  }

  public sendPolicy(deviceId: string, policy: DevicePolicy): boolean {
    const ws = this.deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WS] Device ${deviceId} offline. Policy saved in DB for next connection.`);
      return false;
    }

    ws.send(JSON.stringify({
      type: 'APPLY_POLICY',
      payload: policy,
      timestamp: new Date().toISOString(),
    }));

    return true;
  }

  public broadcastToDashboards(event: string, data: any) {
    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const client of this.dashboardSockets) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public isDeviceOnline(deviceId: string): boolean {
    const ws = this.deviceSockets.get(deviceId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  public disconnectDevice(deviceId: string): boolean {
    const ws = this.deviceSockets.get(deviceId);
    if (ws) {
      try {
        ws.close(1000, 'Disconnected by Dashboard Admin');
      } catch (err) {}
      this.deviceSockets.delete(deviceId);
      db.updateDeviceStatus(deviceId, 'OFFLINE');
      this.broadcastToDashboards('DEVICE_STATUS_CHANGED', { deviceId, status: 'OFFLINE' });
      return true;
    }
    db.updateDeviceStatus(deviceId, 'OFFLINE');
    this.broadcastToDashboards('DEVICE_STATUS_CHANGED', { deviceId, status: 'OFFLINE' });
    return false;
  }

  public async requestDeviceMediaList(
    deviceId: string,
    params: {
      typeFilter?: string;
      bucketFilter?: string;
      searchQuery?: string;
      offset?: number;
      limit?: number;
      includeThumbnails?: boolean;
    }
  ): Promise<any> {
    const ws = this.deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Device is offline or not connected via WebSocket');
    }

    const requestId = `med_list_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingListRequests.delete(requestId);
        reject(new Error('Timed out waiting for device media list response (15s)'));
      }, 15000);

      this.pendingListRequests.set(requestId, { resolve, reject, timer });

      ws.send(
        JSON.stringify({
          type: 'FETCH_DEVICE_MEDIA_LIST',
          deviceId,
          payload: {
            requestId,
            ...params,
          },
          timestamp: new Date().toISOString(),
        })
      );
    });
  }

  public registerMediaStreamHandler(requestId: string, handler: MediaStreamHandler) {
    this.activeMediaStreams.set(requestId, handler);
  }

  public unregisterMediaStreamHandler(requestId: string) {
    const handler = this.activeMediaStreams.get(requestId);
    if (handler) {
      clearTimeout(handler.timer);
      this.activeMediaStreams.delete(requestId);
    }
  }

  public requestDeviceMediaFile(
    deviceId: string,
    requestId: string,
    mediaId: string,
    mediaType: string
  ): boolean {
    const ws = this.deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(
      JSON.stringify({
        type: 'FETCH_DEVICE_MEDIA_FILE',
        deviceId,
        payload: {
          requestId,
          mediaId,
          mediaType,
        },
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  // Periodic heartbeat checker to flag devices offline if no heartbeat for 150s
  // (Device heartbeat is 60s, so 150s = 2.5 missed beats before marking offline)
  private startHeartbeatCheck() {
    setInterval(() => {
      const now = Date.now();
      const devices = db.getDevices();
      for (const d of devices) {
        const lastBeat = new Date(d.lastHeartbeat).getTime();
        if (now - lastBeat > 150000 && d.status === 'ONLINE') {
          db.updateDeviceStatus(d.deviceId, 'OFFLINE');
          this.broadcastToDashboards('DEVICE_STATUS_CHANGED', { deviceId: d.deviceId, status: 'OFFLINE' });
        }
      }
    }, 60000);
  }
}

