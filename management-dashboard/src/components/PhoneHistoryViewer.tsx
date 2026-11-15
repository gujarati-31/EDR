import React, { useEffect, useState, useCallback } from 'react';
import {
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneOff,
  Clock,
  Search,
  RefreshCw,
  Copy,
  Check,
  Volume2,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { CallLogEntry, CallLogStats, CallType } from '../types';
import { api } from '../services/api';

interface PhoneHistoryViewerProps {
  deviceId: string;
  isOnline?: boolean;
}

export const PhoneHistoryViewer: React.FC<PhoneHistoryViewerProps> = ({
  deviceId,
  isOnline = false,
}) => {
  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([]);
  const [stats, setStats] = useState<CallLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [recFilter, setRecFilter] = useState<string>('ALL'); // 'ALL' | 'RECORDED' | 'NOT_RECORDED'
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadCallLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api.getCallLogs(deviceId, {
          type: typeFilter !== 'ALL' ? typeFilter : undefined,
          date: dateFilter !== 'ALL' ? dateFilter : undefined,
          search: searchQuery.trim() || undefined,
        });

        if (res.success) {
          setCallLogs(res.data || []);
          if (res.stats) {
            setStats(res.stats);
          }
        }
      } catch (err) {
        console.error('Failed to load phone history:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [deviceId, typeFilter, dateFilter, searchQuery]
  );

  useEffect(() => {
    loadCallLogs();
  }, [loadCallLogs]);

  // Handle on-demand live harvest request
  const handleTriggerSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await api.triggerCallLogSync(deviceId);
      setSyncMessage(res.message);
      // Poll for update after 2s
      setTimeout(() => {
        loadCallLogs(true);
      }, 2500);
    } catch (err: any) {
      setSyncMessage(err?.message || 'Failed to dispatch sync command');
    } finally {
      setTimeout(() => setSyncing(false), 2000);
      setTimeout(() => setSyncMessage(null), 6000);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const formatTimestamp = (epochMs: number) => {
    if (!epochMs) return 'Unknown Date';
    const d = new Date(epochMs);
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (isToday) {
      return `Today, ${timeStr}`;
    }
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    return `${dateStr} • ${timeStr}`;
  };

  const renderTypeIcon = (type: CallType) => {
    switch (type) {
      case 'INCOMING':
        return <PhoneIncoming className="w-4 h-4 text-emerald-400" />;
      case 'OUTGOING':
        return <PhoneOutgoing className="w-4 h-4 text-cyan-400" />;
      case 'MISSED':
        return <PhoneMissed className="w-4 h-4 text-rose-400" />;
      case 'REJECTED':
      case 'BLOCKED':
        return <PhoneOff className="w-4 h-4 text-amber-400" />;
      default:
        return <PhoneCall className="w-4 h-4 text-slate-400" />;
    }
  };

  const getTypeBadgeClass = (type: CallType) => {
    switch (type) {
      case 'INCOMING':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'OUTGOING':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'MISSED':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'REJECTED':
      case 'BLOCKED':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <PhoneCall className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-mono font-bold tracking-wider text-white uppercase flex items-center gap-2">
                Phone History &amp; Call Duration Telemetry
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Incoming, outgoing &amp; missed calls with exact talk time durations
              </p>
            </div>
          </div>
        </div>

        {/* Live Sync Action */}
        <div className="flex items-center gap-3">
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5 ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {isOnline ? 'Live Link' : 'Offline'}
          </span>

          {syncMessage && (
            <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2.5 py-1 rounded-lg">
              {syncMessage}
            </span>
          )}

          <button
            onClick={handleTriggerSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition border bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border-cyan-400/40 shadow-sm disabled:opacity-50"
            title="Dispatches live command to phone to harvest CallLog.Calls"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Harvesting Logs...' : 'Sync Call Logs'}</span>
          </button>
        </div>
      </div>

      {/* Metric Cards: Talk Time & Call Volume Summary */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. Total Calls */}
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>Total Calls</span>
              <PhoneCall className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-white">{stats.totalCalls}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                Avg: {stats.formattedAvgDuration}
              </div>
            </div>
          </div>

          {/* 2. Total Talk Duration */}
          <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3.5 flex flex-col justify-between shadow-sm bg-gradient-to-br from-cyan-950/20 to-transparent">
            <div className="flex items-center justify-between text-cyan-400 text-xs font-mono font-semibold">
              <span>Total Talk Time</span>
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-2">
              <div className="text-xl font-bold font-mono text-cyan-300">
                {stats.formattedTotalDuration}
              </div>
              <div className="text-[10px] text-cyan-400/70 font-mono mt-0.5">
                {Math.round(stats.totalDurationSeconds / 60)} total minutes
              </div>
            </div>
          </div>

          {/* 3. Incoming Calls & Duration */}
          <div className="bg-slate-950/80 border border-emerald-500/30 rounded-xl p-3.5 flex flex-col justify-between shadow-sm bg-gradient-to-br from-emerald-950/20 to-transparent">
            <div className="flex items-center justify-between text-emerald-400 text-xs font-mono font-semibold">
              <span>Incoming Calls</span>
              <PhoneIncoming className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-emerald-300">
                {stats.incomingCount}
              </div>
              <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5">
                Inbound: {stats.formattedInboundDuration}
              </div>
            </div>
          </div>

          {/* 4. Outgoing Calls & Duration */}
          <div className="bg-slate-950/80 border border-blue-500/30 rounded-xl p-3.5 flex flex-col justify-between shadow-sm bg-gradient-to-br from-blue-950/20 to-transparent">
            <div className="flex items-center justify-between text-blue-400 text-xs font-mono font-semibold">
              <span>Outgoing Calls</span>
              <PhoneOutgoing className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-blue-300">
                {stats.outgoingCount}
              </div>
              <div className="text-[10px] text-blue-400/80 font-mono mt-0.5">
                Outbound: {stats.formattedOutboundDuration}
              </div>
            </div>
          </div>

          {/* 5. Missed & Rejected */}
          <div className="bg-slate-950/80 border border-rose-500/30 rounded-xl p-3.5 flex flex-col justify-between shadow-sm bg-gradient-to-br from-rose-950/20 to-transparent col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-rose-400 text-xs font-mono font-semibold">
              <span>Missed / Rejected</span>
              <PhoneMissed className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold font-mono text-rose-300">
                {stats.missedCount + stats.rejectedCount}
              </div>
              <div className="text-[10px] text-rose-400/80 font-mono mt-0.5">
                {stats.missedCount} missed • {stats.rejectedCount} rejected
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-2.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Call Type Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {[
              { id: 'ALL', label: 'All Calls' },
              { id: 'INCOMING', label: 'Incoming' },
              { id: 'OUTGOING', label: 'Outgoing' },
              { id: 'MISSED', label: 'Missed' },
              { id: 'REJECTED', label: 'Rejected' },
            ].map((pill) => (
              <button
                key={pill.id}
                onClick={() => setTypeFilter(pill.id)}
                className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition whitespace-nowrap ${
                  typeFilter === pill.id
                    ? 'bg-blue-600 text-white border-blue-500 font-semibold shadow-sm'
                    : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Date Filter & Search Input */}
          <div className="flex items-center gap-2">
            {/* Date Selector */}
            {stats?.availableDates && stats.availableDates.length > 0 && (
              <div className="relative">
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-300 font-mono text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="ALL">All Dates</option>
                  {stats.availableDates.map((d) => (
                    <option key={d} value={d}>
                      {d === new Date().toISOString().split('T')[0] ? `Today (${d})` : d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Search Box */}
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name or number..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* Recording Availability Filter Pills */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/60 overflow-x-auto">
          <span className="text-[11px] font-mono text-slate-500 mr-1 flex items-center gap-1">
            <Volume2 className="w-3 h-3 text-slate-400" />
            Recording Status:
          </span>
          {[
            { id: 'ALL', label: 'All Audios' },
            { id: 'RECORDED', label: '🔊 Recorded Only' },
            { id: 'NOT_RECORDED', label: '⚠️ No Recording' },
          ].map((pill) => (
            <button
              key={pill.id}
              onClick={() => setRecFilter(pill.id)}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition whitespace-nowrap ${
                recFilter === pill.id
                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-semibold'
                  : 'bg-slate-900/60 text-slate-400 border-slate-800/80 hover:text-white hover:bg-slate-800'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Call Log Feed / Table */}
      <div>
        {loading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
            <span>Loading phone call duration records...</span>
          </div>
        ) : callLogs.length === 0 ? (
          <div className="py-16 text-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6">
            <PhoneCall className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-mono text-slate-300 font-semibold">
              No call history records found.
            </p>
            <p className="text-[11px] font-mono text-slate-500 mt-1 max-w-md mx-auto">
              Click &quot;Sync Call Logs&quot; above to request phone call history from the Android agent,
              or ensure the Phone Call History permission is granted in Device Policies.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[550px] overflow-y-auto pr-1">
            {callLogs
              .filter((call) => {
                if (recFilter === 'RECORDED') return !!call.hasRecording || !!call.recordingUrl;
                if (recFilter === 'NOT_RECORDED') return !call.hasRecording && !call.recordingUrl;
                return true;
              })
              .map((call) => {
                const isAnswered = call.durationSeconds > 0;
                const hasAudio = !!call.hasRecording || !!call.recordingUrl;
                return (
                  <div
                    key={call.id || `${call.callId}-${call.timestamp}`}
                    className="bg-slate-950/80 border border-slate-800/80 hover:border-slate-700/80 rounded-xl p-3.5 transition flex flex-col gap-3 shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Left: Contact Info & Call Type */}
                      <div className="flex items-center space-x-3.5">
                        {/* Call Type Icon Circle */}
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-inner shrink-0 ${getTypeBadgeClass(
                            call.callType
                          )}`}
                        >
                          {renderTypeIcon(call.callType)}
                        </div>

                        <div>
                          {/* Caller Name & Type Badge */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-white flex items-center gap-1.5">
                              {call.callerName || call.phoneNumber}
                            </span>

                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider ${getTypeBadgeClass(
                                call.callType
                              )}`}
                            >
                              {call.callType}
                            </span>

                            {call.simSlot && (
                              <span className="text-[9px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded">
                                {call.simSlot}
                              </span>
                            )}
                          </div>

                          {/* Phone Number & Copy */}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-mono text-slate-400">
                              {call.phoneNumber}
                            </span>
                            <button
                              onClick={() => copyToClipboard(call.phoneNumber, call.id)}
                              className="text-slate-500 hover:text-cyan-400 transition"
                              title="Copy phone number"
                            >
                              {copiedId === call.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Right: Date, Time & Call Duration */}
                      <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800/60">
                        <div className="text-left sm:text-right">
                          <div className="text-[11px] font-mono text-slate-400">
                            {formatTimestamp(call.timestamp)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {call.callDate}
                          </div>
                        </div>

                        {/* Prominent Duration Badge */}
                        <div
                          className={`px-3 py-1.5 rounded-xl border font-mono text-xs font-bold flex items-center gap-1.5 shrink-0 ${
                            isAnswered
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40 shadow-sm'
                              : call.callType === 'MISSED'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>{call.formattedDuration}</span>
                        </div>
                      </div>
                    </div>

                    {/* Dedicated Call Recording Section */}
                    <div className="pt-2 border-t border-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      {hasAudio && call.recordingUrl ? (
                        <div className="flex items-center gap-2 flex-wrap bg-slate-900/90 border border-emerald-500/30 rounded-lg p-1.5 px-2.5">
                          <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="text-[10px] font-mono text-emerald-300 font-bold uppercase tracking-wider shrink-0">
                            Recording
                          </span>
                          <audio
                            controls
                            src={call.recordingUrl}
                            className="h-6 w-44 sm:w-56 accent-emerald-400 rounded"
                            preload="none"
                          />
                          <a
                            href={call.recordingUrl}
                            download={`call_${call.phoneNumber.replace(/[^0-9+]/g, '')}_${call.timestamp}.m4a`}
                            className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition flex items-center gap-1 text-[10px] font-mono"
                            title="Download call audio (.m4a)"
                          >
                            <Download className="w-3 h-3" />
                            <span>Save</span>
                          </a>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs font-mono bg-slate-900/40 border border-slate-800/60 rounded-lg px-2.5 py-1.5 text-slate-400">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/90 shrink-0" />
                          <span className="text-amber-300 font-medium">Recording not exist</span>
                          <span className="text-slate-500 text-[11px]">
                            ({call.recordingReason || (call.durationSeconds === 0 ? "Missed/unanswered call" : "Recording not captured")})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};
