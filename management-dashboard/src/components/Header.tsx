import React from 'react';
import { Shield, ShieldAlert, WifiOff, UploadCloud, PanelLeft, Users, Smartphone, Database } from 'lucide-react';

interface HeaderProps {
  wsConnected: boolean;
  onlineCount: number;
  totalCount: number;
  criticalCount: number;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  selectedDeviceName?: string;
  onOpenOtaModal?: () => void;
  mainView?: 'devices' | 'vault';
  onToggleMainView?: (view: 'devices' | 'vault') => void;
}

export const Header: React.FC<HeaderProps> = ({
  wsConnected,
  onlineCount,
  totalCount,
  criticalCount,
  isSidebarOpen,
  onToggleSidebar,
  selectedDeviceName,
  onOpenOtaModal,
  mainView = 'devices',
  onToggleMainView,
}) => {
  return (
    <header className="bg-slate-950/95 backdrop-blur-md border-b border-cyan-900/30 px-3 sm:px-6 py-2.5 sm:py-3.5 sticky top-0 z-40 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-4">
        {/* Top Row on Mobile: Client Sidebar Toggle + Brand Title */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2.5 sm:space-x-3.5 min-w-0">
            {/* Sidebar Toggle Button to Show/Switch Clients */}
            <button
              type="button"
              onClick={onToggleSidebar}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border text-xs font-mono font-bold transition-all active:scale-95 flex-shrink-0 ${
                isSidebarOpen
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                  : 'bg-slate-900 hover:bg-slate-800 border-cyan-500/40 text-cyan-300'
              }`}
              title="Show all enrolled phones / switch client"
            >
              {isSidebarOpen ? (
                <PanelLeft className="w-4 h-4 text-cyan-300" />
              ) : (
                <Users className="w-4 h-4 text-cyan-400" />
              )}
              <span className="hidden xs:inline sm:inline">CLIENTS</span>
              <span className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 text-[10px]">
                {onlineCount}/{totalCount}
              </span>
            </button>

            <div className="relative p-2 sm:p-2.5 bg-gradient-to-br from-cyan-950 to-slate-900 text-cyan-400 rounded-xl border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.25)] hidden sm:flex flex-shrink-0">
              <Shield className="w-5 h-5 text-cyan-400" />
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-sm sm:text-lg font-extrabold tracking-wider text-white uppercase font-mono truncate">
                  CYBER-EDR <span className="text-cyan-400 font-normal">CONSOLE</span>
                </h1>
                <span className="text-[9px] sm:text-[10px] font-mono tracking-widest px-1.5 sm:px-2 py-0.5 bg-cyan-950/80 text-cyan-300 rounded border border-cyan-500/30 flex-shrink-0">
                  v3.4
                </span>
              </div>
              <p className="hidden sm:flex text-[11px] text-slate-400 items-center gap-1.5 mt-0.5 truncate">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                {selectedDeviceName ? (
                  <span>
                    Active Client: <strong className="text-cyan-300">{selectedDeviceName}</strong>
                  </span>
                ) : (
                  <span>Real-time Mobile Endpoint Threat Detection &amp; Active Control</span>
                )}
              </p>
            </div>
          </div>

          {/* Mobile quick gateway dot */}
          <div className="flex md:hidden items-center gap-1.5 flex-shrink-0">
            {selectedDeviceName && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono text-cyan-300 max-w-[110px] truncate">
                <Smartphone className="w-3 h-3 flex-shrink-0 text-cyan-400" />
                <span className="truncate">{selectedDeviceName}</span>
              </span>
            )}
          </div>
        </div>

        {/* Main View Switcher: Device Control vs Render Vault */}
        {onToggleMainView && (
          <div className="inline-flex p-1 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-semibold shadow-inner self-start md:self-auto">
            <button
              type="button"
              onClick={() => onToggleMainView('devices')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                mainView === 'devices'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
              <span>Device Live Control</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleMainView('vault')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                mainView === 'vault'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-purple-400" />
              <span>Render Data Vault</span>
            </button>
          </div>
        )}

        {/* Status Indicators */}
        <div className="flex items-center flex-wrap gap-1.5 sm:gap-2.5">
          {/* WebSocket Gateway Status */}
          <div className={`flex items-center space-x-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg border text-[11px] sm:text-xs font-mono transition-all ${
            wsConnected
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.15)]'
          }`}>
            {wsConnected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>GATEWAY LIVE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                <span>OFFLINE</span>
              </>
            )}
          </div>

          {/* Critical Alerts */}
          <div className={`flex items-center space-x-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg border text-[11px] sm:text-xs font-mono transition-all ${
            criticalCount > 0
              ? 'bg-rose-950/60 border-rose-500/50 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.25)] animate-pulse'
              : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}>
            <ShieldAlert className={`w-3.5 h-3.5 ${criticalCount > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
            <span>{criticalCount} ALERTS</span>
          </div>

          {onOpenOtaModal && (
            <button
              onClick={onOpenOtaModal}
              className="flex items-center space-x-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-200 text-[11px] sm:text-xs font-mono font-bold transition-all active:scale-95 ml-auto md:ml-0"
              title="Upload new EDR APK release and push OTA updates to phones"
            >
              <UploadCloud className="w-3.5 h-3.5 text-cyan-400" />
              <span>OTA / QR</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

