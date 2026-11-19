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
  CallLogEntry,
  CallLogStats,
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
  callLogs?: CallLogEntry[];
  latestRelease?: AppRelease;
  releases?: AppRelease[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'edr_database.json');

function formatDurationHelper(sec: number, type?: string): string {
  if (sec <= 0) {
    if (type === 'MISSED') return '0s (Missed)';
    if (type === 'REJECTED') return '0s (Rejected)';
    if (type === 'BLOCKED') return '0s (Blocked)';
    return '0s';
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDurationDisplay(totalSec: number): string {
  if (totalSec <= 0) return '0s';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

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
    callLogs: [],
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
        if (!this.data.callLogs) this.data.callLogs = [];
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
      Object.assign(device, deviceData, { lastHeartbeat: now, isUninstalled: false });
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
    permissions?: DevicePermissions,
    networkType?: string,
    networkLabel?: string,
    isCloudUploadAllowed?: boolean,
    isPaused?: boolean,
    edrStatus?: 'Active' | 'Paused'
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
      if (networkType !== undefined) {
        device.networkType = networkType;
      }
      if (networkLabel !== undefined) {
        device.networkLabel = networkLabel;
      }
      if (isCloudUploadAllowed !== undefined) {
        device.isCloudUploadAllowed = isCloudUploadAllowed;
      }
      if (isPaused !== undefined) {
        device.isPaused = isPaused;
      }
      if (edrStatus !== undefined) {
        device.edrStatus = edrStatus;
      } else if (device.isPaused !== undefined) {
        device.edrStatus = device.isPaused ? 'Paused' : 'Active';
      }
      this.save();
    }
  }

  setDevicePaused(deviceId: string, isPaused: boolean): Device | undefined {
    const device = this.data.devices.find((d) => d.deviceId === deviceId || d.id === deviceId);
    if (device) {
      device.isPaused = isPaused;
      device.edrStatus = isPaused ? 'Paused' : 'Active';
      if (isPaused) {
        device.pausedAt = new Date().toISOString();
      } else {
        delete device.pausedAt;
      }
      this.save();
    }
    return device;
  }

  updateLastSyncedTimestamp(deviceId: string, timestamp: string) {
    const device = this.data.devices.find((d) => d.deviceId === deviceId || d.id === deviceId);
    if (device) {
      device.lastSyncedTimestamp = timestamp;
      this.save();
    }
  }

  markDeviceUninstalled(deviceId: string, reason?: string): Device | undefined {
    const device = this.data.devices.find((d) => d.deviceId === deviceId || d.id === deviceId);
    if (device) {
      device.isUninstalled = true;
      device.uninstalledAt = new Date().toISOString();
      device.status = 'OFFLINE';
      if (reason) {
        device.tamperReason = reason;
      }
      this.save();
      return device;
    }
    return undefined;
  }

  deleteDevice(id: string): boolean {
    const device = this.data.devices.find((d) => d.id === id || d.deviceId === id);
    if (!device) return false;
    device.isUninstalled = true;
    device.uninstalledAt = new Date().toISOString();
    device.status = 'OFFLINE';
    device.tamperReason = 'Device deregistered / uninstalled from console';
    this.save();
    return true;
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
      ...rec,
      id,
      url: `/api/devices/${rec.deviceId}/recordings/${id}/stream`,
      audioUrl: rec.audioFilename ? `/api/devices/${rec.deviceId}/recordings/${id}/audio` : rec.audioUrl,
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

  updateRecordingDuration(id: string, duration: string): boolean {
    if (!this.data.recordings) return false;
    const rec = this.data.recordings.find((r) => r.id === id);
    if (rec && rec.duration !== duration) {
      rec.duration = duration;
      this.save();
      return true;
    }
    return false;
  }

  // Phone History & Call Logs
  recordCallLogs(
    deviceId: string,
    logs: Array<{
      callId?: string;
      phoneNumber: string;
      callerName?: string;
      callType: any;
      timestamp: number;
      callDate?: string;
      durationSeconds: number;
      formattedDuration?: string;
      simSlot?: string;
      recordingStatus?: string;
      recordingReason?: string;
      recordingFilename?: string;
      recordingUrl?: string;
      recordingSizeBytes?: number;
      hasRecording?: boolean;
    }>
  ): CallLogEntry[] {
    if (!this.data.callLogs) this.data.callLogs = [];
    const created: CallLogEntry[] = [];
    const now = new Date().toISOString();

    for (const item of logs) {
      const callDate = item.callDate || (item.timestamp ? new Date(item.timestamp).toISOString().split('T')[0] : now.split('T')[0]);
      const formattedDuration = item.formattedDuration || formatDurationHelper(item.durationSeconds, item.callType);

      // Check duplicate by callId or (deviceId + phoneNumber + timestamp)
      const existing = this.data.callLogs.find(
        (c) =>
          c.deviceId === deviceId &&
          ((item.callId && c.callId === item.callId) ||
            (c.phoneNumber === item.phoneNumber && Math.abs(c.timestamp - item.timestamp) < 2000))
      );

      if (existing) {
        // Update callerName if now resolved
        if (!existing.callerName && item.callerName) {
          existing.callerName = item.callerName;
        }
        if (item.recordingFilename && !existing.recordingFilename) {
          existing.recordingFilename = item.recordingFilename;
          existing.hasRecording = true;
          existing.recordingStatus = 'RECORDED';
          existing.recordingReason = undefined;
          if (item.recordingSizeBytes) existing.recordingSizeBytes = item.recordingSizeBytes;
        }
        if (item.recordingStatus && !existing.recordingStatus) {
          existing.recordingStatus = item.recordingStatus;
          existing.recordingReason = item.recordingReason;
        }
        continue;
      }

      const newEntry: CallLogEntry = {
        id: crypto.randomUUID(),
        deviceId,
        callId: item.callId || `call_${item.timestamp}_${Math.random().toString(36).substring(2, 7)}`,
        phoneNumber: item.phoneNumber || 'Unknown',
        callerName: item.callerName,
        callType: item.callType || 'UNKNOWN',
        timestamp: item.timestamp || Date.now(),
        callDate,
        durationSeconds: item.durationSeconds || 0,
        formattedDuration,
        simSlot: item.simSlot,
        createdAt: now,
        recordingStatus: item.recordingStatus || (item.hasRecording || item.recordingFilename ? 'RECORDED' : 'NOT_RECORDED'),
        recordingReason: item.recordingReason,
        recordingFilename: item.recordingFilename,
        recordingSizeBytes: item.recordingSizeBytes,
        hasRecording: !!item.hasRecording || !!item.recordingFilename,
      };

      this.data.callLogs.push(newEntry);
      created.push(newEntry);
    }

    if (created.length > 0) {
      // Sort newest call first
      this.data.callLogs.sort((a, b) => b.timestamp - a.timestamp);
      this.save();
    }
    return created;
  }

  attachCallRecording(
    deviceId: string,
    callId: string,
    phoneNumber: string,
    timestamp: number,
    filename: string,
    sizeBytes: number
  ): CallLogEntry | null {
    if (!this.data.callLogs) this.data.callLogs = [];
    const match = this.data.callLogs.find(
      (c) =>
        c.deviceId === deviceId &&
        ((callId && c.callId === callId) ||
          (c.phoneNumber === phoneNumber && Math.abs(c.timestamp - timestamp) < 180000))
    );

    if (match) {
      match.recordingFilename = filename;
      match.recordingSizeBytes = sizeBytes;
      match.hasRecording = true;
      match.recordingStatus = 'RECORDED';
      match.recordingReason = undefined;
      this.save();
      return match;
    }

    // If call log wasn't harvested yet, create a placeholder entry
    const now = new Date().toISOString();
    const newEntry: CallLogEntry = {
      id: crypto.randomUUID(),
      deviceId,
      callId: callId || `call_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
      phoneNumber: phoneNumber || 'Unknown',
      callType: 'UNKNOWN',
      timestamp: timestamp || Date.now(),
      callDate: new Date(timestamp || Date.now()).toISOString().split('T')[0],
      durationSeconds: 0,
      formattedDuration: 'Recorded Audio',
      createdAt: now,
      recordingStatus: 'RECORDED',
      recordingFilename: filename,
      recordingSizeBytes: sizeBytes,
      hasRecording: true,
    };
    this.data.callLogs.unshift(newEntry);
    this.save();
    return newEntry;
  }

  getCallLogs(
    deviceId?: string,
    filters?: { type?: string; date?: string; search?: string }
  ): { logs: CallLogEntry[]; stats: CallLogStats } {
    let all = this.data.callLogs || [];
    if (deviceId) {
      all = all.filter((c) => c.deviceId === deviceId);
    }

    // Available unique dates
    const availableDates = Array.from(new Set(all.map((c) => c.callDate))).sort().reverse();

    // Calculate overall stats before filtering
    let totalDurationSeconds = 0;
    let inboundDurationSeconds = 0;
    let outboundDurationSeconds = 0;
    let incomingCount = 0;
    let outgoingCount = 0;
    let missedCount = 0;
    let rejectedCount = 0;

    for (const c of all) {
      totalDurationSeconds += c.durationSeconds || 0;
      if (c.callType === 'INCOMING') {
        incomingCount++;
        inboundDurationSeconds += c.durationSeconds || 0;
      } else if (c.callType === 'OUTGOING') {
        outgoingCount++;
        outboundDurationSeconds += c.durationSeconds || 0;
      } else if (c.callType === 'MISSED') {
        missedCount++;
      } else if (c.callType === 'REJECTED' || c.callType === 'BLOCKED') {
        rejectedCount++;
      }
    }

    const totalCalls = all.length;
    const avgDurationSeconds = totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0;

    const stats: CallLogStats = {
      totalCalls,
      incomingCount,
      outgoingCount,
      missedCount,
      rejectedCount,
      totalDurationSeconds,
      formattedTotalDuration: formatDurationDisplay(totalDurationSeconds),
      inboundDurationSeconds,
      formattedInboundDuration: formatDurationDisplay(inboundDurationSeconds),
      outboundDurationSeconds,
      formattedOutboundDuration: formatDurationDisplay(outboundDurationSeconds),
      avgDurationSeconds,
      formattedAvgDuration: formatDurationDisplay(avgDurationSeconds),
      availableDates,
    };

    // Apply filters
    let filtered = all;
    if (filters?.type && filters.type !== 'ALL') {
      const targetType = filters.type.toUpperCase();
      filtered = filtered.filter((c) => c.callType === targetType);
    }
    if (filters?.date && filters.date !== 'ALL') {
      filtered = filtered.filter((c) => c.callDate === filters.date);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          c.phoneNumber.toLowerCase().includes(q) ||
          (c.callerName && c.callerName.toLowerCase().includes(q))
      );
    }

    return { logs: filtered, stats };
  }

  deleteCallLogsForDevice(deviceId: string): void {
    if (!this.data.callLogs) return;
    this.data.callLogs = this.data.callLogs.filter((c) => c.deviceId !== deviceId);
    this.save();
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
