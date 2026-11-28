import React, { useState } from 'react';
import {
  Camera,
  EyeOff,
  Usb,
  Terminal,
  DownloadCloud,
  RefreshCw,
  AlertOctagon,
  Clock,
  CheckCircle2,
  Sliders,
  Wifi,
  Zap,
  Radio,
} from 'lucide-react';
import { DevicePolicy } from '../types';
import { api } from '../services/api';

interface PolicySwitchboardProps {
  deviceId: string;
  policy: DevicePolicy;
  onPolicyUpdated: (updated: DevicePolicy) => void;
}

export const PolicySwitchboard: React.FC<PolicySwitchboardProps> = ({
  deviceId,
  policy,
  onPolicyUpdated,
}) => {
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const handleToggle = async (key: keyof DevicePolicy, currentValue: boolean) => {
    setUpdatingKey(key as string);
    setMsg(null);
    try {
      const updated = await api.updatePolicy(deviceId, {
        [key]: !currentValue,
      });
      onPolicyUpdated(updated);
      setMsg(`Updated policy: ${String(key)} -> ${!currentValue ? 'ENABLED' : 'DISABLED'}`);
      setTimeout(() => setMsg(null), 3000);
    } catch (err) {
      console.error('Failed to update policy:', err);
    } finally {
      setUpdatingKey(null);
    }
  };

  const policyItems = [
    {
      key: 'blockScreenCapture' as keyof DevicePolicy,
      title: 'Block Screen Capture & Recording',
      description: 'Blocks screenshots, screen recording, and casting of sensitive data.',
      icon: EyeOff,
      value: !!policy.blockScreenCapture,
      color: 'text-amber-400',
    },
    {
      key: 'disableCamera' as keyof DevicePolicy,
      title: 'Disable Hardware Camera',
      description: 'Locks camera hardware completely for all applications across OS.',
      icon: Camera,
      value: !!policy.disableCamera,
      color: 'text-rose-400',
    },
    {
      key: 'disableUsbTransfer' as keyof DevicePolicy,
      title: 'Disable USB File Transfer (MTP)',
      description: 'Allows phone charging only. Blocks PC file transfers & drive mounting.',
      icon: Usb,
      value: !!policy.disableUsbTransfer,
      color: 'text-blue-400',
    },
    {
      key: 'blockUsbDebugging' as keyof DevicePolicy,
      title: 'Block USB Debugging (ADB)',
      description: 'Disables developer debugging to prevent local computer tampering.',
      icon: Terminal,
      value: !!policy.blockUsbDebugging,
      color: 'text-purple-400',
    },
    {
      key: 'blockUnknownSources' as keyof DevicePolicy,
      title: 'Block Unknown Sources (Sideloading)',
      description: 'Prevents installing APKs from browser or chat apps.',
      icon: DownloadCloud,
      value: !!policy.blockUnknownSources,
      color: 'text-emerald-400',
    },
    {
      key: 'blockFactoryReset' as keyof DevicePolicy,
      title: 'Block Device Factory Reset',
      description: 'Prevents user from wiping phone via settings to remove EDR agent.',
      icon: AlertOctagon,
      value: !!policy.blockFactoryReset,
      color: 'text-red-400',
    },
    {
      key: 'isolateNetwork' as keyof DevicePolicy,
      title: 'Network Containment (Isolate Device)',
      description: 'Immediately cuts off all internet traffic except connection to EDR server.',
      icon: RefreshCw,
      value: !!policy.isolateNetwork,
      color: 'text-orange-400',
    },
    {
      key: 'nightlySyncEnabled' as keyof DevicePolicy,
      title: 'Nightly 11:00 PM Log Sync',
      description: 'Automatically forward delta logs daily at night 11:00 PM to server.',
      icon: Clock,
      value: !!policy.nightlySyncEnabled,
      color: 'text-cyan-400',
    },
    {
      key: 'hideAppFromSettings' as keyof DevicePolicy,
      title: 'Stealth Mode (Hide from Settings & Launcher)',
      description: 'Invokes DevicePolicyManager.setApplicationHidden() to completely hide the EDR agent from Settings Apps list, Data Usage, and Launcher.',
      icon: EyeOff,
      value: !!policy.hideAppFromSettings,
      color: 'text-purple-400',
    },
  ];

  return (
    <div className="cyber-card rounded-2xl p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            Security &amp; Policy Control Matrix
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Real-time DPC hardware locks and operating system restrictions
          </p>
        </div>
        {msg && (
          <div className="flex items-center space-x-1.5 text-xs font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-500/40 px-3 py-1.5 rounded-lg shadow-[0_0_10px_rgba(6,182,212,0.2)]">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{msg}</span>
          </div>
        )}
      </div>

      {/* Network Preferences (Wi-Fi / Hotspot, 5G, 4G) */}
      <div className="mb-6 p-4 rounded-xl bg-slate-900/80 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.08)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3 pb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-mono font-bold text-white tracking-wider uppercase">
              Network Preferences (Live Stream &amp; Media Uploads)
            </h3>
          </div>
          <p className="text-[10px] font-mono text-slate-400">
            📡 EDR Command WebSocket stays connected on all networks (~5 KB/hr)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Wi-Fi / Hotspot */}
          <div className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
            policy.allowWifiSync !== false
              ? 'bg-slate-950/90 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.1)]'
              : 'bg-slate-950/40 border-slate-800/80'
          }`}>
            <div className="flex items-start space-x-2.5">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-cyan-400">
                <Wifi className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  Wi-Fi / Hotspot
                  {policy.allowWifiSync !== false && (
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-bold">
                      ACTIVE
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Allow live stream &amp; media uploads when connected to Wi-Fi or Hotspot.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={updatingKey === 'allowWifiSync'}
              onClick={() => handleToggle('allowWifiSync', policy.allowWifiSync !== false)}
              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                policy.allowWifiSync !== false ? 'bg-cyan-500' : 'bg-slate-800'
              } ${updatingKey === 'allowWifiSync' ? 'opacity-50 cursor-wait' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 border border-slate-700 shadow ring-0 transition duration-200 ease-in-out ${
                  policy.allowWifiSync !== false ? 'translate-x-5 bg-white border-white' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* 5G Mobile Data */}
          <div className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
            policy.allow5gSync !== false
              ? 'bg-slate-950/90 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
              : 'bg-slate-950/40 border-slate-800/80'
          }`}>
            <div className="flex items-start space-x-2.5">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-emerald-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  5G Mobile Data
                  {policy.allow5gSync !== false && (
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                      ACTIVE
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Allow fast live streaming and cloud evidence uploads over 5G NR.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={updatingKey === 'allow5gSync'}
              onClick={() => handleToggle('allow5gSync', policy.allow5gSync !== false)}
              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                policy.allow5gSync !== false ? 'bg-emerald-500' : 'bg-slate-800'
              } ${updatingKey === 'allow5gSync' ? 'opacity-50 cursor-wait' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 border border-slate-700 shadow ring-0 transition duration-200 ease-in-out ${
                  policy.allow5gSync !== false ? 'translate-x-5 bg-white border-white' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* 4G / 4G+ Mobile Data */}
          <div className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
            !!policy.allow4gSync
              ? 'bg-slate-950/90 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
              : 'bg-slate-950/40 border-slate-800/80'
          }`}>
            <div className="flex items-start space-x-2.5">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-amber-400">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  4G / 4G+ Mobile Data
                  {!!policy.allow4gSync && (
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800 font-bold">
                      ACTIVE
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Allow live stream &amp; uploads on 4G. (When OFF, media is encrypted locally).
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={updatingKey === 'allow4gSync'}
              onClick={() => handleToggle('allow4gSync', !!policy.allow4gSync)}
              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                !!policy.allow4gSync ? 'bg-amber-500' : 'bg-slate-800'
              } ${updatingKey === 'allow4gSync' ? 'opacity-50 cursor-wait' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 border border-slate-700 shadow ring-0 transition duration-200 ease-in-out ${
                  !!policy.allow4gSync ? 'translate-x-5 bg-white border-white' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {policyItems.map((item) => {
          const Icon = item.icon;
          const isPending = updatingKey === item.key;

          return (
            <div
              key={item.key}
              className={`p-4 rounded-xl border transition-all flex items-start justify-between gap-4 ${
                item.value
                  ? 'bg-slate-900/90 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div className={`p-2.5 rounded-xl bg-slate-900 border border-slate-800 ${item.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    {item.title}
                    {item.value && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                        ACTIVE
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.description}</p>
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleToggle(item.key, item.value)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  item.value ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.4)]' : 'bg-slate-800'
                } ${isPending ? 'opacity-50 cursor-wait' : ''}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-slate-950 border border-slate-700 shadow ring-0 transition duration-200 ease-in-out ${
                    item.value ? 'translate-x-5 bg-white border-white' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

