import React, { useEffect, useState, useCallback } from 'react';
import { Header } from './components/Header';
import { DeviceList } from './components/DeviceList';
import { PolicySwitchboard } from './components/PolicySwitchboard';
import { ActionButtons } from './components/ActionButtons';
import { LogViewer } from './components/LogViewer';
import { ScreenTimeViewer } from './components/ScreenTimeViewer';
import { AppManager } from './components/AppManager';
import { IntruderPhotosViewer } from './components/IntruderPhotosViewer';
import { LiveScreenViewer } from './components/LiveScreenViewer';
import { RecordingsViewer } from './components/RecordingsViewer';
import { LiveScreenEvidenceViewer } from './components/LiveScreenEvidenceViewer';
import { DeviceMediaExplorer } from './components/DeviceMediaExplorer';
import { DevicePermissionsViewer } from './components/DevicePermissionsViewer';
import { AgentUpdateModal } from './components/AgentUpdateModal';
import {
  Cast,
  Wifi,
  WifiOff,
  Film,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Shield,
  Smartphone,
  Battery,
  Terminal,
  Camera,
  Layers,
  Clock,
  Cpu,
  FolderOpen,
  Download,
  Activity,
  UploadCloud,
  Users,
} from 'lucide-react';
import { Device, DevicePolicy, LogEntry } from './types';
import { api } from './services/api';
import { useWebSocket } from './hooks/useWebSocket';

export const App: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [currentPolicy, setCurrentPolicy] = useState<DevicePolicy | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  
  // Streamlined Main Cyber Navigation Tabs
  const [activeTab, setActiveTab] = useState<'livescreen' | 'policy' | 'evidence' | 'media' | 'apps' | 'logs'>('livescreen');
  // Sub-tabs for grouped views
  const [evidenceSubTab, setEvidenceSubTab] = useState<'livescreen' | 'trap_recordings' | 'camera_photos'>('livescreen');
  const [appSubTab, setAppSubTab] = useState<'inventory' | 'screentime'>('inventory');

  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [photoRefreshTrigger, setPhotoRefreshTrigger] = useState(0);

  // Connection Notification State
  const [connectionNotice, setConnectionNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [isConnectingDevice, setIsConnectingDevice] = useState(false);
  const [isDisconnectingDevice, setIsDisconnectingDevice] = useState(false);
  const [checkingDeviceId, setCheckingDeviceId] = useState<string | null>(null);
  const [isOtaModalOpen, setIsOtaModalOpen] = useState(false);
  const [isClientSidebarOpen, setIsClientSidebarOpen] = useState(false);
  const [liveCheckResult, setLiveCheckResult] = useState<{
    deviceId: string;
    online: boolean;
    rttMs: number | null;
    screenOn?: boolean;
    checkedAt: string;
  } | null>(null);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [appsLastUpdated, setAppsLastUpdated] = useState<number>(0);
  const [recordingsLastUpdated, setRecordingsLastUpdated] = useState<number>(0);

  // Live Screen Streaming State
  const [screenFrame, setScreenFrame] = useState<{
    frameBase64: string;
    timestamp: string;
    width?: number;
    height?: number;
    frameSizeBytes?: number;
  } | null>(null);
  const [streamStatus, setStreamStatus] = useState<{ active: boolean; error?: string; targetFps?: number } | null>(null);

  // Load Devices
  const loadDevices = useCallback(async () => {
    try {
      const data = await api.getDevices();
      setDevices(data);
      if (data.length > 0 && !selectedDevice) {
        setSelectedDevice(data[0]);
      } else if (selectedDevice) {
        // Update selected device status in place
        const updated = data.find((d) => d.deviceId === selectedDevice.deviceId || d.id === selectedDevice.id);
        if (updated) setSelectedDevice(updated);
      }
    } catch (err) {
      console.error('Failed to load devices:', err);
    }
  }, [selectedDevice]);

  // Load Policies
  const loadPolicy = useCallback(async (deviceId: string) => {
    try {
      const pol = await api.getPolicy(deviceId);
      setCurrentPolicy(pol);
    } catch (err) {
      console.error('Failed to load policy:', err);
    }
  }, []);

  // Load Logs
  const loadLogs = useCallback(async (deviceId?: string) => {
    setIsRefreshingLogs(true);
    try {
      const data = await api.getLogs(deviceId);
      setLogs(data);
      const stats = await api.getLogStats();
      setCriticalCount(stats.critical);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setIsRefreshingLogs(false);
    }
  }, []);

  // Initial Data Load & periodic 60s background sync
  useEffect(() => {
    loadDevices();
    loadLogs();
    const interval = setInterval(() => {
      loadDevices();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isClientSidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsClientSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isClientSidebarOpen]);

  // When selected device changes, load its policy and logs
  useEffect(() => {
    if (selectedDevice) {
      loadPolicy(selectedDevice.deviceId);
      loadLogs(selectedDevice.deviceId);
    }
  }, [selectedDevice?.deviceId]);

  // Real-time WebSocket event handler
  const handleWebSocketEvent = useCallback((event: string, data: any) => {
    console.log(`[App] Event from Gateway: ${event}`, data);
    switch (event) {
      case 'DEVICE_REGISTERED':
        loadDevices();
        break;
      case 'DEVICE_STATUS_CHANGED':
        if (data?.deviceId) {
          setSelectedDevice((prev) => (prev && prev.deviceId === data.deviceId ? { ...prev, status: data.status } : prev));
        }
        loadDevices();
        break;
      case 'DEVICE_HEARTBEAT':
        if (data?.deviceId) {
          setSelectedDevice((prev) => (prev && prev.deviceId === data.deviceId ? {
            ...prev,
            status: 'ONLINE',
            isLiveConnected: true,
            batteryLevel: data.batteryLevel ?? prev.batteryLevel,
            networkQuality: data.networkQuality ?? prev.networkQuality,
            downstreamKbps: data.downstreamKbps ?? prev.downstreamKbps,
            permissions: data.permissions ?? prev.permissions
          } : prev));
          setDevices((prev) => prev.map((d) => d.deviceId === data.deviceId ? {
            ...d,
            status: 'ONLINE',
            isLiveConnected: true,
            batteryLevel: data.batteryLevel ?? d.batteryLevel,
            networkQuality: data.networkQuality ?? d.networkQuality,
            downstreamKbps: data.downstreamKbps ?? d.downstreamKbps,
            permissions: data.permissions ?? d.permissions
          } : d));
        }
        break;
      case 'DEVICE_PERMISSIONS_UPDATED':
        if (data?.deviceId) {
          setSelectedDevice((prev) => (prev && prev.deviceId === data.deviceId ? {
            ...prev,
            permissions: data.permissions
          } : prev));
          setDevices((prev) => prev.map((d) => d.deviceId === data.deviceId ? {
            ...d,
            permissions: data.permissions
          } : d));
        }
        break;
      case 'DEVICE_DELETED':
        if (data?.id) {
          setDevices((prev) => prev.filter((d) => d.id !== data.id && d.deviceId !== data.id));
          setSelectedDevice((prev) => (prev && (prev.id === data.id || prev.deviceId === data.id) ? null : prev));
        }
        break;
      case 'LOGS_RECEIVED':
        loadLogs(selectedDevice?.deviceId);
        loadDevices(); // refreshes lastSyncedTimestamp!
        break;
      case 'SECURITY_ALERT':
        loadLogs(selectedDevice?.deviceId);
        break;
      case 'PHOTO_CAPTURED':
        loadLogs(selectedDevice?.deviceId);
        setIsCapturingPhoto(false);
        setPhotoRefreshTrigger((prev) => prev + 1);
        break;
      case 'POLICY_UPDATED':
        if (selectedDevice && data.deviceId === selectedDevice.deviceId) {
          setCurrentPolicy(data.policy);
        }
        break;
      case 'SCREEN_FRAME':
        if (selectedDevice && (data.deviceId === selectedDevice.deviceId || data.deviceId === selectedDevice.id)) {
          setScreenFrame(data);
        }
        break;
      case 'SCREEN_STREAM_STATUS':
        if (selectedDevice && (data.deviceId === selectedDevice.deviceId || data.deviceId === selectedDevice.id)) {
          setStreamStatus(data);
        }
        break;
      case 'RECORDING_SAVED':
        loadLogs(selectedDevice?.deviceId);
        setRecordingsLastUpdated(Date.now());
        break;
      case 'APPS_SYNCED':
        setAppsLastUpdated(Date.now());
        break;
      default:
        break;
    }
  }, [loadDevices, loadLogs, selectedDevice]);

  const { isConnected } = useWebSocket(handleWebSocketEvent);

  const onlineCount = devices.filter((d) => d.status === 'ONLINE').length;

  const handleCheckDeviceOnline = useCallback(async (device: Device) => {
    setCheckingDeviceId(device.deviceId);
    setConnectionNotice({
      type: 'info',
      message: `Pinging ${device.deviceName} live to verify real connection...`,
    });
    try {
      const res = await api.checkDeviceOnline(device.deviceId);
      setLiveCheckResult({
        deviceId: device.deviceId,
        online: res.online,
        rttMs: res.rttMs,
        screenOn: res.screenOn,
        checkedAt: new Date().toLocaleTimeString(),
      });
      setSelectedDevice((prev) =>
        prev && prev.deviceId === device.deviceId
          ? { ...prev, status: res.status, isLiveConnected: res.online }
          : prev
      );
      await loadDevices();
      setConnectionNotice({
        type: res.online ? 'success' : 'error',
        message: res.message,
      });
      setTimeout(() => setConnectionNotice(null), 8000);
    } catch (err: any) {
      setConnectionNotice({
        type: 'error',
        message: `Live online check failed: ${err.message || 'Server error'}`,
      });
      setTimeout(() => setConnectionNotice(null), 8000);
    } finally {
      setCheckingDeviceId(null);
    }
  }, [loadDevices]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-x-hidden">
      <Header
        wsConnected={isConnected}
        onlineCount={onlineCount}
        totalCount={devices.length}
        criticalCount={criticalCount}
        isSidebarOpen={isClientSidebarOpen}
        onToggleSidebar={() => setIsClientSidebarOpen((prev) => !prev)}
        selectedDeviceName={selectedDevice?.deviceName}
        onOpenOtaModal={() => setIsOtaModalOpen(true)}
      />

      {/* Collapsible Slide-Out Clients Sidebar Drawer (hidden whenever a client is active unless toggled) */}
      {isClientSidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setIsClientSidebarOpen(false)}
          />
          <div className="relative z-10 w-[86vw] max-w-[340px] h-full">
            <DeviceList
              devices={devices}
              selectedDeviceId={selectedDevice?.deviceId || null}
              onSelectDevice={(d) => {
                setSelectedDevice(d);
                setIsClientSidebarOpen(false);
              }}
              onRefresh={loadDevices}
              onCheckOnline={handleCheckDeviceOnline}
              checkingDeviceId={checkingDeviceId}
              onCloseSidebar={() => setIsClientSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      <AgentUpdateModal
        isOpen={isOtaModalOpen}
        onClose={() => setIsOtaModalOpen(false)}
        selectedDeviceId={selectedDevice?.deviceId}
        selectedDeviceName={selectedDevice?.deviceName}
        onReleaseUpdated={(message, type) => {
          setConnectionNotice({ type, message });
          setTimeout(() => setConnectionNotice(null), 8000);
        }}
      />

      <main className="flex-1 px-3 py-4 sm:p-6 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
        {/* Inline Notification Banner for Connection / Status Messages */}
        {connectionNotice && (
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium shadow-md transition-all animate-in fade-in slide-in-from-top-2 ${
              connectionNotice.type === 'error'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : connectionNotice.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
                : 'bg-blue-950/90 border-blue-800 text-blue-200'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              {connectionNotice.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              ) : connectionNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
              )}
              <span>{connectionNotice.message}</span>
            </div>
            <button
              onClick={() => setConnectionNotice(null)}
              className="p-1 rounded-md hover:bg-black/30 text-slate-400 hover:text-white transition"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {selectedDevice ? (
          <div className="space-y-4 sm:space-y-5">
            {/* Cyber Device Command Hero Bar */}
            <div className="cyber-card rounded-2xl p-3.5 sm:p-5 border border-cyan-900/40 shadow-[0_4px_25px_rgba(0,0,0,0.6)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center space-x-3 sm:space-x-4 min-w-0">
                <div className={`relative p-3 rounded-2xl border flex-shrink-0 ${
                  selectedDevice.status === 'ONLINE'
                    ? 'bg-gradient-to-br from-emerald-950 to-slate-900 border-emerald-500/40 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}>
                  <Smartphone className="w-6 h-6" />
                  <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-slate-950 ${
                    selectedDevice.status === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                  }`} />
                </div>

                <div>
                  <div className="flex items-center flex-wrap gap-2.5">
                    <h2 className="text-lg font-extrabold text-white tracking-wide">{selectedDevice.deviceName}</h2>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-lg bg-slate-950/80 text-cyan-300 font-mono border border-cyan-800/40">
                      ID: {selectedDevice.deviceId}
                    </span>
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-lg font-mono font-bold tracking-wider ${
                      selectedDevice.status === 'ONLINE'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                        : 'bg-rose-950/60 text-rose-300 border border-rose-800/80'
                    }`}>
                      {selectedDevice.status}
                    </span>
                    {liveCheckResult && liveCheckResult.deviceId === selectedDevice.deviceId && (
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-lg font-mono font-bold tracking-wider border ${
                          liveCheckResult.online
                            ? 'bg-cyan-950/80 text-cyan-200 border-cyan-500/50'
                            : 'bg-rose-950/80 text-rose-200 border-rose-500/50'
                        }`}
                        title={`Last live ping verified at ${liveCheckResult.checkedAt}`}
                      >
                        {liveCheckResult.online
                          ? `VERIFIED LIVE • ${liveCheckResult.rttMs}ms${liveCheckResult.screenOn === false ? ' • SCREEN OFF' : ''}`
                          : `UNREACHABLE @ ${liveCheckResult.checkedAt}`}
                      </span>
                    )}
                    {selectedDevice.networkQuality === 'SLOW' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.25)] flex items-center gap-1" title="Client internet bandwidth is low (< 1.5 Mbps)">
                        <Wifi className="w-3 h-3 text-amber-400" />
                        SLOW INTERNET
                      </span>
                    )}
                    {selectedDevice.permissions && (() => {
                      const permVals = Object.values(selectedDevice.permissions).filter((v) => typeof v === 'boolean');
                      const granted = permVals.filter(Boolean).length;
                      const total = permVals.length || 8;
                      return (
                        <button
                          onClick={() => setActiveTab('policy')}
                          className={`text-[10px] px-2 py-0.5 rounded-lg font-mono font-bold flex items-center gap-1 transition-all ${
                            granted === total
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                              : 'bg-amber-950/80 text-amber-300 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                          }`}
                          title="Click to view permissions & policies"
                        >
                          <Shield className="w-3 h-3 text-cyan-400" />
                          <span>{granted}/{total} PERMS</span>
                        </button>
                      );
                    })()}
                    {selectedDevice.appVersionName && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-mono font-bold bg-slate-900 text-cyan-300 border border-slate-700">
                        v{selectedDevice.appVersionName}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-400 mt-1.5 flex items-center flex-wrap gap-3 font-mono">
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-slate-500" />
                      OS: <strong className="text-slate-300">{selectedDevice.osVersion}</strong>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="flex items-center gap-1">
                      <Battery className={`w-3.5 h-3.5 ${selectedDevice.batteryLevel > 30 ? 'text-emerald-400' : 'text-amber-400'}`} />
                      Battery: <strong className="text-slate-300">{selectedDevice.batteryLevel}%</strong>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-cyan-500" />
                      Last Sync: <strong className="text-cyan-400">{new Date(selectedDevice.lastSyncedTimestamp).toLocaleTimeString()}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* High-Visibility Command Action Buttons (2-col grid on phones, flex wrap on larger screens) */}
              <div className="grid grid-cols-2 sm:flex sm:items-center sm:flex-wrap gap-2 sm:gap-3 w-full lg:w-auto">
                {/* Switch Client / Show Sidebar Button */}
                <button
                  type="button"
                  onClick={() => setIsClientSidebarOpen(true)}
                  className="inline-flex items-center justify-center space-x-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 transition-all active:scale-95"
                  title="Open client list sidebar to switch phone"
                >
                  <Users className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span>SWITCH ({devices.length})</span>
                </button>

                {/* Real Live Reachability Check Button */}
                <button
                  onClick={() => handleCheckDeviceOnline(selectedDevice)}
                  disabled={checkingDeviceId === selectedDevice.deviceId}
                  className="inline-flex items-center justify-center space-x-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-slate-900 hover:bg-cyan-950 text-cyan-200 border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.18)] transition-all active:scale-95 disabled:opacity-50"
                  title="Send a real live ping to verify if phone is genuinely online before opening Live Screen or Gallery"
                >
                  {checkingDeviceId === selectedDevice.deviceId ? (
                    <Loader2 className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  )}
                  <span>{checkingDeviceId === selectedDevice.deviceId ? 'CHECKING...' : 'CHECK ONLINE'}</span>
                </button>

                {/* Push / Upload OTA Agent APK Button */}
                <button
                  onClick={() => setIsOtaModalOpen(true)}
                  className="inline-flex items-center justify-center space-x-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-indigo-950/80 hover:bg-indigo-900 text-indigo-200 border border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.2)] transition-all active:scale-95"
                  title="Upload a new APK release or push OTA update to this phone"
                >
                  <UploadCloud className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <span>UPDATE APK</span>
                </button>

                {/* Immediate GET DATA Button */}
                <button
                  onClick={async () => {
                    setIsFetchingData(true);
                    setConnectionNotice({
                      type: 'info',
                      message: `Requesting real-time device data from ${selectedDevice.deviceName}...`,
                    });
                    try {
                      await api.dispatchCommand(selectedDevice.deviceId, 'GET_DATA');
                      setTimeout(() => {
                        loadDevices();
                        loadLogs(selectedDevice.deviceId);
                      }, 2000);
                      setTimeout(() => {
                        loadDevices();
                        loadLogs(selectedDevice.deviceId);
                        setIsFetchingData(false);
                        setConnectionNotice({
                          type: 'success',
                          message: `Live data received from ${selectedDevice.deviceName}!`,
                        });
                        setTimeout(() => setConnectionNotice(null), 5000);
                      }, 5000);
                    } catch (err: any) {
                      setIsFetchingData(false);
                      setConnectionNotice({
                        type: 'error',
                        message: `Failed to fetch data: ${err.message}`,
                      });
                    }
                  }}
                  disabled={isFetchingData || selectedDevice.status !== 'ONLINE'}
                  className="inline-flex items-center justify-center space-x-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-gradient-to-r from-cyan-950 via-teal-950 to-slate-900 hover:from-cyan-900 hover:to-teal-900 text-cyan-200 border border-cyan-400/50 shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all active:scale-95 disabled:opacity-50"
                  title="Pull real-time device telemetry, screen time, app inventory, and threat logs now"
                >
                  <Download className={`w-4 h-4 text-cyan-400 flex-shrink-0 ${isFetchingData ? 'animate-bounce' : ''}`} />
                  <span>{isFetchingData ? 'FETCHING...' : 'GET DATA'}</span>
                </button>

                {selectedDevice.status === 'ONLINE' ? (
                  <button
                    onClick={async () => {
                      setIsDisconnectingDevice(true);
                      setConnectionNotice({
                        type: 'info',
                        message: `Disconnecting ${selectedDevice.deviceName} from EDR server...`,
                      });
                      try {
                        const res = await api.disconnectDevice(selectedDevice.deviceId);
                        setSelectedDevice((prev) => (prev ? { ...prev, status: 'OFFLINE' } : null));
                        await loadDevices();
                        setConnectionNotice({
                          type: 'info',
                          message: res.message || `${selectedDevice.deviceName} disconnected from server.`,
                        });
                        setTimeout(() => setConnectionNotice(null), 6000);
                      } catch (err: any) {
                        setConnectionNotice({
                          type: 'error',
                          message: `Failed to disconnect: ${err.message}`,
                        });
                      } finally {
                        setIsDisconnectingDevice(false);
                      }
                    }}
                    disabled={isDisconnectingDevice}
                    className="col-span-2 sm:col-span-1 inline-flex items-center justify-center space-x-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.25)] transition-all active:scale-95 disabled:opacity-50"
                    title="Disconnect device connection from server"
                  >
                    {isDisconnectingDevice ? (
                      <Loader2 className="w-4 h-4 text-rose-400 animate-spin flex-shrink-0" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    )}
                    <span>{isDisconnectingDevice ? 'DISCONNECTING...' : 'DISCONNECT'}</span>
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      setIsConnectingDevice(true);
                      setConnectionNotice({
                        type: 'info',
                        message: `Attempting to connect ${selectedDevice.deviceName}...`,
                      });
                      try {
                        const res = await api.connectDevice(selectedDevice.deviceId);
                        if (res.success) {
                          setSelectedDevice((prev) => (prev ? { ...prev, status: 'ONLINE' } : null));
                          await loadDevices();
                          setConnectionNotice({
                            type: 'success',
                            message: res.message || `${selectedDevice.deviceName} connected successfully!`,
                          });
                        } else {
                          await loadDevices();
                          const noticeType = res.errorType === 'SLOW_INTERNET' ? 'info' : 'error';
                          setConnectionNotice({
                            type: noticeType,
                            message: res.message || 'Connection attempt failed. Check phone status.',
                          });
                        }
                        setTimeout(() => setConnectionNotice(null), 8000);
                      } catch (err: any) {
                        await loadDevices();
                        setConnectionNotice({
                          type: 'error',
                          message: err.message || 'Connection attempt failed. Check phone status.',
                        });
                        setTimeout(() => setConnectionNotice(null), 8000);
                      } finally {
                        setIsConnectingDevice(false);
                      }
                    }}
                    disabled={isConnectingDevice}
                    className="col-span-2 sm:col-span-1 inline-flex items-center justify-center space-x-2 px-5 sm:px-6 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-all active:scale-95 disabled:opacity-50 animate-pulse"
                    title="Connect phone to EDR server"
                  >
                    {isConnectingDevice ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin flex-shrink-0" />
                    ) : (
                      <Wifi className="w-4 h-4 text-white flex-shrink-0" />
                    )}
                    <span>{isConnectingDevice ? 'ESTABLISHING LINK...' : 'CONNECT PHONE'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cyber Navigation Tabs Bar (Horizontally scrollable on mobile phones, wrapped cleanly on desktop) */}
            <div className="flex items-center overflow-x-auto no-scrollbar sm:flex-wrap gap-1.5 sm:gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800/80">
              <button
                onClick={() => setActiveTab('livescreen')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold tracking-wider transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'livescreen'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Cast className="w-4 h-4 text-cyan-400" />
                <span>LIVE REMOTE</span>
                {selectedDevice.status === 'ONLINE' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('policy')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold tracking-wider transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'policy'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Shield className="w-4 h-4 text-blue-400" />
                <span>POLICIES &amp; PERMS</span>
                {selectedDevice.permissions && (() => {
                  const permVals = Object.values(selectedDevice.permissions).filter((v) => typeof v === 'boolean');
                  const granted = permVals.filter(Boolean).length;
                  const total = permVals.length || 9;
                  return (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono ${
                      granted === total
                        ? 'bg-emerald-900/80 text-emerald-300'
                        : 'bg-amber-900/80 text-amber-300 animate-pulse'
                    }`}>
                      {granted}/{total}
                    </span>
                  );
                })()}
              </button>

              <button
                onClick={() => setActiveTab('evidence')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold tracking-wider transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'evidence'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Film className="w-4 h-4 text-purple-400" />
                <span>EVIDENCE</span>
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              </button>

              <button
                onClick={() => setActiveTab('media')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold tracking-wider transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'media'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <FolderOpen className="w-4 h-4 text-rose-400" />
                <span>GALLERY</span>
                {selectedDevice.status === 'ONLINE' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('apps')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold tracking-wider transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'apps'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>APPS &amp; TIME</span>
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold tracking-wider transition-all whitespace-nowrap flex-shrink-0 ${
                  activeTab === 'logs'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Terminal className="w-4 h-4 text-amber-400" />
                <span>THREAT LOGS</span>
              </button>
            </div>

            {/* TAB VIEW 1: LIVE REMOTE SCREEN & ACTION TERMINAL */}
            {activeTab === 'livescreen' && (
              <div className="space-y-5">
                <LiveScreenViewer
                  deviceId={selectedDevice.deviceId}
                  isOnline={selectedDevice.status === 'ONLINE'}
                  screenFrame={screenFrame}
                  streamStatus={streamStatus}
                />
                <ActionButtons
                  deviceId={selectedDevice.deviceId}
                  isOnline={selectedDevice.status === 'ONLINE'}
                  lastSyncedTimestamp={selectedDevice.lastSyncedTimestamp}
                  onCommandDispatched={() => {
                    loadLogs(selectedDevice.deviceId);
                    loadDevices();
                  }}
                />
              </div>
            )}

            {/* TAB VIEW 2: DEFENSE POLICIES & ENDPOINT PERMISSIONS SWITCHBOARD */}
            {activeTab === 'policy' && currentPolicy && (
              <div className="space-y-6">
                <DevicePermissionsViewer
                  permissions={selectedDevice.permissions}
                  deviceName={selectedDevice.deviceName}
                />
                <PolicySwitchboard
                  deviceId={selectedDevice.deviceId}
                  policy={currentPolicy}
                  onPolicyUpdated={(pol) => setCurrentPolicy(pol)}
                />
              </div>
            )}

            {/* TAB VIEW 3: FORENSIC EVIDENCE VAULT (3 DISTINCT TABS) */}
            {activeTab === 'evidence' && (
              <div className="space-y-4">
                {/* 3 Evidence Tabs Switcher */}
                <div className="flex items-center overflow-x-auto no-scrollbar sm:flex-wrap gap-1.5 sm:gap-2 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 w-full sm:w-fit">
                  <button
                    onClick={() => setEvidenceSubTab('livescreen')}
                    className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold transition-all whitespace-nowrap flex-shrink-0 ${
                      evidenceSubTab === 'livescreen'
                        ? 'bg-cyan-600 text-white shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Cast className="w-3.5 h-3.5 text-cyan-200" />
                    <span>Live Screen (Photos &amp; Videos)</span>
                  </button>

                  <button
                    onClick={() => setEvidenceSubTab('trap_recordings')}
                    className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold transition-all whitespace-nowrap flex-shrink-0 ${
                      evidenceSubTab === 'trap_recordings'
                        ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.35)]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5 text-purple-200" />
                    <span>App Trap Recordings</span>
                  </button>

                  <button
                    onClick={() => setEvidenceSubTab('camera_photos')}
                    className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] sm:text-xs font-mono font-bold transition-all whitespace-nowrap flex-shrink-0 ${
                      evidenceSubTab === 'camera_photos'
                        ? 'bg-rose-600 text-white shadow-[0_0_12px_rgba(244,63,94,0.35)]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5 text-rose-200" />
                    <span>Intruder Camera Snapshots</span>
                  </button>
                </div>

                {evidenceSubTab === 'livescreen' && (
                  <LiveScreenEvidenceViewer deviceId={selectedDevice.deviceId} />
                )}

                {evidenceSubTab === 'trap_recordings' && (
                  <RecordingsViewer
                    deviceId={selectedDevice.deviceId}
                    recordingsLastUpdated={recordingsLastUpdated}
                  />
                )}

                {evidenceSubTab === 'camera_photos' && (
                  <IntruderPhotosViewer
                    deviceId={selectedDevice.deviceId}
                    isCapturing={isCapturingPhoto}
                    refreshTrigger={photoRefreshTrigger}
                    onCaptureRequested={async () => {
                      setIsCapturingPhoto(true);
                      try {
                        await api.dispatchCommand(selectedDevice.deviceId, 'CAPTURE_PHOTO');
                        setTimeout(() => {
                          loadLogs(selectedDevice.deviceId);
                          setPhotoRefreshTrigger((c) => c + 1);
                        }, 3000);
                        setTimeout(() => {
                          setIsCapturingPhoto(false);
                          setPhotoRefreshTrigger((c) => c + 1);
                        }, 7000);
                      } catch (e: any) {
                        setIsCapturingPhoto(false);
                        alert('Capture command failed: ' + e.message);
                      }
                    }}
                  />
                )}
              </div>
            )}

            {/* TAB VIEW: LIVE ON-DEMAND PHONE GALLERY & VIDEOS (ZERO SERVER STORAGE) */}
            {activeTab === 'media' && (
              <DeviceMediaExplorer
                deviceId={selectedDevice.deviceId}
                isOnline={selectedDevice.status === 'ONLINE'}
              />
            )}

            {/* TAB VIEW 4: APPLICATION INVENTORY & SCREEN TIME */}
            {activeTab === 'apps' && (
              <div className="space-y-4">
                {/* Apps Sub-Tab Switcher */}
                <div className="flex items-center overflow-x-auto no-scrollbar gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800 w-full sm:w-fit">
                  <button
                    onClick={() => setAppSubTab('inventory')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-mono font-bold transition-all whitespace-nowrap flex-shrink-0 ${
                      appSubTab === 'inventory'
                        ? 'bg-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>App Inventory &amp; Traps</span>
                  </button>
                  <button
                    onClick={() => setAppSubTab('screentime')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-mono font-bold transition-all whitespace-nowrap flex-shrink-0 ${
                      appSubTab === 'screentime'
                        ? 'bg-cyan-600 text-white shadow-[0_0_12px_rgba(6,182,212,0.35)]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Daily Screen Time</span>
                  </button>
                </div>

                {appSubTab === 'inventory' ? (
                  <AppManager
                    deviceId={selectedDevice.deviceId}
                    policy={currentPolicy}
                    onPolicyUpdated={(pol) => setCurrentPolicy(pol)}
                    appsLastUpdated={appsLastUpdated}
                    onNavigateToRecordings={() => {
                      setActiveTab('evidence');
                      setEvidenceSubTab('trap_recordings');
                    }}
                  />
                ) : (
                  <ScreenTimeViewer deviceId={selectedDevice.deviceId} />
                )}
              </div>
            )}

            {/* TAB VIEW 5: SECURITY TELEMETRY & SYSTEM LOGS */}
            {activeTab === 'logs' && (
              <LogViewer
                logs={logs}
                onRefresh={() => loadLogs(selectedDevice.deviceId)}
                isRefreshing={isRefreshingLogs}
              />
            )}
          </div>
        ) : (
          <div className="cyber-card rounded-2xl p-8 sm:p-16 text-center text-slate-400 border border-slate-800 space-y-4">
            <Shield className="w-10 h-10 text-cyan-400/40 mx-auto animate-pulse" />
            <div>
              <h3 className="text-base font-mono font-bold text-white mb-1 uppercase tracking-wider">
                No Target Endpoint Selected
              </h3>
              <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
                Open the client sidebar to select an enrolled phone for live remote control, policies, and forensic telemetry.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsClientSidebarOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)] transition active:scale-95"
            >
              <Users className="w-4 h-4" />
              <span>SHOW CLIENTS ({devices.length})</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

