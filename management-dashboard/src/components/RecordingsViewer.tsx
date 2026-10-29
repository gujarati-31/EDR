import React, { useEffect, useState } from 'react';
import {
  Film,
  Play,
  Download,
  Trash2,
  RefreshCw,
  Clock,
  X,
} from 'lucide-react';
import { RecordedVideo } from '../types';
import { api } from '../services/api';

interface RecordingsViewerProps {
  deviceId: string;
}

export const RecordingsViewer: React.FC<RecordingsViewerProps> = ({ deviceId }) => {
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeVideo, setActiveVideo] = useState<RecordedVideo | null>(null);

  const loadRecordings = async () => {
    setLoading(true);
    try {
      const data = await api.getRecordings(deviceId);
      // Filter specifically for app trap background recordings (triggered when trapped apps open)
      const trapOnly = data.filter(
        (r) => r.recordingType === 'APP_TRAP' || r.filename.startsWith('trap_') || r.filename.includes('trap')
      );
      setRecordings(trapOnly);
    } catch (err) {
      console.error('Failed to load recordings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      loadRecordings();
    }
  }, [deviceId]);

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

        <div className="flex items-center space-x-2">
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

      {/* Recordings Grid / List */}
      {loading ? (
        <div className="py-16 text-center text-xs text-slate-500">
          Loading attacker video recordings from server...
        </div>
      ) : recordings.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <Film className="w-6 h-6 text-purple-400/60" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">No App Screen Recordings Yet</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Configure a trap on any app in the <strong>Apps Inventory</strong> tab. When an attacker opens that app, a full screen video will automatically record and upload here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recordings.map((rec) => (
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
                    <h4 className="text-xs font-semibold text-white truncate max-w-[180px] group-hover:text-purple-300 transition">
                      {rec.filename}
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
                    download={rec.filename}
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
          ))}
        </div>
      )}

      {/* Video Modal Player */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4 p-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Film className="w-4 h-4 text-purple-400" />
                <h4 className="text-sm font-semibold text-white truncate max-w-xs">{activeVideo.filename}</h4>
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
                  download={activeVideo.filename}
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
