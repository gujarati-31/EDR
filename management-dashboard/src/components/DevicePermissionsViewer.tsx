import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Eye,
  Activity,
  BatteryCharging,
  HardDrive,
  Camera,
  Bell,
  Lock,
  Layers,
  PackagePlus,
  PhoneCall,
  Loader2,
  PauseCircle,
  AlertCircle,
} from 'lucide-react';
import { DevicePermissions } from '../types';
import { api } from '../services/api';

interface DevicePermissionsViewerProps {
  deviceId: string;
  isOnline: boolean;
  permissions?: DevicePermissions;
  osPermissions?: DevicePermissions;
  adminDisabledPermissions?: string[];
  deviceName?: string;
  onRefreshDevice?: () => void;
}

export const DevicePermissionsViewer: React.FC<DevicePermissionsViewerProps> = ({
  deviceId,
  isOnline,
  permissions,
  osPermissions,
  adminDisabledPermissions = [],
  deviceName = 'Device',
  onRefreshDevice,
}) => {
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const adminDisabledSet = new Set(adminDisabledPermissions);

  const permList: Array<{
    key: keyof DevicePermissions;
    name: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    isGranted: boolean;
    osGranted: boolean;
    isAdminDisabled: boolean;
    isCritical: boolean;
  }> = [
    {
      key: 'accessibility',
      name: 'Accessibility Protection Service',
      description: 'Silent screen mirroring, intruder traps & UI event interception (OS toggle via Admin)',
      icon: Eye,
      isGranted: permissions?.accessibility ?? false,
      osGranted: osPermissions?.accessibility ?? permissions?.accessibility ?? false,
      isAdminDisabled: adminDisabledSet.has('accessibility'),
      isCritical: true,
    },
    {
      key: 'usageStats',
      name: 'Usage Stats & App Tracking',
      description: 'App launch monitoring, daily screen time & foreground detection',
      icon: Activity,
      isGranted: permissions?.usageStats ?? false,
      osGranted: osPermissions?.usageStats ?? permissions?.usageStats ?? false,
      isAdminDisabled: adminDisabledSet.has('usageStats'),
      isCritical: true,
    },
    {
      key: 'batteryOptimization',
      name: 'Ignore Battery Optimizations',
      description: 'Redmi / Vivo / Samsung deep sleep bypass for uninterrupted sensors',
      icon: BatteryCharging,
      isGranted: permissions?.batteryOptimization ?? false,
      osGranted: osPermissions?.batteryOptimization ?? permissions?.batteryOptimization ?? false,
      isAdminDisabled: adminDisabledSet.has('batteryOptimization'),
      isCritical: true,
    },
    {
      key: 'manageStorage',
      name: 'All Files Access (Storage)',
      description: 'Forensic telemetry & evidence recording persistence in /sdcard/EDR',
      icon: HardDrive,
      isGranted: permissions?.manageStorage ?? false,
      osGranted: osPermissions?.manageStorage ?? permissions?.manageStorage ?? false,
      isAdminDisabled: adminDisabledSet.has('manageStorage'),
      isCritical: true,
    },
    {
      key: 'camera',
      name: 'Intruder Camera Access',
      description: 'Silent dual-camera photo captures on unauthorized access or command',
      icon: Camera,
      isGranted: permissions?.camera ?? false,
      osGranted: osPermissions?.camera ?? permissions?.camera ?? false,
      isAdminDisabled: adminDisabledSet.has('camera'),
      isCritical: true,
    },
    {
      key: 'notifications',
      name: 'System Notifications',
      description: 'Android persistent foreground service life-support & push alerts',
      icon: Bell,
      isGranted: permissions?.notifications ?? false,
      osGranted: osPermissions?.notifications ?? permissions?.notifications ?? false,
      isAdminDisabled: adminDisabledSet.has('notifications'),
      isCritical: true,
    },
    {
      key: 'deviceAdmin',
      name: 'Device Administrator',
      description: 'Remote device lock, wipe, kiosk mode & anti-uninstall protection',
      icon: Lock,
      isGranted: permissions?.deviceAdmin ?? false,
      osGranted: osPermissions?.deviceAdmin ?? permissions?.deviceAdmin ?? false,
      isAdminDisabled: adminDisabledSet.has('deviceAdmin'),
      isCritical: false,
    },
    {
      key: 'overlay',
      name: 'Display Over Other Apps',
      description: 'Hardware screen capture frame buffer & transparent security dialogs',
      icon: Layers,
      isGranted: permissions?.overlay ?? false,
      osGranted: osPermissions?.overlay ?? permissions?.overlay ?? false,
      isAdminDisabled: adminDisabledSet.has('overlay'),
      isCritical: false,
    },
    {
      key: 'installPackages',
      name: 'Install Unknown Apps (OTA Updates)',
      description: 'Enables remote APK self-updates pushed from the admin dashboard',
      icon: PackagePlus,
      isGranted: permissions?.installPackages ?? false,
      osGranted: osPermissions?.installPackages ?? permissions?.installPackages ?? false,
      isAdminDisabled: adminDisabledSet.has('installPackages'),
      isCritical: false,
    },
    {
      key: 'callLog',
      name: 'Phone History & Call Logs',
      description: 'Audits incoming, outgoing & missed calls with duration and recordings',
      icon: PhoneCall,
      isGranted: permissions?.callLog ?? false,
      osGranted: osPermissions?.callLog ?? permissions?.callLog ?? false,
      isAdminDisabled: adminDisabledSet.has('callLog'),
      isCritical: false,
    },
  ];

  const grantedCount = permList.filter((p) => p.isGranted).length;
  const totalCount = permList.length;
  const isAllGranted = grantedCount === totalCount;
  const isHealthy = grantedCount >= 6;

  const handleToggle = async (item: (typeof permList)[number]) => {
    if (!isOnline || togglingKey) return;
    const nextEnabled = !item.isGranted;
    setTogglingKey(item.key);
    setNotice(null);

    try {
      const res = await api.toggleDevicePermission(deviceId, item.key, nextEnabled);
      setNotice({
        type: 'success',
        text: res.message,
      });
      if (onRefreshDevice) {
        setTimeout(() => onRefreshDevice(), 500);
      }
    } catch (err: any) {
      setNotice({
        type: 'error',
        text: err?.message || `Failed updating ${item.name}`,
      });
    } finally {
      setTogglingKey(null);
    }
  };

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-5 border border-slate-800 bg-slate-950/70">
      {/* Header with Protection Score */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            Endpoint Protection Permissions (Remote Admin Control)
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            {isOnline
              ? `Live control enabled — toggle any EDR permission ON or OFF on ${deviceName}`
              : `${deviceName} is currently offline — viewing last known permission state`}
          </p>
        </div>

        {/* Protection Score Badge */}
        <div className="flex items-center space-x-2">
          <div
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold ${
              isAllGranted
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                : isHealthy
                ? 'bg-amber-950/80 text-amber-300 border-amber-600/60 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'bg-rose-950/80 text-rose-300 border-rose-600/60 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
            }`}
          >
            {isAllGranted ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            )}
            <span>
              {grantedCount}/{totalCount} PROTECTIONS ACTIVE ({Math.round((grantedCount / totalCount) * 100)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {notice && (
        <div
          className={`px-3.5 py-2.5 rounded-xl border text-xs font-mono flex items-center gap-2 ${
            notice.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
              : 'bg-rose-950/50 border-rose-700/60 text-rose-300'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Permissions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {permList.map((item) => {
          const Icon = item.icon;
          const isBusy = togglingKey === item.key;

          return (
            <div
              key={item.key}
              className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border transition ${
                item.isGranted
                  ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  : item.isAdminDisabled
                  ? 'bg-amber-950/15 border-amber-800/40 hover:border-amber-700/60'
                  : 'bg-rose-950/15 border-rose-900/40 hover:border-rose-700/60'
              }`}
            >
              <div className="flex items-start space-x-3 min-w-0">
                <div
                  className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${
                    item.isGranted
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : item.isAdminDisabled
                      ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                      : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="text-xs font-semibold text-white">{item.name}</h4>
                    {item.isCritical && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                        CORE
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{item.description}</p>
                </div>
              </div>

              {/* Status Pill + Interactive Toggle */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {item.isGranted ? (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/80 shadow-sm">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>TURNED ON</span>
                  </span>
                ) : item.isAdminDisabled ? (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/80 shadow-sm">
                    <PauseCircle className="w-3 h-3 text-amber-400" />
                    <span>OFF BY ADMIN</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-700/80 shadow-sm">
                    <XCircle className="w-3 h-3 text-rose-400" />
                    <span>TURNED OFF</span>
                  </span>
                )}

                <button
                  type="button"
                  disabled={!isOnline || isBusy}
                  onClick={() => handleToggle(item)}
                  title={
                    !isOnline
                      ? 'Phone must be online to change permissions'
                      : item.isGranted
                      ? `Turn OFF ${item.name} on ${deviceName}`
                      : `Turn ON ${item.name} on ${deviceName}`
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none ${
                    !isOnline
                      ? 'opacity-40 cursor-not-allowed bg-slate-800 border-slate-700'
                      : isBusy
                      ? 'cursor-wait bg-cyan-950 border-cyan-600'
                      : item.isGranted
                      ? 'bg-emerald-600/80 hover:bg-emerald-500 border-emerald-400/60 cursor-pointer'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-600 cursor-pointer'
                  }`}
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin mx-auto" />
                  ) : (
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        item.isGranted ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
