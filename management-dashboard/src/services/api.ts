import { Device, DevicePolicy, Command, LogEntry, AppUsage, InstalledApp, CommandType, IntruderPhoto, RecordedVideo, AppRelease, ProvisioningQrData, VaultOverviewData, VaultRecording, VaultPhoto, CallLogEntry, CallLogStats, EdrActionLog, DataUsageStats, LogGapWarning, AuthStatus, FaceVerifyResult, FingerprintChallengeData, FingerprintVerifyResult, EmergencyRecoveryResult, AuthAuditLog } from '../types';

const API_BASE = '/api';

export const api = {
  // Devices
  async getDevices(): Promise<Device[]> {
    const res = await fetch(`${API_BASE}/devices`);
    const json = await res.json();
    return json.data || [];
  },

  async getDevice(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/devices/${id}`);
    const json = await res.json();
    return json.data;
  },

  async deleteDevice(id: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
    const json = await res.json();
    return json.success;
  },

  async renameDevice(id: string, deviceName: string): Promise<Device> {
    const res = await fetch(`${API_BASE}/devices/${id}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.message || 'Failed to rename client');
    }
    return json.data;
  },

  async disconnectDevice(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/devices/${id}/disconnect`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      message: json.message || '',
    };
  },

  async connectDevice(id: string): Promise<{
    success: boolean;
    message: string;
    internetOff?: boolean;
    errorType?: 'INTERNET_OFF' | 'SLOW_INTERNET' | 'APP_NOT_INSTALLED' | 'APP_KILLED' | 'TIMEOUT' | 'UNKNOWN';
  }> {
    const res = await fetch(`${API_BASE}/devices/${id}/connect`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      message: json.message || '',
      internetOff: json.internetOff ?? false,
      errorType: json.errorType,
    };
  },

  async pauseDevice(id: string): Promise<{
    success: boolean;
    message: string;
    isPaused: boolean;
    dispatched?: boolean;
  }> {
    const res = await fetch(`${API_BASE}/devices/${id}/pause`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      message: json.message || '',
      isPaused: json.isPaused ?? true,
      dispatched: json.dispatched,
    };
  },

  async resumeDevice(id: string): Promise<{
    success: boolean;
    message: string;
    isPaused: boolean;
    dispatched?: boolean;
  }> {
    const res = await fetch(`${API_BASE}/devices/${id}/resume`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      message: json.message || '',
      isPaused: json.isPaused ?? false,
      dispatched: json.dispatched,
    };
  },

  async checkDeviceOnline(id: string): Promise<{
    success: boolean;
    online: boolean;
    status: 'ONLINE' | 'OFFLINE';
    rttMs: number | null;
    screenOn?: boolean;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/devices/${id}/ping`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      online: json.online ?? false,
      status: json.status || (json.online ? 'ONLINE' : 'OFFLINE'),
      rttMs: json.rttMs ?? null,
      screenOn: json.screenOn,
      message: json.message || '',
    };
  },

  async toggleDevicePermission(
    deviceId: string,
    permissionKey: string,
    enabled: boolean
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/permissions/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionKey, enabled }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.message || `Failed toggling ${permissionKey}`);
    }
    return {
      success: true,
      message: json.message || `Updated ${permissionKey}`,
    };
  },

  // OTA Agent Updates
  async getLatestRelease(): Promise<AppRelease | null> {
    const res = await fetch(`${API_BASE}/updates/latest`);
    const json = await res.json();
    return json.data || null;
  },

  async getProvisioningQr(serverUrl?: string, checksum?: string): Promise<ProvisioningQrData> {
    const params = new URLSearchParams();
    if (serverUrl?.trim()) params.set('serverUrl', serverUrl.trim());
    if (checksum?.trim()) params.set('checksum', checksum.trim());
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/updates/provisioning-qr${qs ? `?${qs}` : ''}`);
    return await res.json();
  },

  async uploadAgentRelease(
    file: File,
    versionCode: number,
    versionName: string,
    releaseNotes: string,
    pushToAll: boolean,
    signatureChecksum?: string
  ): Promise<{ success: boolean; message: string; data?: AppRelease; pushedCount?: number }> {
    const form = new FormData();
    form.append('apk', file);
    form.append('versionCode', String(versionCode));
    form.append('versionName', versionName);
    form.append('releaseNotes', releaseNotes);
    form.append('pushToAll', String(pushToAll));
    if (signatureChecksum?.trim()) {
      form.append('signatureChecksum', signatureChecksum.trim());
    }

    const res = await fetch(`${API_BASE}/updates`, {
      method: 'POST',
      body: form,
    });
    return await res.json();
  },

  async pushAgentUpdate(
    deviceId: string,
    force = false
  ): Promise<{ success: boolean; message: string; dispatched?: boolean; sentCount?: number }> {
    const res = await fetch(`${API_BASE}/updates/push/${deviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    return await res.json();
  },

  // Policies
  async getPolicy(deviceId: string): Promise<DevicePolicy> {
    const res = await fetch(`${API_BASE}/policies/${deviceId}`);
    const json = await res.json();
    return json.data;
  },

  async updatePolicy(deviceId: string, updates: Partial<DevicePolicy>): Promise<DevicePolicy> {
    const res = await fetch(`${API_BASE}/policies/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const json = await res.json();
    return json.data;
  },

  // Commands
  async dispatchCommand(
    deviceId: string,
    commandType: CommandType,
    parameters?: Record<string, any>
  ): Promise<Command> {
    const res = await fetch(`${API_BASE}/commands/${deviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandType, parameters }),
    });
    const json = await res.json();
    return json.data;
  },

  async getCommands(deviceId: string): Promise<Command[]> {
    const res = await fetch(`${API_BASE}/commands/${deviceId}`);
    const json = await res.json();
    return json.data || [];
  },

  // Logs
  async getLogs(deviceId?: string, severity?: string, limit = 200): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (deviceId) params.append('deviceId', deviceId);
    if (severity) params.append('severity', severity);
    params.append('limit', limit.toString());

    const res = await fetch(`${API_BASE}/logs?${params.toString()}`);
    const json = await res.json();
    return json.data || [];
  },

  async getLogStats(deviceId?: string): Promise<{ total: number; critical: number; warning: number; info: number }> {
    const params = new URLSearchParams();
    if (deviceId) params.append('deviceId', deviceId);

    const res = await fetch(`${API_BASE}/logs/stats?${params.toString()}`);
    const json = await res.json();
    return json.data || { total: 0, critical: 0, warning: 0, info: 0 };
  },

  // Usage & Apps
  async getAppUsage(deviceId: string, date?: string): Promise<{
    totalScreenTimeSeconds: number;
    formattedScreenTime: string;
    availableDates?: string[];
    selectedDate?: string;
    data: AppUsage[];
  }> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);

    const res = await fetch(`${API_BASE}/usage/${deviceId}?${params.toString()}`);
    return await res.json();
  },

  async getInstalledApps(deviceId: string): Promise<InstalledApp[]> {
    const res = await fetch(`${API_BASE}/usage/apps/${deviceId}`);
    const json = await res.json();
    return json.data || [];
  },

  // Intruder Evidence Photos
  async getIntruderPhotos(deviceId: string): Promise<IntruderPhoto[]> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/photos`);
    const json = await res.json();
    return json.data || [];
  },

  async uploadIntruderPhoto(
    deviceId: string,
    payload: { frontPhotoBase64?: string; backPhotoBase64?: string; screenPhotoBase64?: string; photoType?: string; triggerReason?: string; timestamp?: string }
  ): Promise<any> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return json.data;
  },

  async deleteIntruderPhoto(deviceId: string, photoId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/photos/${photoId}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    return json.success;
  },

  // Live Screen Video Recordings
  async getRecordings(deviceId: string): Promise<RecordedVideo[]> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/recordings`);
    const json = await res.json();
    return json.data || [];
  },

  async uploadRecording(deviceId: string, blob: Blob, duration: string): Promise<RecordedVideo> {
    const formData = new FormData();
    formData.append('video', blob, `recording_${Date.now()}.webm`);
    formData.append('duration', duration);
    const res = await fetch(`${API_BASE}/devices/${deviceId}/recordings`, {
      method: 'POST',
      body: formData,
    });
    const json = await res.json();
    return json.data;
  },

  async deleteRecording(deviceId: string, id: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/recordings/${id}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    return json.success;
  },

  async updateRecordingDuration(id: string, duration: string, deviceId?: string): Promise<boolean> {
    try {
      const url = deviceId
        ? `${API_BASE}/devices/${deviceId}/recordings/${id}/duration`
        : `${API_BASE}/vault/recordings/${id}/duration`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
      });
      const json = await res.json();
      return Boolean(json.success);
    } catch {
      return false;
    }
  },

  // On-Demand Device Media Explorer (Zero Server Storage)
  async getLiveDeviceMediaList(
    deviceId: string,
    params?: {
      type?: 'ALL' | 'IMAGE' | 'VIDEO';
      bucket?: string;
      search?: string;
      offset?: number;
      limit?: number;
    }
  ): Promise<{
    totalCount: number;
    totalMatched: number;
    totalImages: number;
    totalVideos: number;
    offset: number;
    limit: number;
    buckets: Record<string, number>;
    items: Array<{
      id: string;
      name: string;
      type: 'IMAGE' | 'VIDEO';
      mimeType: string;
      size: number;
      dateModified: number;
      width: number;
      height: number;
      duration: number;
      bucket: string;
      thumbnail: string;
    }>;
  }> {
    const q = new URLSearchParams();
    if (params?.type) q.append('type', params.type);
    if (params?.bucket) q.append('bucket', params.bucket);
    if (params?.search) q.append('search', params.search);
    if (params?.offset !== undefined) q.append('offset', params.offset.toString());
    if (params?.limit !== undefined) q.append('limit', params.limit.toString());

    const res = await fetch(`${API_BASE}/devices/${deviceId}/live-media-list?${q.toString()}`);
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.message || 'Failed to fetch device media');
    }
    return json.data;
  },

  getLiveMediaFileUrl(deviceId: string, mediaId: string, type: 'IMAGE' | 'VIDEO', download = false): string {
    return `${API_BASE}/devices/${deviceId}/live-media-file/${mediaId}?type=${type}${download ? '&download=1' : ''}`;
  },

  // Central Render Vault & Database Explorer
  async getVaultOverview(): Promise<VaultOverviewData> {
    const res = await fetch(`${API_BASE}/vault/overview`);
    return await res.json();
  },

  async getVaultRecordings(): Promise<VaultRecording[]> {
    const res = await fetch(`${API_BASE}/vault/recordings`);
    const json = await res.json();
    return json.data || [];
  },

  async getVaultPhotos(): Promise<VaultPhoto[]> {
    const res = await fetch(`${API_BASE}/vault/photos`);
    const json = await res.json();
    return json.data || [];
  },

  async getVaultDatabase(): Promise<any> {
    const res = await fetch(`${API_BASE}/vault/database`);
    const json = await res.json();
    return json.data || {};
  },

  getVaultExportUrl(): string {
    return `${API_BASE}/vault/export`;
  },

  // Phone Call History & Duration Logs
  async getCallLogs(
    deviceId: string,
    query?: { type?: string; date?: string; search?: string }
  ): Promise<{
    success: boolean;
    data: CallLogEntry[];
    stats: CallLogStats;
    deviceName?: string;
  }> {
    const params = new URLSearchParams();
    if (query?.type) params.set('type', query.type);
    if (query?.date) params.set('date', query.date);
    if (query?.search) params.set('search', query.search);
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/call-logs/${deviceId}${qs ? `?${qs}` : ''}`);
    return await res.json();
  },

  async triggerCallLogSync(deviceId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/call-logs/${deviceId}/sync`, { method: 'POST' });
    return await res.json();
  },

  // Universal Action Logs & Data Usage
  async getActionLogs(
    deviceId: string,
    params?: {
      page?: number;
      limit?: number;
      status?: string;
      module?: string;
      triggeredBy?: string;
      eventType?: string;
      search?: string;
    }
  ): Promise<{
    success: boolean;
    logs: EdrActionLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', params.page.toString());
    if (params?.limit) qs.set('limit', params.limit.toString());
    if (params?.status) qs.set('status', params.status);
    if (params?.module) qs.set('module', params.module);
    if (params?.triggeredBy) qs.set('triggeredBy', params.triggeredBy);
    if (params?.eventType) qs.set('eventType', params.eventType);
    if (params?.search) qs.set('search', params.search);
    const qStr = qs.toString();
    const res = await fetch(`${API_BASE}/devices/${deviceId}/action-logs${qStr ? `?${qStr}` : ''}`);
    return await res.json();
  },

  async getDataUsage(deviceId: string): Promise<{
    success: boolean;
    deviceId: string;
    dataUsage: DataUsageStats;
  }> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/data-usage`);
    return await res.json();
  },

  async getLogGaps(deviceId: string, maxGapMinutes = 65): Promise<{
    success: boolean;
    deviceId: string;
    gaps: LogGapWarning[];
  }> {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/log-gaps?maxGap=${maxGapMinutes}`);
    return await res.json();
  },

  // ==========================================================================
  // BIOMETRIC AUTHENTICATION & SECURITY CONSOLE
  // ==========================================================================

  async getAuthStatus(): Promise<AuthStatus> {
    const res = await fetch(`${API_BASE}/auth/status`);
    const json = await res.json();
    return json.data;
  },

  async enrollBiometrics(faceDescriptor: number[], webAuthnCredential: any): Promise<{
    success: boolean;
    emergencyRecoveryKey?: string;
    message?: string;
    error?: string;
  }> {
    const res = await fetch(`${API_BASE}/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faceDescriptor, webAuthnCredential }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || 'Enrollment failed' };
    }
    return {
      success: true,
      emergencyRecoveryKey: json.data?.emergencyRecoveryKey,
      message: json.message,
    };
  },

  async login(username: string, password: string): Promise<{ success: boolean; token?: string; error?: string }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || 'Authentication failed' };
    }
    return { success: true, token: json.data?.token };
  },

  async verifyFace(faceDescriptor: number[], livenessProof: any): Promise<FaceVerifyResult> {
    const res = await fetch(`${API_BASE}/auth/face-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faceDescriptor, livenessProof }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return {
        success: false,
        error: json.error || 'Face verification failed',
        similarity: json.similarity,
        remainingAttempts: json.remainingAttempts,
        isLocked: json.isLocked,
      };
    }
    return {
      success: true,
      message: json.message,
      faceVerificationToken: json.data?.faceVerificationToken,
      similarity: json.data?.similarity,
    };
  },

  async getFingerprintChallenge(): Promise<{
    success: boolean;
    data?: FingerprintChallengeData;
    error?: string;
  }> {
    const res = await fetch(`${API_BASE}/auth/fingerprint-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || 'Failed to initialize biometric challenge' };
    }
    return { success: true, data: json.data };
  },

  async verifyFingerprint(assertion: any, challengeId?: string, challenge?: string): Promise<FingerprintVerifyResult> {
    const res = await fetch(`${API_BASE}/auth/fingerprint-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion, challengeId, challenge }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return {
        success: false,
        error: json.error || 'Fingerprint verification failed',
        remainingAttempts: json.remainingAttempts,
        isLocked: json.isLocked,
      };
    }
    return {
      success: true,
      message: json.message,
      token: json.data?.token,
      expiresInSec: json.data?.expiresInSec,
    };
  },

  async emergencyRecover(recoveryKey: string): Promise<EmergencyRecoveryResult> {
    const res = await fetch(`${API_BASE}/auth/emergency-recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || 'Invalid emergency recovery key' };
    }
    return {
      success: true,
      message: json.message,
      token: json.data?.token,
      expiresInSec: json.data?.expiresInSec,
    };
  },

  async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch {}
  },

  async getAuthAuditLogs(): Promise<AuthAuditLog[]> {
    const res = await fetch(`${API_BASE}/auth/audit-logs`);
    const json = await res.json();
    return json.data || [];
  },
};

