export type DeviceStatus = 'ONLINE' | 'OFFLINE';

export interface Device {
  id: string; // UUID
  deviceId: string; // Hardware/Android ID
  deviceName: string;
  osVersion: string;
  ipAddress?: string;
  status: DeviceStatus;
  batteryLevel: number; // 0 - 100
  isDeviceOwner: boolean;
  enrolledAt: string; // ISO timestamp
  lastHeartbeat: string; // ISO timestamp
  lastSyncedTimestamp: string; // ISO timestamp (anchor for delta logs)
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
  nightlySyncTime: string; // e.g. "23:00"
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
  frontPhotoPath?: string;
  backPhotoPath?: string;
  screenPhotoPath?: string;
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
  eventTimestamp: string; // When the event happened on the phone
  createdAt: string; // When the server received it
}

export interface AppUsage {
  id: string;
  deviceId: string;
  packageName: string;
  appName: string;
  foregroundSeconds: number; // Screen time in seconds
  launchCount: number;
  usageDate: string; // YYYY-MM-DD
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

export interface WsMessage<T = any> {
  type: string;
  deviceId?: string;
  payload: T;
  timestamp: string;
}

