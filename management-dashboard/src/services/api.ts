import { Device, DevicePolicy, Command, LogEntry, AppUsage, InstalledApp, CommandType, IntruderPhoto, RecordedVideo } from '../types';

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

  async disconnectDevice(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/devices/${id}/disconnect`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      message: json.message || '',
    };
  },

  async connectDevice(id: string): Promise<{ success: boolean; message: string; internetOff?: boolean }> {
    const res = await fetch(`${API_BASE}/devices/${id}/connect`, { method: 'POST' });
    const json = await res.json();
    return {
      success: json.success ?? false,
      message: json.message || '',
      internetOff: json.internetOff ?? false,
    };
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
};

