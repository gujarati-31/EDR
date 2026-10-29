import React from 'react';
import { Shield, ShieldAlert, WifiOff } from 'lucide-react';

interface HeaderProps {
  wsConnected: boolean;
  onlineCount: number;
  totalCount: number;
  criticalCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  wsConnected,
  onlineCount,
  totalCount,
  criticalCount,
}) => {
  return (
    <header className="bg-slate-950/90 backdrop-blur-md border-b border-cyan-900/30 px-6 py-3.5 sticky top-0 z-50 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Brand / Title */}
        <div className="flex items-center space-x-3.5">
          <div className="relative p-2.5 bg-gradient-to-br from-cyan-950 to-slate-900 text-cyan-400 rounded-xl border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
            <Shield className="w-5 h-5 text-cyan-400" />
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold tracking-wider text-white uppercase font-mono flex items-center gap-2">
                CYBER-EDR <span className="text-cyan-400 font-normal">CONSOLE</span>
              </h1>
              <span className="text-[10px] font-mono tracking-widest px-2 py-0.5 bg-cyan-950/80 text-cyan-300 rounded border border-cyan-500/30">
                MDM v2.4
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              Real-time Mobile Endpoint Threat Detection &amp; Active Control
            </p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* WebSocket Gateway Status */}
          <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${
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

          {/* Active Endpoints Counter */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono">
            <span className="text-slate-400 text-[11px]">ENDPOINTS:</span>
            <span className="text-cyan-400 font-bold">{onlineCount}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300">{totalCount}</span>
          </div>

          {/* Critical Alerts */}
          <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${
            criticalCount > 0
              ? 'bg-rose-950/60 border-rose-500/50 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.25)] animate-pulse'
              : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}>
            <ShieldAlert className={`w-3.5 h-3.5 ${criticalCount > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
            <span>{criticalCount} ALERTS</span>
          </div>
        </div>
      </div>
    </header>
  );
};

