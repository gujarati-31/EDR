import React from 'react';
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
} from 'lucide-react';
import { DevicePermissions } from '../types';

interface DevicePermissionsViewerProps {
  permissions?: DevicePermissions;
  deviceName?: string;
}

export const DevicePermissionsViewer: React.FC<DevicePermissionsViewerProps> = ({
  permissions,
  deviceName = 'Device',
}) => {
  const permList = [
    {
      key: 'accessibility',
      name: 'Accessibility Protection Service',
      description: 'Silent screen mirroring, intruder traps & UI event interception',
      icon: Eye,
      isGranted: permissions?.accessibility ?? false,
      isCritical: true,
    },
    {
      key: 'usageStats',
      name: 'Usage Stats & App Tracking',
      description: 'App launch monitoring, daily screen time & foreground detection',
      icon: Activity,
      isGranted: permissions?.usageStats ?? false,
      isCritical: true,
    },
    {
      key: 'batteryOptimization',
      name: 'Ignore Battery Optimizations',
      description: 'Redmi / Vivo / Samsung deep sleep bypass for uninterrupted sensors',
      icon: BatteryCharging,
      isGranted: permissions?.batteryOptimization ?? false,
      isCritical: true,
    },
    {
      key: 'manageStorage',
      name: 'All Files Access (Storage)',
      description: 'Forensic telemetry & evidence recording persistence in /sdcard/EDR',
      icon: HardDrive,
      isGranted: permissions?.manageStorage ?? false,
      isCritical: true,
    },
    {
      key: 'camera',
      name: 'Intruder Camera Access',
      description: 'Silent dual-camera photo captures on unauthorized access or command',
      icon: Camera,
      isGranted: permissions?.camera ?? false,
      isCritical: true,
    },
    {
      key: 'notifications',
      name: 'System Notifications',
      description: 'Android persistent foreground service life-support & push alerts',
      icon: Bell,
      isGranted: permissions?.notifications ?? false,
      isCritical: true,
    },
    {
      key: 'deviceAdmin',
      name: 'Device Administrator',
      description: 'Remote device lock, wipe, kiosk mode & anti-uninstall protection',
      icon: Lock,
      isGranted: permissions?.deviceAdmin ?? false,
      isCritical: false,
    },
    {
      key: 'overlay',
      name: 'Display Over Other Apps',
      description: 'Hardware screen capture frame buffer & transparent security dialogs',
      icon: Layers,
      isGranted: permissions?.overlay ?? false,
      isCritical: false,
    },
  ];

  const grantedCount = permList.filter((p) => p.isGranted).length;
  const totalCount = permList.length;
  const isAllGranted = grantedCount === totalCount;
  const isHealthy = grantedCount >= 6;

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-5 border border-slate-800 bg-slate-950/70">
      {/* Header with Protection Score */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            Endpoint Protection Permissions (Client System Status)
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Real-time status of Android permissions and OS security capabilities on {deviceName}
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

      {/* Permissions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {permList.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.key}
              className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border transition ${
                item.isGranted
                  ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  : 'bg-rose-950/15 border-rose-900/40 hover:border-rose-700/60'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div
                  className={`p-2 rounded-lg mt-0.5 ${
                    item.isGranted
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
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

              {/* Status Pill */}
              <div className="flex-shrink-0">
                {item.isGranted ? (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/80 shadow-sm">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>TURNED ON</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-700/80 shadow-sm animate-pulse">
                    <XCircle className="w-3 h-3 text-rose-400" />
                    <span>TURNED OFF</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
