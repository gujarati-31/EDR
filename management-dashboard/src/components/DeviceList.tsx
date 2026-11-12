import React, { useMemo, useState } from 'react';
import {
  Smartphone,
  Battery,
  ShieldCheck,
  ChevronRight,
  Cpu,
  Activity,
  Loader2,
  X,
  RefreshCw,
  Search,
  Pencil,
  Check,
} from 'lucide-react';
import { Device } from '../types';

interface DeviceListProps {
  devices: Device[];
  selectedDeviceId: string | null;
  onSelectDevice: (device: Device) => void;
  onRefresh: () => void;
  onCheckOnline?: (device: Device) => void;
  onRenameDevice?: (device: Device, newName: string) => Promise<void> | void;
  checkingDeviceId?: string | null;
  onCloseSidebar?: () => void;
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  onRefresh,
  onCheckOnline,
  onRenameDevice,
  checkingDeviceId,
  onCloseSidebar,
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...devices].sort((a, b) => {
      if (a.status === 'ONLINE' && b.status !== 'ONLINE') return -1;
      if (a.status !== 'ONLINE' && b.status === 'ONLINE') return 1;
      return a.deviceName.localeCompare(b.deviceName);
    });
    if (!q) return sorted;
    return sorted.filter(
      (d) =>
        d.deviceName.toLowerCase().includes(q) ||
        d.deviceId.toLowerCase().includes(q) ||
        d.osVersion.toLowerCase().includes(q)
    );
  }, [devices, search]);

  const onlineCount = devices.filter((d) => d.status === 'ONLINE').length;
  const offlineCount = devices.length - onlineCount;

  const commitRename = async (device: Device) => {
    const trimmed = draftName.trim();
    if (!trimmed || !onRenameDevice || trimmed === device.deviceName) {
      setEditingId(null);
      return;
    }
    setSavingRename(true);
    try {
      await onRenameDevice(device, trimmed);
      setEditingId(null);
    } finally {
      setSavingRename(false);
    }
  };

  return (
    <aside className="flex flex-col h-full bg-slate-950 border-r border-cyan-900/40 shadow-[12px_0_40px_rgba(0,0,0,0.75)]">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-slate-800/90 bg-slate-900/60 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-mono font-bold tracking-wider text-white uppercase flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span>Client Phones ({devices.length})</span>
          </h3>
          <p className="text-[10px] font-mono text-slate-400 mt-0.5">
            <span className="text-emerald-400 font-bold">{onlineCount} online</span>
            {' • '}
            <span className="text-rose-400 font-bold">{offlineCount} off</span>
            {' • Tap to open'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition"
            title="Refresh client list"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {onCloseSidebar && (
            <button
              type="button"
              onClick={onCloseSidebar}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition"
              title="Hide clients sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Search */}
      {devices.length > 2 && (
        <div className="px-3.5 pt-3 pb-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter phone name or ID..."
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-white placeholder-slate-500 focus:border-cyan-500 outline-none"
            />
          </div>
        </div>
      )}

      {/* Single-column Sidebar Client List */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        {filteredDevices.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs font-mono text-slate-500">
            {devices.length === 0
              ? '[!] No client phones enrolled yet. Install the EDR Agent APK on a phone.'
              : `No client matching "${search}".`}
          </div>
        ) : (
          filteredDevices.map((device) => {
            const isSelected = selectedDeviceId === device.deviceId || selectedDeviceId === device.id;
            const isOnline = device.status === 'ONLINE';
            const isDirectLive = isOnline && (device.isLiveConnected ?? true);

            return (
              <div
                key={device.id || device.deviceId}
                onClick={() => onSelectDevice(device)}
                className={`p-3 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
                  isSelected
                    ? 'bg-gradient-to-r from-cyan-950/60 to-slate-900 border-cyan-400/70 shadow-[0_0_20px_rgba(6,182,212,0.2)] ring-1 ring-cyan-500/30'
                    : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`relative p-2 rounded-xl border flex-shrink-0 ${
                        isOnline
                          ? isDirectLive
                            ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400'
                            : 'bg-amber-950/50 border-amber-500/40 text-amber-400'
                          : 'bg-slate-950 border-slate-800 text-slate-600'
                      }`}
                    >
                      <Smartphone className="w-4 h-4" />
                      <span
                        className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${
                          isOnline
                            ? isDirectLive
                              ? 'bg-emerald-400 animate-pulse'
                              : 'bg-amber-400 animate-pulse'
                            : 'bg-slate-600'
                        }`}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      {editingId === device.deviceId ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(device);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                            disabled={savingRename}
                            className="w-full px-2 py-0.5 rounded bg-slate-950 border border-cyan-500 text-xs font-bold text-white outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => commitRename(device)}
                            disabled={savingRename}
                            className="p-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/50 hover:bg-emerald-900"
                            title="Save name"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1 rounded bg-slate-900 text-slate-400 border border-slate-700 hover:text-white"
                            title="Cancel"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-bold text-white truncate">{device.deviceName}</h4>
                          {onRenameDevice && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(device.deviceId);
                                setDraftName(device.deviceName);
                              }}
                              className="p-0.5 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800 transition flex-shrink-0"
                              title="Change client name"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          {device.isDeviceOwner && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 flex-shrink-0"
                              title="Device Owner / DPC Active"
                            >
                              <ShieldCheck className="w-2.5 h-2.5 text-cyan-400" />
                              DPC
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 font-mono truncate">
                        {device.osVersion} • {device.deviceId.substring(0, 8)}...
                      </div>
                    </div>
                  </div>

                  <ChevronRight
                    className={`w-4 h-4 flex-shrink-0 ${
                      isSelected ? 'text-cyan-400' : 'text-slate-600'
                    }`}
                  />
                </div>

                {/* Bottom meta & quick Check Ping button */}
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/70">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${
                        isOnline
                          ? isDirectLive
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-950 text-slate-500 border border-slate-800'
                      }`}
                    >
                      {isOnline ? (isDirectLive ? 'ONLINE' : 'SYNCING') : 'OFFLINE'}
                    </span>

                    <div className="flex items-center space-x-1 text-[11px] text-slate-300 font-mono">
                      <Battery
                        className={`w-3 h-3 ${
                          (device.batteryLevel ?? 100) > 30 ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      />
                      <span>{device.batteryLevel ?? 100}%</span>
                    </div>

                    {device.permissions && (() => {
                      const permVals = Object.values(device.permissions).filter((v) => typeof v === 'boolean');
                      const granted = permVals.filter(Boolean).length;
                      const total = permVals.length || 9;
                      return (
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                            granted === total
                              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                              : 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          {granted}/{total}P
                        </span>
                      );
                    })()}
                  </div>

                  {onCheckOnline && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCheckOnline(device);
                      }}
                      disabled={checkingDeviceId === device.deviceId}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-950 hover:bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 transition-all active:scale-95 disabled:opacity-50"
                      title="Ping phone live right now"
                    >
                      {checkingDeviceId === device.deviceId ? (
                        <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                      ) : (
                        <Activity className="w-3 h-3 text-cyan-400" />
                      )}
                      <span>{checkingDeviceId === device.deviceId ? 'PING' : 'CHECK'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
