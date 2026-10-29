import React, { useEffect, useState } from 'react';
import {
  Layers,
  Trash2,
  Search,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  Smartphone,
  Film,
  X,
  Lock,
  Play,
} from 'lucide-react';
import { InstalledApp } from '../types';
import { api } from '../services/api';
import { AppLogo } from './AppLogo';

interface AppManagerProps {
  deviceId: string;
  onNavigateToRecordings?: () => void;
}

export const AppManager: React.FC<AppManagerProps> = ({ deviceId, onNavigateToRecordings }) => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [trapAppPackages, setTrapAppPackages] = useState<string[]>([]);
  const [savingTrapPackage, setSavingTrapPackage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [uninstallingPackage, setUninstallingPackage] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [appTab, setAppTab] = useState<'user' | 'system'>('user');

  const loadData = async () => {
    setLoading(true);
    try {
      const [appsData, policyData] = await Promise.all([
        api.getInstalledApps(deviceId),
        api.getPolicy(deviceId).catch(() => null),
      ]);
      setApps(appsData);
      if (policyData && Array.isArray(policyData.trapAppPackages)) {
        setTrapAppPackages(policyData.trapAppPackages);
      }
    } catch (err) {
      console.error('Failed to load apps or policy:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      loadData();
    }
  }, [deviceId]);

  const handleToggleTrap = async (packageName: string, appName: string) => {
    const isCurrentlyTrapped = trapAppPackages.includes(packageName);
    const updated = isCurrentlyTrapped
      ? trapAppPackages.filter((p) => p !== packageName)
      : [...trapAppPackages, packageName];

    setTrapAppPackages(updated);
    setSavingTrapPackage(packageName);
    try {
      await api.updatePolicy(deviceId, {
        trapAppPackages: updated,
      });
      setStatusMsg(
        isCurrentlyTrapped
          ? `Disarmed screen recording trap for "${appName}".`
          : `🎥 Armed Screen Recording Trap for "${appName}"! When opened on phone, the screen will be silently recorded as video until closed, then uploaded to EDR Management.`
      );
      setTimeout(() => setStatusMsg(null), 6000);
    } catch (err: any) {
      alert(`Failed to update trap policy: ${err.message}`);
      setTrapAppPackages(trapAppPackages);
    } finally {
      setSavingTrapPackage(null);
    }
  };

  const handleUninstall = async (packageName: string) => {
    if (!confirm(`Remotely uninstall package "${packageName}" from device?`)) return;

    setUninstallingPackage(packageName);
    setStatusMsg(null);
    try {
      await api.dispatchCommand(deviceId, 'UNINSTALL_APP', { packageName });
      setStatusMsg(`Uninstall command dispatched for ${packageName}`);
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (err: any) {
      alert(`Failed to trigger uninstall: ${err.message}`);
    } finally {
      setUninstallingPackage(null);
    }
  };

  // Separate apps into User-Installed vs Android System Apps
  const userApps = apps.filter((a) => !a.isSystemApp);
  const systemApps = apps.filter((a) => a.isSystemApp);

  const currentList = appTab === 'user' ? userApps : systemApps;

  const filtered = currentList.filter(
    (a) =>
      a.appName.toLowerCase().includes(search.toLowerCase()) ||
      a.packageName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" />
            Device Application Inventory &amp; Screen Recording Traps
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Monitor installed apps, arm silent screen recording traps, or trigger remote uninstallations
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {onNavigateToRecordings && (
            <button
              onClick={onNavigateToRecordings}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-800 text-xs font-semibold transition"
              title="View all captured trap screen recordings"
            >
              <Film className="w-3.5 h-3.5 text-purple-400" />
              <span>View App Recordings</span>
            </button>
          )}

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`Search ${appTab === 'user' ? 'user' : 'system'} apps...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 w-56"
            />
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50"
            title="Refresh app inventory and policy"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Intruder App-Trap Control Banner */}
      <div className="p-3.5 bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-slate-950/60 border border-purple-800/60 rounded-xl space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-semibold text-purple-200">
                Intruder App-Trap Screen Recording ({trapAppPackages.length} Apps Armed)
              </span>
              <p className="text-[11px] text-slate-400">
                Whenever an intruder opens any monitored app below, the phone records the screen silently in high definition. When the app is closed, the video evidence is shared to EDR Management to track attacker activity.
              </p>
            </div>
          </div>

          {onNavigateToRecordings && (
            <button
              onClick={onNavigateToRecordings}
              className="self-start sm:self-center inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold transition shadow-sm"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Watch Evidence Videos</span>
            </button>
          )}
        </div>

        {trapAppPackages.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-purple-900/40">
            <span className="text-[10px] uppercase font-bold text-purple-400 mr-1 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Armed Video Traps:
            </span>
            {trapAppPackages.map((pkg) => {
              const matchedApp = apps.find((a) => a.packageName === pkg);
              const label = matchedApp ? matchedApp.appName : pkg;
              return (
                <span
                  key={pkg}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-purple-950/90 border border-purple-700 text-[11px] text-purple-200 font-medium shadow-sm"
                >
                  <span>🎥 {label}</span>
                  <button
                    onClick={() => handleToggleTrap(pkg, label)}
                    disabled={savingTrapPackage === pkg}
                    className="hover:text-rose-400 p-0.5 rounded-full hover:bg-black/30 transition"
                    title={`Remove ${label} from screen recording trap`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 pt-1">
            No trap apps configured yet. Click <strong>"Record Screen on Open"</strong> on WhatsApp, Instagram, Settings, or Banking apps below to activate.
          </div>
        )}
      </div>

      {statusMsg && (
        <div className="p-2.5 bg-blue-950/40 border border-blue-800 rounded-lg text-xs text-blue-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Tabs: Installed User Apps vs Android System Apps */}
      <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-2">
        <button
          onClick={() => setAppTab('user')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            appTab === 'user'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          <span>User Installed Apps</span>
          <span className="ml-1.5 px-2 py-0.2 rounded-full text-[10px] bg-black/30 font-mono">
            {userApps.length}
          </span>
        </button>

        <button
          onClick={() => setAppTab('system')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            appTab === 'system'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Android System Apps</span>
          <span className="ml-1.5 px-2 py-0.2 rounded-full text-[10px] bg-black/30 font-mono">
            {systemApps.length}
          </span>
        </button>
      </div>

      {/* App List / Table */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500">
          Loading installed packages and verifying signatures...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          {apps.length === 0
            ? 'No apps synchronized yet. The EDR Agent syncs packages automatically during log upload.'
            : 'No applications match your search query.'}
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Application</th>
                <th className="py-2.5 px-3 font-semibold">Package Identifier</th>
                <th className="py-2.5 px-3 font-semibold">Version</th>
                <th className="py-2.5 px-3 font-semibold text-center">Screen Recording Trap</th>
                <th className="py-2.5 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((app) => {
                const isTrapped = trapAppPackages.includes(app.packageName);
                const isSaving = savingTrapPackage === app.packageName;

                return (
                  <tr
                    key={app.id || app.packageName}
                    className={`hover:bg-slate-800/40 transition group ${
                      isTrapped ? 'bg-purple-950/20' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center space-x-3">
                        {/* Real Online App Logo with Fallback */}
                        <AppLogo
                          packageName={app.packageName}
                          appName={app.appName}
                          size={36}
                        />

                        <div>
                          <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                            <span>{app.appName}</span>
                            {isTrapped && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono">
                                ARMED TRAP
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-block text-[9px] px-1.5 py-0.2 rounded font-medium mt-0.5 ${
                              app.isSystemApp
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            }`}
                          >
                            {app.isSystemApp ? 'OS SYSTEM' : 'USER INSTALLED'}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                      {app.packageName}
                    </td>

                    <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                      v{app.versionName || '1.0'}
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => handleToggleTrap(app.packageName, app.appName)}
                        disabled={isSaving}
                        className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition border ${
                          isTrapped
                            ? 'bg-purple-950 text-purple-200 border-purple-600 shadow-sm shadow-purple-900/40 hover:bg-rose-950 hover:text-rose-300 hover:border-rose-700'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
                        } disabled:opacity-50`}
                        title={
                          isTrapped
                            ? 'Screen Recording trap active: Automatically records screen when opened, and uploads video when closed. Click to disarm.'
                            : 'Click to arm silent screen recording trap when this app opens'
                        }
                      >
                        <Film
                          className={`w-3.5 h-3.5 ${
                            isTrapped ? 'text-purple-400 animate-pulse' : 'text-slate-500'
                          }`}
                        />
                        <span>{isTrapped ? '🎥 Trap Active (Recording)' : '+ Record Screen on Open'}</span>
                      </button>
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      {!app.isSystemApp ? (
                        <button
                          onClick={() => handleUninstall(app.packageName)}
                          disabled={uninstallingPackage === app.packageName}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800 text-xs font-medium transition shadow-sm disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Uninstall</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500 px-2 py-1 rounded bg-slate-800/40 border border-slate-800">
                          Protected
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
