import React, { useEffect, useMemo, useState } from 'react';
import {
  Film,
  Play,
  Download,
  Trash2,
  RefreshCw,
  Clock,
  Calendar,
  X,
} from 'lucide-react';
import { RecordedVideo } from '../types';
import { api } from '../services/api';

interface RecordingsViewerProps {
  deviceId: string;
  recordingsLastUpdated?: number;
}

function toLocalDateKey(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeStr(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '00:00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatRecordingDisplayName(rec: RecordedVideo): string {
  const rawTs = rec.createdAt || rec.timestamp;
  const dateStr = toLocalDateKey(rawTs) || 'Unknown-Date';
  const timeStr = toLocalTimeStr(rawTs);

  let appLabel = rec.appName?.trim();
  if (!appLabel && rec.filename.startsWith('trap_')) {
    const clean = rec.filename.replace(/^trap_/, '').replace(/\.mp4$/i, '');
    if (clean.includes(' - ')) {
      appLabel = clean.split(' - ')[0].replace(/_/g, ' ').trim();
    } else if (clean.includes('__')) {
      appLabel = clean.split('__')[0].replace(/_/g, ' ').trim();
    }
  }
  return `${appLabel || 'App'} - ${dateStr} - ${timeStr}`;
}

function formatDateBadge(dateKey: string): string {
  const today = toLocalDateKey(new Date().toISOString());
  const yestDate = new Date();
  yestDate.setDate(yestDate.getDate() - 1);
  const yesterday = toLocalDateKey(yestDate.toISOString());
  if (dateKey === today) return `Today (${dateKey})`;
  if (dateKey === yesterday) return `Yesterday (${dateKey})`;
  return dateKey;
}

export const RecordingsViewer: React.FC<RecordingsViewerProps> = ({ deviceId, recordingsLastUpdated }) => {
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeVideo, setActiveVideo] = useState<RecordedVideo | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => toLocalDateKey(new Date().toISOString()));

  const loadRecordings = async () => {
    setLoading(true);
    try {
      const data = await api.getRecordings(deviceId);
      // Filter specifically for app trap background recordings (triggered when trapped apps open)
      const trapOnly = data.filter(
        (r) => r.recordingType === 'APP_TRAP' || r.filename.startsWith('trap_') || r.filename.includes('trap')
      );
      setRecordings(trapOnly);
      if (trapOnly.length > 0) {
        const dates = Array.from(
          new Set(trapOnly.map((r) => toLocalDateKey(r.createdAt || r.timestamp)).filter(Boolean))
        ).sort((a, b) => b.localeCompare(a));
        setSelectedDate((prev) => (prev === 'ALL' || dates.includes(prev) ? prev : dates[0]));
      }
    } catch (err) {
      console.error('Failed to load recordings:', err);
    } finally {
      setLoading(false);
    }
  };

  const dayCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recordings) {
      const key = toLocalDateKey(r.createdAt || r.timestamp);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [recordings]);

  const filteredRecordings = useMemo(() => {
    if (selectedDate === 'ALL' || !selectedDate) return recordings;
    return recordings.filter((r) => toLocalDateKey(r.createdAt || r.timestamp) === selectedDate);
  }, [recordings, selectedDate]);

  useEffect(() => {
    if (deviceId) {
      loadRecordings();
    }
  }, [deviceId, recordingsLastUpdated]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Permanently delete this screen recording evidence from server?')) return;
    try {
      await api.deleteRecording(deviceId, id);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      if (activeVideo?.id === id) setActiveVideo(null);
    } catch (err: any) {
      alert(`Failed to delete recording: ${err.message}`);
    }
  };

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            App Screen Recordings &amp; Attacker Activity Evidence
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Auto-recorded screen videos triggered by trapped applications with attacker actions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200">
            <Calendar className="w-3.5 h-3.5 text-purple-400" />
            <input
              type="date"
              value={selectedDate === 'ALL' ? '' : selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || 'ALL')}
              className="bg-transparent text-xs text-slate-200 focus:outline-none [color-scheme:dark]"
              title="Select Date"
            />
          </div>
          <button
            onClick={() => setSelectedDate('ALL')}
            className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${
              selectedDate === 'ALL'
                ? 'bg-purple-600/20 border-purple-500 text-purple-300 font-semibold'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All ({recordings.length})
          </button>
          <button
            onClick={loadRecordings}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Day-wise Quick Date Selector */}
      {dayCounts.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {dayCounts.map(([dateKey, count]) => (
            <button
              key={dateKey}
              onClick={() => setSelectedDate(dateKey)}
              className={`shrink-0 flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs border transition ${
                selectedDate === dateKey
                  ? 'bg-purple-600/25 border-purple-500 text-purple-200 font-semibold'
                  : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <span>{formatDateBadge(dateKey)}</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-purple-300">
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Recordings Grid / List */}
      {loading ? (
        <div className="py-16 text-center text-xs text-slate-500">
          Loading attacker video recordings from server...
        </div>
      ) : filteredRecordings.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <Film className="w-6 h-6 text-purple-400/60" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">
              {recordings.length === 0
                ? 'No App Screen Recordings Yet'
                : `No Recordings on ${selectedDate === 'ALL' ? 'Selected Filter' : selectedDate}`}
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {recordings.length === 0
                ? 'Configure a trap on any app in the Apps Inventory tab. When an attacker opens that app, a full screen video will automatically record and upload here.'
                : 'Select another date above or click "All" to view recordings from other days.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecordings.map((rec) => {
            const displayName = formatRecordingDisplayName(rec);
            return (
            <div
              key={rec.id}
              onClick={() => setActiveVideo(rec)}
              className="bg-slate-950/80 border border-slate-800 hover:border-purple-600/60 rounded-xl p-4 cursor-pointer transition group flex flex-col justify-between space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-950/80 border border-purple-800/80 flex items-center justify-center text-purple-300 group-hover:scale-105 transition">
                    <Play className="w-5 h-5 fill-purple-400" />
                  </div>
                  <div>
                    <h4
                      className="text-xs font-semibold text-white truncate max-w-[200px] group-hover:text-purple-300 transition"
                      title={displayName}
                    >
                      {displayName}
                    </h4>
                    <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                      <span className="font-mono text-purple-300 font-semibold">{rec.duration || '00:05'}</span>
                      <span>•</span>
                      <span>{rec.sizeBytes ? `${Math.round(rec.sizeBytes / 1024)} KB` : 'Video'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timestamp & Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px] text-slate-400">
                <div className="flex items-center space-x-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>{new Date(rec.createdAt || rec.timestamp).toLocaleString()}</span>
                </div>

                <div className="flex items-center space-x-1">
                  <a
                    href={rec.url}
                    download={`${displayName.replace(/:/g, '-')}.mp4`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                    title="Download Video File"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={(e) => handleDelete(e, rec.id)}
                    className="p-1.5 rounded hover:bg-rose-950 text-slate-400 hover:text-rose-400 transition"
                    title="Delete Video Recording"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Video Modal Player */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4 p-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Film className="w-4 h-4 text-purple-400" />
                <h4 className="text-sm font-semibold text-white truncate max-w-xs">
                  {formatRecordingDisplayName(activeVideo)}
                </h4>
              </div>
              <button
                onClick={() => setActiveVideo(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Player */}
            <div className="rounded-xl overflow-hidden bg-black aspect-[9/16] max-h-[500px] mx-auto flex items-center justify-center border border-slate-800">
              <video
                src={activeVideo.url}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="w-full h-full object-contain"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-400">
                Duration: <strong className="text-slate-200">{activeVideo.duration || '00:05'}</strong>
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href={activeVideo.url}
                  download={`${formatRecordingDisplayName(activeVideo).replace(/:/g, '-')}.mp4`}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download File</span>
                </a>
                <button
                  onClick={() => setActiveVideo(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
