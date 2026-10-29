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

