import React, { useState } from 'react';
import {
  Terminal,
  Search,
  Filter,
  ShieldAlert,
  AlertTriangle,
  Info,
  RefreshCw,
  Wifi,
  Cpu,
  Smartphone,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { LogEntry } from '../types';

interface LogViewerProps {
  logs: LogEntry[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onRefresh, isRefreshing }) => {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const matchesTypeFilter = (logType: string, filter: string) => {
    if (filter === 'ALL') return true;
    const upper = logType.toUpperCase();
    if (filter === 'NETWORK') return upper.includes('NET') || upper === 'NETWORK_CONN' || upper === 'NETWORK_LOG';
    if (filter === 'PROCESS') return upper.includes('PROC');
    if (filter === 'CRASH') return upper.includes('CRASH');
    if (filter === 'SYSTEM') return upper.includes('SYS') || upper === 'SYS_LOG';
    if (filter === 'SECURITY') return upper.includes('SEC') || upper === 'SECURITY_ALERT';
    if (filter === 'APPLICATION') return upper.includes('APP') || upper === 'APP_EVENT';
    return upper === filter;
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.message.toLowerCase().includes(search.toLowerCase()) ||
      log.eventType.toLowerCase().includes(search.toLowerCase()) ||
      log.deviceId.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(log.payload || {}).toLowerCase().includes(search.toLowerCase());

    const matchesSeverity = severityFilter === 'ALL' || log.severity === severityFilter;
    const matchesType = matchesTypeFilter(log.eventType, typeFilter);

    return matchesSearch && matchesSeverity && matchesType;
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            CRITICAL
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            WARNING
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/80 text-blue-300 border border-blue-800">
            <Info className="w-3 h-3 text-blue-400" />
            INFO
          </span>
        );
    }
  };

  const getEventTypeBadge = (eventType: string) => {
    const upper = eventType.toUpperCase();
    if (upper.includes('NET')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-cyan-950/60 text-cyan-300 border border-cyan-800/80">
          <Wifi className="w-3 h-3 text-cyan-400" />
          NETWORK
        </span>
      );
    }
    if (upper.includes('PROC')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-950/60 text-amber-300 border border-amber-800/80">
          <Cpu className="w-3 h-3 text-amber-400" />
          PROCESS
        </span>
      );
    }
    if (upper.includes('CRASH')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-red-950/60 text-red-300 border border-red-800/80">
          <AlertTriangle className="w-3 h-3 text-red-400" />
          CRASH
        </span>
      );
    }
    if (upper.includes('SEC')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-950/60 text-rose-300 border border-rose-800/80">
          <ShieldAlert className="w-3 h-3 text-rose-400" />
          SECURITY
        </span>
      );
    }
    if (upper.includes('APP')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-purple-950/60 text-purple-300 border border-purple-800/80">
          <Smartphone className="w-3 h-3 text-purple-400" />
          APPLICATION
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700">
        <Cpu className="w-3 h-3 text-slate-400" />
        SYSTEM
      </span>
    );
  };

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            Full Endpoint Telemetry &amp; System Log Stream
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Audit feed: Network connections, logcat events, system metrics, and security alerts
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search all logs & payloads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 w-52"
            />
          </div>

          {/* Severity Filter */}
          <div className="flex items-center space-x-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
            <Filter className="w-3 h-3 text-slate-500 ml-2 mr-1" />
            {['ALL', 'CRITICAL', 'WARNING', 'INFO'].map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                  severityFilter === sev
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50"
            title="Refresh logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Export to Wazuh / SIEM JSON */}
          <a
            href="/api/logs/wazuh"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-800/80 text-xs font-semibold transition"
            title="Export in Wazuh / ECS JSON schema"
          >
            <span>Wazuh / SIEM Export</span>
          </a>
        </div>
      </div>

      {/* Log Type Filter Pills */}
      <div className="flex items-center flex-wrap gap-1.5">
        {[
          { key: 'ALL', label: 'All Raw Events', count: logs.length },
          { key: 'PROCESS', label: 'Processes (4688/4689)', count: logs.filter((l) => matchesTypeFilter(l.eventType, 'PROCESS')).length },
          { key: 'NETWORK', label: 'Network Sockets (Sysmon 3)', count: logs.filter((l) => matchesTypeFilter(l.eventType, 'NETWORK')).length },
          { key: 'CRASH', label: 'Crashes & ANRs (1000)', count: logs.filter((l) => matchesTypeFilter(l.eventType, 'CRASH')).length },
          { key: 'SECURITY', label: 'Security & ADB', count: logs.filter((l) => matchesTypeFilter(l.eventType, 'SECURITY')).length },
          { key: 'SYSTEM', label: 'System Framework', count: logs.filter((l) => matchesTypeFilter(l.eventType, 'SYSTEM')).length },
          { key: 'APPLICATION', label: 'App Logs', count: logs.filter((l) => matchesTypeFilter(l.eventType, 'APPLICATION')).length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTypeFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center space-x-1.5 ${
              typeFilter === tab.key
                ? 'bg-slate-800 text-cyan-400 border border-cyan-500/40 shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <span>{tab.label}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 font-mono text-slate-300">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Logs Table */}
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/90 text-slate-400 sticky top-0 border-b border-slate-800 z-10 font-sans">
            <tr>
              <th className="py-2.5 px-3 font-semibold w-36">Time</th>
              <th className="py-2.5 px-3 font-semibold w-24">Severity</th>
              <th className="py-2.5 px-3 font-semibold w-28">Type</th>
              <th className="py-2.5 px-3 font-semibold">Message / Raw Event</th>
              <th className="py-2.5 px-3 font-semibold text-right w-20">Payload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-500 font-sans">
                  No telemetry logs found matching filter criteria.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                const formattedTime = new Date(log.eventTimestamp).toLocaleTimeString();
                const formattedDate = new Date(log.eventTimestamp).toLocaleDateString();

                return (
                  <React.Fragment key={log.id}>
                    <tr
                      className="hover:bg-slate-800/40 transition cursor-pointer"
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    >
                      <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                        <span className="text-slate-200">{formattedTime}</span>{' '}
                        <span className="text-[10px] text-slate-500 block">{formattedDate}</span>
                      </td>

                      <td className="py-2 px-3 whitespace-nowrap">
                        {getSeverityBadge(log.severity)}
                      </td>

                      <td className="py-2 px-3 whitespace-nowrap">
                        {getEventTypeBadge(log.eventType)}
                      </td>

                      <td className="py-2 px-3 text-slate-200 max-w-xl truncate">
                        {log.message}
                      </td>

                      <td className="py-2 px-3 text-right whitespace-nowrap font-sans">
                        <button
                          className="text-[11px] text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedLogId(isExpanded ? null : log.id);
                          }}
                        >
                          {isExpanded ? (
                            <>
                              <span>Close</span>
                              <ChevronDown className="w-3 h-3" />
                            </>
                          ) : (
                            <>
                              <span>Inspect</span>
                              <ChevronRight className="w-3 h-3" />
                            </>
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expandable JSON Payload Viewer */}
                    {isExpanded && (
                      <tr className="bg-slate-900/90 font-sans">
                        <td colSpan={5} className="p-3 text-[11px]">
                          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-slate-300 font-mono overflow-x-auto shadow-inner">
                            <div className="flex items-center justify-between text-slate-500 mb-1.5 pb-1 border-b border-slate-900 text-[10px]">
                              <span>Device ID: {log.deviceId}</span>
                              <span>Ingested At Server: {new Date(log.createdAt).toISOString()}</span>
                            </div>
                            <pre className="text-emerald-400 text-[11px]">
                              {JSON.stringify(log.payload || {}, null, 2)}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
