export type DeviceStatus = 'ONLINE' | 'OFFLINE';

export interface Device {
  id: string;
  deviceId: string;
  deviceName: string;
  osVersion: string;
  ipAddress?: string;
  status: DeviceStatus;
  batteryLevel: number;
  isDeviceOwner: boolean;
  enrolledAt: string;
  lastHeartbeat: string;
  lastSyncedTimestamp: string;
  isLiveConnected?: boolean;
}

export interface DevicePolicy {
  deviceId: string;
  blockScreenCapture: boolean;
  disableCamera: boolean;
  disableUsbTransfer: boolean;
  blockUsbDebugging: boolean;
  blockUnknownSources: boolean;
  blockFactoryReset: boolean;
  isolateNetwork: boolean;
  nightlySyncEnabled: boolean;
  nightlySyncTime: string;
  trapAppPackages?: string[];
  updatedAt: string;
}

export type CommandType =
  | 'LOCK_DEVICE'
  | 'REBOOT_DEVICE'
  | 'WIPE_DEVICE'
  | 'GET_LOGS'
  | 'CAPTURE_PHOTO'
  | 'START_SCREEN_STREAM'
  | 'STOP_SCREEN_STREAM'
  | 'CAPTURE_SCREENSHOT_PROOF'
  | 'UNINSTALL_APP'
  | 'DELETE_FILE'
  | 'ISOLATE_NETWORK'
  | 'RECONNECT_NETWORK'
  | 'DISCONNECT_DEVICE'
  | 'CONNECT_DEVICE';

export interface IntruderPhoto {
  id: string;
  deviceId: string;
  photoType?: 'CAMERA_PHOTO' | 'LIVE_SCREEN_PROOF';
  frontPhotoUrl?: string;
  backPhotoUrl?: string;
  screenPhotoUrl?: string;
  triggerReason?: string;
  timestamp: string;
  createdAt: string;
}

export interface RecordedVideo {
  id: string;
  deviceId: string;
  filename: string;
  url: string;
  recordingType?: 'APP_TRAP' | 'LIVE_SCREEN';
  duration?: string;
  sizeBytes: number;
  timestamp: string;
  createdAt: string;
}

export type CommandStatus = 'PENDING' | 'SENT' | 'EXECUTED' | 'FAILED';

export interface Command {
  id: string;
  deviceId: string;
  commandType: CommandType;
  parameters?: Record<string, any>;
  status: CommandStatus;
  resultMessage?: string;
  createdAt: string;
  executedAt?: string;
}

export type LogSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface LogEntry {
  id: string;
  deviceId: string;
  eventType: 'SYS_LOG' | 'NETWORK_CONN' | 'FILE_EVENT' | 'SECURITY_ALERT' | 'APP_EVENT';
  severity: LogSeverity;
  message: string;
  payload?: Record<string, any>;
  eventTimestamp: string;
  createdAt: string;
}

export interface AppUsage {
  id: string;
  deviceId: string;
  packageName: string;
  appName: string;
  foregroundSeconds: number;
  launchCount: number;
  usageDate: string;
}

export interface InstalledApp {
  id: string;
  deviceId: string;
  packageName: string;
  appName: string;
  versionName: string;
  isSystemApp: boolean;
  apkSha256?: string;
  installedAt?: string;
}

