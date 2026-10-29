import React from 'react';
import { Smartphone, Battery, ShieldCheck, ChevronRight, Cpu } from 'lucide-react';
import { Device } from '../types';

interface DeviceListProps {
  devices: Device[];
  selectedDeviceId: string | null;
  onSelectDevice: (device: Device) => void;
  onRefresh: () => void;
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
}) => {
  return (
    <div className="cyber-card rounded-2xl p-4 transition-all">
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-800/80">
        <h3 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          Monitored Endpoints ({devices.length})
        </h3>
        <span className="text-[11px] font-mono text-slate-500">
          SELECT DEVICE TO INSPECT &amp; CONTROL
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="py-8 text-center text-xs font-mono text-slate-500">
          [!] No devices enrolled. Install the EDR Agent APK to begin telemetry.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {devices.map((device) => {
            const isSelected = selectedDeviceId === device.deviceId || selectedDeviceId === device.id;
            const isOnline = device.status === 'ONLINE';

            return (
              <div
                key={device.id || device.deviceId}
                onClick={() => onSelectDevice(device)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-gradient-to-r from-cyan-950/40 to-slate-900 border-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.18)] ring-1 ring-cyan-500/30'
                    : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className={`relative p-2.5 rounded-xl border flex-shrink-0 ${
                    isOnline
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                      : 'bg-slate-900 border-slate-800 text-slate-600'
                  }`}>
                    <Smartphone className="w-5 h-5" />
                    <span
                      className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${
                        isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                      }`}
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <h4 className="text-sm font-bold text-white truncate">{device.deviceName}</h4>
                      {device.isDeviceOwner && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-cyan-950/70 text-cyan-300 border border-cyan-800/60" title="Device Owner / DPC Active">
                          <ShieldCheck className="w-2.5 h-2.5 text-cyan-400" />
                          DPC
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 text-[11px] text-slate-400 mt-0.5 font-mono">
                      <span className="truncate">{device.osVersion}</span>
                      <span>•</span>
                      <span className="text-slate-500 truncate">{device.deviceId.substring(0, 8)}...</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2.5 flex-shrink-0">
                  {/* Battery */}
                  <div className="flex items-center space-x-1 text-xs text-slate-300 font-mono">
                    <Battery className={`w-3.5 h-3.5 ${
                      (device.batteryLevel ?? 100) > 30 ? 'text-emerald-400' : 'text-amber-400'
                    }`} />
                    <span>{device.batteryLevel ?? 100}%</span>
                  </div>

                  {/* Status Indicator */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${
                      isOnline
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                        : 'bg-slate-900 text-slate-500 border border-slate-800'
                    }`}
                  >
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                  </span>

                  <ChevronRight className={`w-4 h-4 transition-transform ${
                    isSelected ? 'translate-x-0.5 text-cyan-400' : 'text-slate-600'
                  }`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
