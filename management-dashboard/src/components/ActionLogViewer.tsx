import React, { useState, useEffect, useCallback } from 'react';
import {
  Terminal,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Database,
  Calendar,
  Layers,
  CheckCircle2,
  Copy,
  Check,
  AlertOctagon,
  ChevronLeft,
  ChevronRight,
  Radio,
} from 'lucide-react';
import { EdrActionLog, DataUsageStats, LogGapWarning, LogEntry } from '../types';
import { api } from '../services/api';

interface ActionLogViewerProps {
  deviceId: string;
  deviceName?: string;
  isOnline: boolean;
  legacyLogs?: LogEntry[];
}

export const ActionLogViewer: React.FC<ActionLogViewerProps> = ({
  deviceId,
}) => {
  const [logs, setLogs] = useState<EdrActionLog[]>([]);
  const [dataUsage, setDataUsage] = useState<DataUsageStats | null>(null);
  const [gaps, setGaps] = useState<LogGapWarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [triggerFilter, setTriggerFilter] = useState<string>('ALL');
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Copy helper
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const loadData = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const [logsRes, usageRes, gapsRes] = await Promise.all([
        api.getActionLogs(deviceId, {
          page,
          limit: 50,
          status: statusFilter,
          triggeredBy: triggerFilter,
          search: selectedActionId || search,
        }),
        api.getDataUsage(deviceId),
        api.getLogGaps(deviceId),
      ]);

      if (logsRes?.success) {
        setLogs(logsRes.logs || []);
        setTotalPages(logsRes.totalPages || 1);
        setTotalCount(logsRes.total || 0);
      }
      if (usageRes?.success && usageRes.dataUsage) {
        setDataUsage(usageRes.dataUsage);
      }
      if (gapsRes?.success && gapsRes.gaps) {
        setGaps(gapsRes.gaps);
      }
    } catch (e) {
      console.error('[ActionLogViewer] Load error:', e);
    } finally {
      setLoading(false);
    }
  }, [deviceId, page, statusFilter, triggerFilter, search, selectedActionId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh timer every 8s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData();
    }, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'started':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.25)]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Started
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.25)]">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Success
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-950/90 text-rose-300 border border-rose-500/50 shadow-[0_0_8px_rgba(244,63,94,0.3)]">
            <XCircle className="w-3 h-3 text-rose-400" />
            Failed
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
            <AlertOctagon className="w-3 h-3 text-amber-400" />
            Skipped
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900 text-slate-300 border border-slate-700">
            {status}
          </span>
        );
    }
  };

  const getTriggerBadge = (triggeredBy: string) => {
    switch (triggeredBy) {
      case 'Admin':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800">
            ADMIN
          </span>
        );
      case 'Hourly check':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-800">
            HOURLY
          </span>
        );
      case 'User':
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
            USER
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-900 text-slate-400 border border-slate-800">
            AUTO
          </span>
        );
    }
  };

  const getNetworkBadge = (net: string) => {
    const upper = (net || 'Unknown').toUpperCase();
    if (upper === '5G') {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-800">5G</span>;
    }
    if (upper === 'WIFI') {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">WiFi</span>;
    }
    if (upper === 'HOTSPOT') {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800">Hotspot</span>;
    }
    if (upper === '4G+' || upper.includes('4G+')) {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-800">4G+</span>;
    }
    if (upper === '4G' || upper.includes('4G') || upper.includes('LTE')) {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-800">4G</span>;
    }
    if (upper === '3G') {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/80 text-amber-400 border border-amber-800">3G</span>;
    }
    if (upper === '2G') {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950/70 text-amber-400 border border-amber-900">2G</span>;
    }
    return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-900 text-slate-400 border border-slate-800">Offline</span>;
  };

  return (
    <div className="space-y-4 font-mono">
      {/* View Switcher & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-bold text-white tracking-wide uppercase">
            Universal EDR Action Audit & Data Usage
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800">
            {totalCount} events
          </span>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
              autoRefresh
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
            title="Auto-refresh action logs every 8 seconds"
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'text-cyan-400 animate-pulse' : 'text-slate-500'}`} />
            <span>{autoRefresh ? 'LIVE STREAM' : 'PAUSED'}</span>
          </button>

          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>REFRESH</span>
          </button>
        </div>
      </div>

      {/* DATA USAGE METRICS HERO CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Data Used */}
        <div className="cyber-card rounded-xl p-3.5 border border-cyan-500/30 bg-gradient-to-br from-cyan-950/30 via-slate-900/60 to-slate-950 relative overflow-hidden group">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-bold text-cyan-300 uppercase tracking-wider text-[11px]">Total Data Used</span>
            <Database className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {formatBytes(dataUsage?.totalBytes || 0)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
            <span className="text-cyan-400 flex items-center">
              <ArrowUpRight className="w-3 h-3" /> {formatBytes(dataUsage?.totalUploadedBytes || 0)}
            </span>
            <span className="text-indigo-400 flex items-center">
              <ArrowDownLeft className="w-3 h-3" /> {formatBytes(dataUsage?.totalDownloadedBytes || 0)}
            </span>
          </div>
        </div>

        {/* Today */}
        <div className="cyber-card rounded-xl p-3.5 border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 via-slate-900/60 to-slate-950">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-bold text-emerald-300 uppercase tracking-wider text-[11px]">Today</span>
            <Clock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-emerald-100 tracking-tight">
            {formatBytes(dataUsage?.todayBytes || 0)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Sum of all actions today
          </div>
        </div>

        {/* This Week */}
        <div className="cyber-card rounded-xl p-3.5 border border-purple-500/30 bg-gradient-to-br from-purple-950/30 via-slate-900/60 to-slate-950">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-bold text-purple-300 uppercase tracking-wider text-[11px]">This Week</span>
            <Calendar className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-purple-100 tracking-tight">
            {formatBytes(dataUsage?.thisWeekBytes || 0)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Last 7 days cumulative
          </div>
        </div>

        {/* This Month */}
        <div className="cyber-card rounded-xl p-3.5 border border-amber-500/30 bg-gradient-to-br from-amber-950/30 via-slate-900/60 to-slate-950">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-bold text-amber-300 uppercase tracking-wider text-[11px]">This Month</span>
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-amber-100 tracking-tight">
            {formatBytes(dataUsage?.thisMonthBytes || 0)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Last 30 days cumulative
          </div>
        </div>
      </div>

      {/* GAP WARNING BANNER (Detects periods with no activity) */}
      {gaps.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-200 text-xs space-y-1.5 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
          <div className="flex items-center gap-2 font-bold text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 animate-bounce" />
            <span>ACTIVITY GAP WARNING DETECTED ({gaps.length} missing period{gaps.length > 1 ? 's' : ''})</span>
          </div>
          <div className="space-y-1 pl-6 text-[11px] text-amber-200/90 font-mono">
            {gaps.slice(0, 3).map((g, idx) => (
              <div key={idx} className="flex items-start gap-1.5">
                <span className="text-amber-400 font-bold">•</span>
                <span>{g.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="cyber-card rounded-xl p-3 border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search actions, Action ID, Log ID, or reason..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-8 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch('');
                  setSelectedActionId(null);
                  setPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action ID Filter Pill if active */}
          {selectedActionId && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-500/50 text-xs">
              <span className="text-[10px] text-slate-400">Action:</span>
              <span className="font-bold">{selectedActionId.substring(0, 8)}...</span>
              <button
                onClick={() => {
                  setSelectedActionId(null);
                  setPage(1);
                }}
                className="ml-1 text-cyan-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-[11px] text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-cyan-400" /> Status:
          </span>
          {['ALL', 'Started', 'Success', 'Failed', 'Skipped'].map((st) => (
            <button
              key={st}
              onClick={() => {
                setStatusFilter(st);
                setPage(1);
              }}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                statusFilter === st
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}

          <span className="text-[11px] text-slate-400 ml-2 mr-1">Trigger:</span>
          {['ALL', 'Admin', 'Automatic', 'Hourly check', 'User'].map((tr) => (
            <button
              key={tr}
              onClick={() => {
                setTriggerFilter(tr);
                setPage(1);
              }}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                triggerFilter === tr
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/60 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              {tr}
            </button>
          ))}
        </div>
      </div>

      {/* ACTION LOGS STREAM TABLE */}
      <div className="cyber-card rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/90 border-b border-slate-800 text-[10px] font-mono uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2.5 px-3">Time</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Module / Event</th>
                <th className="py-2.5 px-3">Trigger</th>
                <th className="py-2.5 px-3">Description & Failure Reason</th>
                <th className="py-2.5 px-3">Action ID</th>
                <th className="py-2.5 px-3">Data Used</th>
                <th className="py-2.5 px-3">Network</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-500">
                    {loading ? 'Loading action audit logs...' : 'No action logs found matching current filters.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isHighlighted = selectedActionId === log.actionId;
                  const dataTotal = (log.bytesUploaded || 0) + (log.bytesDownloaded || 0);

                  return (
                    <tr
                      key={log.logId}
                      className={`hover:bg-slate-900/50 transition-colors ${
                        isHighlighted ? 'bg-cyan-950/40 border-l-2 border-cyan-400' : ''
                      }`}
                    >
                      {/* Timestamp */}
                      <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-[10px]">
                        <div>{new Date(log.timestamp).toLocaleTimeString()}</div>
                        <div className="text-[9px] text-slate-500">{new Date(log.timestamp).toLocaleDateString()}</div>
                      </td>

                      {/* Status */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        {getStatusBadge(log.status)}
                      </td>

                      {/* Module / Event Type */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="text-white font-bold">{log.module}</div>
                        <div className="text-[9px] text-slate-400">{log.eventType}</div>
                      </td>

                      {/* Triggered By */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        {getTriggerBadge(log.triggeredBy)}
                      </td>

                      {/* Description & Failure Reason */}
                      <td className="py-2 px-3 min-w-[240px]">
                        <div className="text-slate-200">{log.description}</div>
                        {log.failureReason && (
                          <div className="text-[10px] text-amber-300/90 mt-0.5 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40 inline-block">
                            Reason: {log.failureReason}
                          </div>
                        )}
                      </td>

                      {/* Action ID (Click to filter pair) */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        <button
                          onClick={() => {
                            if (selectedActionId === log.actionId) {
                              setSelectedActionId(null);
                            } else {
                              setSelectedActionId(log.actionId);
                            }
                            setPage(1);
                          }}
                          className={`group flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all ${
                            isHighlighted
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-cyan-300 hover:border-slate-700'
                          }`}
                          title="Click to isolate both Started and End logs for this Action ID"
                        >
                          <span>{log.actionId.substring(0, 8)}</span>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(log.actionId);
                            }}
                            className="hover:text-white"
                            title="Copy Action ID"
                          >
                            {copiedId === log.actionId ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-slate-500" />}
                          </span>
                        </button>
                      </td>

                      {/* Data Used */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        {dataTotal > 0 ? (
                          <div className="text-cyan-300 font-bold">
                            {formatBytes(dataTotal)}
                            <div className="text-[9px] text-slate-500 font-normal">
                              ↑ {formatBytes(log.bytesUploaded || 0)} / ↓ {formatBytes(log.bytesDownloaded || 0)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      {/* Network */}
                      <td className="py-2 px-3 whitespace-nowrap">
                        {getNetworkBadge(log.networkType)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-slate-900/90 border-t border-slate-800 text-xs">
          <div className="text-slate-400 text-[11px]">
            Showing page {page} of {totalPages} ({totalCount} total entries)
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 py-0.5 text-[11px] font-bold text-white bg-slate-800 border border-slate-700 rounded">
              {page}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
