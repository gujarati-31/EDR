import fs from 'fs';
import path from 'path';
import {
  Device,
  DevicePolicy,
  DevicePermissions,
  Command,
  LogEntry,
  AppUsage,
  InstalledApp,
  IntruderPhoto,
  RecordedVideo,
  AppRelease,
} from '../types/index.js';

interface DatabaseSchema {
  devices: Device[];
  policies: Record<string, DevicePolicy>; // keyed by deviceId
  commands: Command[];
  logs: LogEntry[];
  appUsage: AppUsage[];
  installedApps: InstalledApp[];
  photos: IntruderPhoto[];
  recordings: RecordedVideo[];
  latestRelease?: AppRelease;
  releases?: AppRelease[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'edr_database.json');

class Database {
  private data: DatabaseSchema = {
    devices: [],
    policies: {},
    commands: [],
    logs: [],
    appUsage: [],
    installedApps: [],
    photos: [],
    recordings: [],
    releases: [],
  };

  constructor() {
    this.init();
  }

  private init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        if (!this.data.photos) this.data.photos = [];
        if (!this.data.installedApps) this.data.installedApps = [];
        if (!this.data.recordings) this.data.recordings = [];
      } catch (err) {
        console.error('[DB] Failed to load database file, initializing empty schema:', err);
        this.save();
      }
    } else {
      this.save();
    }
  }

  private save() {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  }

  // Devices
  getDevices(): Device[] {
    return this.data.devices;
  }

  getDeviceById(id: string): Device | undefined {
    return this.data.devices.find((d) => d.id === id || d.deviceId === id);
  }

  upsertDevice(deviceData: Partial<Device> & { deviceId: string }): Device {
    let device = this.data.devices.find((d) => d.deviceId === deviceData.deviceId);
    const now = new Date().toISOString();

    if (device) {
      const preservedCustomName = device.isCustomName ? device.deviceName : undefined;
      Object.assign(device, deviceData, { lastHeartbeat: now });
      if (preservedCustomName) {
        device.deviceName = preservedCustomName;
        device.isCustomName = true;
      }
    } else {
      device = {
        id: crypto.randomUUID(),
        deviceName: deviceData.deviceName || 'Android Device',
        osVersion: deviceData.osVersion || 'Unknown Android',
        ipAddress: deviceData.ipAddress,
        status: 'ONLINE',
        batteryLevel: deviceData.batteryLevel ?? 100,
        isDeviceOwner: deviceData.isDeviceOwner ?? true,
        enrolledAt: now,
        lastHeartbeat: now,
        lastSyncedTimestamp: now,
        ...deviceData,
        deviceId: deviceData.deviceId,
      };
      this.data.devices.push(device);

      // Initialize default policy if not present
      if (!this.data.policies[device.deviceId]) {
        this.data.policies[device.deviceId] = {
          deviceId: device.deviceId,
          blockScreenCapture: false,
          disableCamera: false,
          disableUsbTransfer: false,
          blockUsbDebugging: false,
          blockUnknownSources: true,
          blockFactoryReset: true,
          isolateNetwork: false,
          nightlySyncEnabled: true,
          nightlySyncTime: '23:00',
          trapAppPackages: [],
          updatedAt: now,
        };
      }
    }

    this.save();
    return device;
  }

  renameDevice(id: string, deviceName: string): Device | undefined {
    const device = this.getDeviceById(id);
    if (!device) return undefined;
    device.deviceName = deviceName.trim();
    device.isCustomName = true;
    this.save();
    return device;
  }

  updateDeviceStatus(
    deviceId: string,
    status: 'ONLINE' | 'OFFLINE',
    batteryLevel?: number,
    networkQuality?: 'FAST' | 'MODERATE' | 'SLOW',
    downstreamKbps?: number,
    permissions?: DevicePermissions
  ) {
    const device = this.data.devices.find((d) => d.deviceId === deviceId || d.id === deviceId);
    if (device) {
      device.status = status;
      device.lastHeartbeat = new Date().toISOString();
      if (batteryLevel !== undefined) {
        device.batteryLevel = batteryLevel;
      }
      if (networkQuality !== undefined) {
        device.networkQuality = networkQuality;
      }
      if (downstreamKbps !== undefined) {
        device.downstreamKbps = downstreamKbps;
      }
      if (permissions !== undefined) {
        device.permissions = permissions;
      }
      this.save();
    }
  }

  updateLastSyncedTimestamp(deviceId: string, timestamp: string) {
    const device = this.data.devices.find((d) => d.deviceId === deviceId || d.id === deviceId);
    if (device) {
      device.lastSyncedTimestamp = timestamp;
      this.save();
    }
  }

  deleteDevice(id: string): boolean {
    const initialLen = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.id !== id && d.deviceId !== id);
    delete this.data.policies[id];
    this.data.commands = this.data.commands.filter((c) => c.deviceId !== id);
    this.data.logs = this.data.logs.filter((l) => l.deviceId !== id);
    this.data.appUsage = this.data.appUsage.filter((u) => u.deviceId !== id);
    this.data.installedApps = this.data.installedApps.filter((a) => a.deviceId !== id);
    this.save();
    return this.data.devices.length < initialLen;
  }

  // Policies
  getPolicy(deviceId: string): DevicePolicy {
    if (!this.data.policies[deviceId]) {
      this.data.policies[deviceId] = {
        deviceId,
        blockScreenCapture: false,
        disableCamera: false,
        disableUsbTransfer: false,
        blockUsbDebugging: false,
        blockUnknownSources: true,
        blockFactoryReset: true,
        isolateNetwork: false,
        nightlySyncEnabled: true,
        nightlySyncTime: '23:00',
        trapAppPackages: [],
        updatedAt: new Date().toISOString(),
      };
      this.save();
    }
    return this.data.policies[deviceId];
  }

  updatePolicy(deviceId: string, updates: Partial<DevicePolicy>): DevicePolicy {
    const current = this.getPolicy(deviceId);
    this.data.policies[deviceId] = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.data.policies[deviceId];
  }

  // Commands
  addCommand(command: Omit<Command, 'id' | 'createdAt' | 'status'>): Command {
    const newCmd: Command = {
      id: crypto.randomUUID(),
      ...command,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    this.data.commands.push(newCmd);
    this.save();
    return newCmd;
  }

  getCommands(deviceId: string): Command[] {
    return this.data.commands
      .filter((c) => c.deviceId === deviceId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  updateCommandStatus(commandId: string, status: Command['status'], resultMessage?: string) {
    const cmd = this.data.commands.find((c) => c.id === commandId);
    if (cmd) {
      cmd.status = status;
      if (resultMessage !== undefined) cmd.resultMessage = resultMessage;
      if (status === 'EXECUTED' || status === 'FAILED') {
        cmd.executedAt = new Date().toISOString();
      }
      this.save();
    }
  }

  // Logs
  addLogs(logs: Omit<LogEntry, 'id' | 'createdAt'>[]): LogEntry[] {
    const now = new Date().toISOString();
    const createdLogs: LogEntry[] = logs.map((log) => ({
      id: crypto.randomUUID(),
      ...log,
      createdAt: now,
    }));
    this.data.logs.push(...createdLogs);
    this.save();
    return createdLogs;
  }

  getLogs(deviceId?: string, severity?: string, limit = 500): LogEntry[] {
    let result = this.data.logs;
    if (deviceId) {
      result = result.filter((l) => l.deviceId === deviceId);
    }
    if (severity) {
      result = result.filter((l) => l.severity === severity);
    }
    return result
      .sort((a, b) => new Date(b.eventTimestamp).getTime() - new Date(a.eventTimestamp).getTime())
      .slice(0, limit);
  }

  // App Usage / Screen Time
  recordAppUsage(records: Omit<AppUsage, 'id'>[]): AppUsage[] {
    const created: AppUsage[] = [];
    for (const rec of records) {
      // Find existing entry for the same device, package and date
      const existing = this.data.appUsage.find(
        (u) =>
          u.deviceId === rec.deviceId &&
          u.packageName === rec.packageName &&
          u.usageDate === rec.usageDate
      );
      if (existing) {
        existing.foregroundSeconds = rec.foregroundSeconds;
        existing.launchCount = rec.launchCount;
        existing.appName = rec.appName;
        created.push(existing);
      } else {
        const newUsage: AppUsage = {
          id: crypto.randomUUID(),
          ...rec,
        };
        this.data.appUsage.push(newUsage);
        created.push(newUsage);
      }
    }
    this.save();
    return created;
  }

  getAppUsage(deviceId: string, date?: string): AppUsage[] {
    return this.data.appUsage
      .filter((u) => u.deviceId === deviceId && (!date || u.usageDate === date))
      .sort((a, b) => b.foregroundSeconds - a.foregroundSeconds);
  }

  // Installed Apps
  syncInstalledApps(deviceId: string, apps: Omit<InstalledApp, 'id' | 'deviceId'>[]) {
    const dev = this.getDeviceById(deviceId);
    const targetId = dev ? dev.deviceId : deviceId;
    // Clear old apps for this device (both by targetId and dev.id if applicable)
    this.data.installedApps = this.data.installedApps.filter(
      (a) => a.deviceId !== targetId && (!dev || a.deviceId !== dev.id)
    );
    const newApps: InstalledApp[] = apps.map((a) => ({
      id: crypto.randomUUID(),
      deviceId: targetId,
      ...a,
    }));
    this.data.installedApps.push(...newApps);
    this.save();
    return newApps;
  }

  getInstalledApps(deviceId: string): InstalledApp[] {
    const dev = this.getDeviceById(deviceId);
    const targetId = dev ? dev.deviceId : deviceId;
    return this.data.installedApps.filter(
      (a) => a.deviceId === targetId || (dev && a.deviceId === dev.id)
    );
  }

  // Intruder Evidence Photos
  addIntruderPhoto(photo: Omit<IntruderPhoto, 'id' | 'createdAt'>): IntruderPhoto {
    const newPhoto: IntruderPhoto = {
      id: crypto.randomUUID(),
      ...photo,
      createdAt: new Date().toISOString(),
    };
    if (!this.data.photos) this.data.photos = [];
    this.data.photos.unshift(newPhoto);
    this.save();
    return newPhoto;
  }

  getIntruderPhotos(deviceId?: string): IntruderPhoto[] {
    if (!this.data.photos) return [];
    if (!deviceId || deviceId === 'ALL') return this.data.photos;
    return this.data.photos.filter((p) => p.deviceId === deviceId);
  }

  deleteIntruderPhoto(id: string): boolean {
    if (!this.data.photos) return false;
    const initialLen = this.data.photos.length;
    this.data.photos = this.data.photos.filter((p) => p.id !== id);
    if (this.data.photos.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Recorded Live Video Sessions
  addRecording(rec: Omit<RecordedVideo, 'id' | 'createdAt'>): RecordedVideo {
    const id = crypto.randomUUID();
    const newRec: RecordedVideo = {
      id,
      ...rec,
      url: `/api/devices/${rec.deviceId}/recordings/${id}/stream`,
      createdAt: new Date().toISOString(),
    };
    if (!this.data.recordings) this.data.recordings = [];
    this.data.recordings.unshift(newRec);
    this.save();
    return newRec;
  }

  getRecordings(deviceId?: string): RecordedVideo[] {
    if (!this.data.recordings) return [];
    if (!deviceId || deviceId === 'ALL') return this.data.recordings;
    return this.data.recordings.filter((r) => r.deviceId === deviceId);
  }

  getRawData(): DatabaseSchema {
    return this.data;
  }

  deleteRecording(id: string): boolean {
    if (!this.data.recordings) return false;
    const initialLen = this.data.recordings.length;
    this.data.recordings = this.data.recordings.filter((r) => r.id !== id);
    if (this.data.recordings.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // OTA Agent Releases
  saveRelease(release: Omit<AppRelease, 'id' | 'uploadedAt'>): AppRelease {
    const record: AppRelease = {
      id: crypto.randomUUID(),
      ...release,
      uploadedAt: new Date().toISOString(),
    };
    if (!this.data.releases) this.data.releases = [];
    this.data.releases.unshift(record);
    this.data.releases = this.data.releases.slice(0, 15);
    this.data.latestRelease = record;
    this.save();
    return record;
  }

  getLatestRelease(): AppRelease | null {
    return this.data.latestRelease || null;
  }

  getReleases(): AppRelease[] {
    return this.data.releases || [];
  }
}

export const db = new Database();
