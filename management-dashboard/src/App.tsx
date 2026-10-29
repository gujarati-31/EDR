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

  // Connection Notification State
  const [connectionNotice, setConnectionNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [isConnectingDevice, setIsConnectingDevice] = useState(false);
  const [isDisconnectingDevice, setIsDisconnectingDevice] = useState(false);

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

  // Initial Data Load
  useEffect(() => {
    loadDevices();
    loadLogs();
  }, []);

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
          setSelectedDevice((prev) => (prev && prev.deviceId === data.deviceId ? { ...prev, status: 'ONLINE', batteryLevel: data.batteryLevel ?? prev.batteryLevel } : prev));
        }
        loadDevices();
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
        break;
      case 'POLICY_UPDATED':
        if (selectedDevice && data.deviceId === selectedDevice.deviceId) {
          setCurrentPolicy(data.policy);
        }
        break;
      case 'SCREEN_FRAME':
        if (selectedDevice && data.deviceId === selectedDevice.deviceId) {
          setScreenFrame(data);
        }
        break;
      case 'SCREEN_STREAM_STATUS':
        if (selectedDevice && data.deviceId === selectedDevice.deviceId) {
          setStreamStatus(data);
        }
        break;
      case 'RECORDING_SAVED':
        loadLogs(selectedDevice?.deviceId);
        break;
      default:
        break;
    }
  }, [loadDevices, loadLogs, selectedDevice]);

  const { isConnected } = useWebSocket(handleWebSocketEvent);

  const onlineCount = devices.filter((d) => d.status === 'ONLINE').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        wsConnected={isConnected}
        onlineCount={onlineCount}
        totalCount={devices.length}
        criticalCount={criticalCount}
      />

      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
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

        {/* Top: Devices Selector Bar */}
        <DeviceList
          devices={devices}
          selectedDeviceId={selectedDevice?.deviceId || null}
          onSelectDevice={(d) => setSelectedDevice(d)}
          onRefresh={loadDevices}
        />

        {selectedDevice ? (
          <div className="space-y-5">
            {/* Cyber Device Command Hero Bar */}
            <div className="cyber-card rounded-2xl p-5 border border-cyan-900/40 shadow-[0_4px_25px_rgba(0,0,0,0.6)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center space-x-4">
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

              {/* Big High-Visibility Connect / Disconnect Cyber Action Button */}
              <div className="flex items-center gap-3">
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
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.25)] transition-all active:scale-95 disabled:opacity-50"
                    title="Disconnect device connection from server"
                  >
                    {isDisconnectingDevice ? (
                      <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-rose-400" />
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
                          setConnectionNotice({
                            type: 'error',
                            message: res.message || 'Device internet is OFF. Please turn on Wi-Fi or Mobile Data on your phone.',
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
                    className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-all active:scale-95 disabled:opacity-50 animate-pulse"
                    title="Connect phone to EDR server"
                  >
                    {isConnectingDevice ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <Wifi className="w-4 h-4 text-white" />
                    )}
                    <span>{isConnectingDevice ? 'ESTABLISHING LINK...' : 'CONNECT PHONE'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cyber Navigation Tabs Bar (5 Clear Sections) */}
            <div className="flex items-center flex-wrap gap-2 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800/80">
              <button
                onClick={() => setActiveTab('livescreen')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider transition-all ${
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
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider transition-all ${
                  activeTab === 'policy'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Shield className="w-4 h-4 text-blue-400" />
                <span>DEFENSE POLICIES</span>
              </button>

              <button
                onClick={() => setActiveTab('evidence')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider transition-all ${
                  activeTab === 'evidence'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Film className="w-4 h-4 text-purple-400" />
                <span>EVIDENCE VAULT</span>
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              </button>

              <button
                onClick={() => setActiveTab('media')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider transition-all ${
                  activeTab === 'media'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <FolderOpen className="w-4 h-4 text-rose-400" />
                <span>PHONE GALLERY (0-DISK)</span>
                {selectedDevice.status === 'ONLINE' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('apps')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider transition-all ${
                  activeTab === 'apps'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>APPS &amp; SCREEN TIME</span>
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider transition-all ${
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

            {/* TAB VIEW 2: DEFENSE POLICIES SWITCHBOARD */}
            {activeTab === 'policy' && currentPolicy && (
              <PolicySwitchboard
                deviceId={selectedDevice.deviceId}
                policy={currentPolicy}
                onPolicyUpdated={(pol) => setCurrentPolicy(pol)}
              />
            )}

            {/* TAB VIEW 3: FORENSIC EVIDENCE VAULT (3 DISTINCT TABS) */}
            {activeTab === 'evidence' && (
              <div className="space-y-4">
                {/* 3 Evidence Tabs Switcher */}
                <div className="flex items-center flex-wrap gap-2 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 w-fit">
                  <button
                    onClick={() => setEvidenceSubTab('livescreen')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
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
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
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
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
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
                  <RecordingsViewer deviceId={selectedDevice.deviceId} />
                )}

                {evidenceSubTab === 'camera_photos' && (
                  <IntruderPhotosViewer
                    deviceId={selectedDevice.deviceId}
                    isCapturing={isCapturingPhoto}
                    onCaptureRequested={async () => {
                      setIsCapturingPhoto(true);
                      try {
                        await api.dispatchCommand(selectedDevice.deviceId, 'CAPTURE_PHOTO');
                        setTimeout(() => {
                          loadLogs(selectedDevice.deviceId);
                        }, 3000);
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
                <div className="flex items-center gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800 w-fit">
                  <button
                    onClick={() => setAppSubTab('inventory')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
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
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
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
          <div className="cyber-card rounded-2xl p-16 text-center text-slate-400 border border-slate-800">
            <Shield className="w-10 h-10 text-cyan-400/40 mx-auto mb-3 animate-pulse" />
            <h3 className="text-base font-mono font-bold text-white mb-1 uppercase tracking-wider">
              No Target Endpoint Selected
            </h3>
            <p className="text-xs font-mono text-slate-500 max-w-md mx-auto">
              Select an enrolled device from the endpoints matrix above to engage live remote control, policies, and forensic telemetry.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

