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
  EdrActionLog,
  DataUsageStats,
  LogGapWarning,
  BiometricCredentials,
  AuthLockoutState,
  AuthAuditLog,
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
  actionLogs?: EdrActionLog[];
  latestRelease?: AppRelease;
  releases?: AppRelease[];
  biometrics?: BiometricCredentials;
  authLockout?: AuthLockoutState;
  authAuditLogs?: AuthAuditLog[];
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
    actionLogs: [],
    releases: [],
  };

  constructor() {
    this.init();
  }

  private init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const SEED_FILE = path.join(DATA_DIR, 'default_edr_seed.json');
    if (!fs.existsSync(DB_FILE) && fs.existsSync(SEED_FILE)) {
      try {
        fs.copyFileSync(SEED_FILE, DB_FILE);
        console.log('[DB] Initialized database from default seed file.');
      } catch (err) {
        console.warn('[DB] Failed to copy seed file:', err);
      }
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        if (!this.data.biometrics?.isEnrolled && fs.existsSync(SEED_FILE)) {
          try {
            const seedRaw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
            if (seedRaw.biometrics?.isEnrolled) {
              this.data.biometrics = seedRaw.biometrics;
              if (seedRaw.latestRelease && !this.data.latestRelease) {
                this.data.latestRelease = seedRaw.latestRelease;
              }
              if (seedRaw.releases && (!this.data.releases || this.data.releases.length === 0)) {
                this.data.releases = seedRaw.releases;
              }
              console.log('[DB] Hydrated biometrics and releases from default seed file.');
              this.save();
            }
          } catch (seedErr) {
            console.warn('[DB] Failed hydrating from seed file:', seedErr);
          }
        }
        if (!this.data.photos) this.data.photos = [];
        if (!this.data.installedApps) this.data.installedApps = [];
        if (!this.data.recordings) this.data.recordings = [];
        if (!this.data.callLogs) this.data.callLogs = [];
        if (!this.data.actionLogs) this.data.actionLogs = [];
        if (!this.data.authAuditLogs) this.data.authAuditLogs = [];
        if (!this.data.authLockout) {
          this.data.authLockout = { failedAttempts: 0, lockedUntil: null };
        }
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

  // ─────────────────────────────────────────────────────────────
  // UNIVERSAL EDR ACTION LOGS & DATA USAGE ENGINE
  // ─────────────────────────────────────────────────────────────

  addActionLogs(logs: Omit<EdrActionLog, 'id' | 'createdAt'>[]): EdrActionLog[] {
    if (!this.data.actionLogs) this.data.actionLogs = [];
    const now = new Date().toISOString();
    const createdLogs: EdrActionLog[] = [];

    for (const item of logs) {
      if (!item.logId) continue;
      // Deduplicate by logId
      const exists = this.data.actionLogs.some((l) => l.logId === item.logId);
      if (exists) continue;

      const newLog: EdrActionLog = {
        id: crypto.randomUUID(),
        logId: item.logId,
        actionId: item.actionId,
        timestamp: item.timestamp || now,
        deviceId: item.deviceId,
        eventType: item.eventType,
        module: item.module,
        triggeredBy: item.triggeredBy,
        description: item.description,
        status: item.status,
        failureReason: item.failureReason,
        bytesUploaded: item.bytesUploaded || 0,
        bytesDownloaded: item.bytesDownloaded || 0,
        networkType: item.networkType,
        createdAt: now,
      };
      createdLogs.push(newLog);
      this.data.actionLogs.push(newLog);
    }

    // System 90-day retention cleanup rule: removes action logs older than 90 days
    const cutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    this.data.actionLogs = this.data.actionLogs.filter((l) => {
      const logTime = new Date(l.timestamp || l.createdAt).getTime();
      return !isNaN(logTime) && logTime >= cutoffMs;
    });

    // Sort by timestamp desc
    this.data.actionLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (createdLogs.length > 0) {
      this.save();
    }
    return createdLogs;
  }

  getActionLogs(
    deviceId?: string,
    filters?: {
      status?: string;
      module?: string;
      triggeredBy?: string;
      search?: string;
      eventType?: string;
    },
    page = 1,
    limit = 100
  ): { logs: EdrActionLog[]; total: number; page: number; totalPages: number } {
    if (!this.data.actionLogs) this.data.actionLogs = [];
    let list = this.data.actionLogs;

    if (deviceId) {
      list = list.filter((l) => l.deviceId === deviceId);
    }

    if (filters) {
      if (filters.status && filters.status !== 'ALL') {
        list = list.filter((l) => l.status.toLowerCase() === filters.status!.toLowerCase());
      }
      if (filters.module && filters.module !== 'ALL') {
        list = list.filter((l) => l.module.toLowerCase() === filters.module!.toLowerCase());
      }
      if (filters.triggeredBy && filters.triggeredBy !== 'ALL') {
        list = list.filter((l) => l.triggeredBy.toLowerCase() === filters.triggeredBy!.toLowerCase());
      }
      if (filters.eventType && filters.eventType !== 'ALL') {
        list = list.filter((l) => l.eventType.toLowerCase().includes(filters.eventType!.toLowerCase()));
      }
      if (filters.search && filters.search.trim()) {
        const q = filters.search.toLowerCase().trim();
        list = list.filter(
          (l) =>
            l.description.toLowerCase().includes(q) ||
            l.actionId.toLowerCase().includes(q) ||
            l.logId.toLowerCase().includes(q) ||
            l.module.toLowerCase().includes(q) ||
            l.eventType.toLowerCase().includes(q) ||
            (l.failureReason && l.failureReason.toLowerCase().includes(q))
        );
      }
    }

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (safePage - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    return {
      logs: paginated,
      total,
      page: safePage,
      totalPages,
    };
  }

  getDataUsage(deviceId?: string): DataUsageStats {
    if (!this.data.actionLogs) this.data.actionLogs = [];
    let list = this.data.actionLogs;
    if (deviceId) {
      list = list.filter((l) => l.deviceId === deviceId);
    }

    const now = Date.now();
    const todayStr = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgoMs = now - 30 * 24 * 60 * 60 * 1000;

    let totalUploadedBytes = 0;
    let totalDownloadedBytes = 0;
    let todayBytes = 0;
    let thisWeekBytes = 0;
    let thisMonthBytes = 0;

    for (const log of list) {
      const up = log.bytesUploaded || 0;
      const down = log.bytesDownloaded || 0;
      const entryTotal = up + down;

      totalUploadedBytes += up;
      totalDownloadedBytes += down;

      const logTimeMs = new Date(log.timestamp).getTime();

      if (log.timestamp.startsWith(todayStr)) {
        todayBytes += entryTotal;
      }
      if (!isNaN(logTimeMs) && logTimeMs >= sevenDaysAgoMs) {
        thisWeekBytes += entryTotal;
      }
      if (!isNaN(logTimeMs) && logTimeMs >= thirtyDaysAgoMs) {
        thisMonthBytes += entryTotal;
      }
    }

    return {
      totalBytes: totalUploadedBytes + totalDownloadedBytes,
      totalUploadedBytes,
      totalDownloadedBytes,
      todayBytes,
      thisWeekBytes,
      thisMonthBytes,
    };
  }

  detectLogGaps(deviceId: string, maxAllowedGapMinutes = 65): LogGapWarning[] {
    if (!this.data.actionLogs) this.data.actionLogs = [];
    const deviceLogs = this.data.actionLogs
      .filter((l) => l.deviceId === deviceId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (deviceLogs.length < 2) return [];

    const gaps: LogGapWarning[] = [];
    const maxGapMs = maxAllowedGapMinutes * 60 * 1000;

    for (let i = 0; i < deviceLogs.length - 1; i++) {
      const t1 = new Date(deviceLogs[i].timestamp).getTime();
      const t2 = new Date(deviceLogs[i + 1].timestamp).getTime();

      if (isNaN(t1) || isNaN(t2)) continue;

      const gapMs = t2 - t1;
      if (gapMs > maxGapMs) {
        const gapMins = Math.round(gapMs / (60 * 1000));
        const startStr = new Date(t1).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endStr = new Date(t2).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = new Date(t1).toLocaleDateString();

        gaps.push({
          startTime: new Date(t1).toISOString(),
          endTime: new Date(t2).toISOString(),
          gapMinutes: gapMins,
          message: `No activity logs recorded from ${startStr} to ${endStr} on ${dateStr} (${gapMins} mins). Potential device shutdown, offline period, or app tampering.`,
        });
      }
    }

    // Also check gap from latest log to now if device was supposed to check in within last 65 minutes
    const latest = deviceLogs[deviceLogs.length - 1];
    const latestTime = new Date(latest.timestamp).getTime();
    const timeSinceLatest = Date.now() - latestTime;
    if (timeSinceLatest > maxGapMs) {
      const gapMins = Math.round(timeSinceLatest / (60 * 1000));
      const startStr = new Date(latestTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      gaps.push({
        startTime: new Date(latestTime).toISOString(),
        endTime: new Date().toISOString(),
        gapMinutes: gapMins,
        message: `No activity logs received since ${startStr} (${gapMins} mins until now ${nowStr}). Device may be offline or stopped.`,
      });
    }

    // Return most recent gaps first
    return gaps.reverse();
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

  // ============================================================================
  // BIOMETRIC AUTHENTICATION & ACCESS AUDIT
  // ============================================================================

  getBiometrics(): BiometricCredentials {
    return this.data.biometrics || { isEnrolled: false };
  }

  saveBiometrics(creds: BiometricCredentials): void {
    this.data.biometrics = {
      ...creds,
      isEnrolled: true,
      enrolledAt: creds.enrolledAt || new Date().toISOString(),
    };
    this.save();
  }

  getLockoutState(): AuthLockoutState {
    const now = Date.now();
    if (!this.data.authLockout) {
      this.data.authLockout = { failedAttempts: 0, lockedUntil: null };
    }
    // If lock duration has expired, reset failed attempts
    if (this.data.authLockout.lockedUntil && now >= this.data.authLockout.lockedUntil) {
      this.data.authLockout.failedAttempts = 0;
      this.data.authLockout.lockedUntil = null;
      this.save();
    }
    return this.data.authLockout;
  }

  recordAuthFailure(
    stage: 'FACE' | 'FINGERPRINT' | 'EMERGENCY_RECOVERY',
    ip: string,
    userAgent?: string,
    details?: string
  ): AuthLockoutState {
    const state = this.getLockoutState();
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    state.lastAttemptAt = new Date().toISOString();

    const maxAttempts = 5;
    const lockDurationMs = 15 * 60 * 1000; // 15 minutes lockout

    let result: 'FAILED' | 'LOCKED' = 'FAILED';
    if (state.failedAttempts >= maxAttempts) {
      state.lockedUntil = Date.now() + lockDurationMs;
      result = 'LOCKED';
    }

    this.data.authLockout = state;
    this.addAuthAuditLog({
      stage,
      result,
      ip,
      userAgent,
      details: details || `Attempt ${state.failedAttempts}/${maxAttempts}${result === 'LOCKED' ? ' - Account locked for 15 minutes' : ''}`,
    });

    this.save();
    return state;
  }

  recordAuthSuccess(
    stage: 'ENROLL' | 'FACE' | 'FINGERPRINT' | 'EMERGENCY_RECOVERY' | 'SESSION',
    ip: string,
    userAgent?: string,
    details?: string
  ): void {
    this.data.authLockout = {
      failedAttempts: 0,
      lockedUntil: null,
      lastAttemptAt: new Date().toISOString(),
    };

    this.addAuthAuditLog({
      stage,
      result: 'SUCCESS',
      ip,
      userAgent,
      details: details || 'Authentication verified successfully',
    });

    this.save();
  }

  addAuthAuditLog(log: Omit<AuthAuditLog, 'id' | 'timestamp'>): void {
    if (!this.data.authAuditLogs) {
      this.data.authAuditLogs = [];
    }
    const entry: AuthAuditLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...log,
    };
    this.data.authAuditLogs.unshift(entry);
    // Keep last 300 logs
    if (this.data.authAuditLogs.length > 300) {
      this.data.authAuditLogs = this.data.authAuditLogs.slice(0, 300);
    }
    this.save();
  }

  getAuthAuditLogs(limit: number = 50): AuthAuditLog[] {
    return (this.data.authAuditLogs || []).slice(0, limit);
  }
}

export const db = new Database();
