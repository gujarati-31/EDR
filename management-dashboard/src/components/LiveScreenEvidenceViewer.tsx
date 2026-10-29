import React, { useEffect, useState } from 'react';
import {
  Film,
  Camera,
  Play,
  Download,
  Trash2,
  RefreshCw,
  Clock,
  X,
  Eye,
  HardDrive,
  CheckCircle2,
} from 'lucide-react';
import { IntruderPhoto, RecordedVideo } from '../types';
import { api } from '../services/api';

interface LiveScreenEvidenceViewerProps {
  deviceId: string;
}

export const LiveScreenEvidenceViewer: React.FC<LiveScreenEvidenceViewerProps> = ({ deviceId }) => {
  const [snapshots, setSnapshots] = useState<IntruderPhoto[]>([]);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PHOTOS' | 'VIDEOS'>('ALL');
  
  // Modals
  const [activePhoto, setActivePhoto] = useState<IntruderPhoto | null>(null);
  const [activeVideo, setActiveVideo] = useState<RecordedVideo | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadEvidence = async () => {
    setLoading(true);
    try {
      const [photosData, recordingsData] = await Promise.all([
        api.getIntruderPhotos(deviceId),
        api.getRecordings(deviceId),
      ]);

      // Filter photos that are from Live Screen "Save Proof"
      const screenSnapshots = photosData.filter(
        (p) =>
          p.photoType === 'LIVE_SCREEN_PROOF' ||
          p.triggerReason?.toLowerCase().includes('proof') ||
          p.triggerReason?.toLowerCase().includes('live screen')
      );
      setSnapshots(screenSnapshots);

      // Filter recordings that are from Live Screen sessions (not app traps)
      const screenRecordings = recordingsData.filter(
        (r) =>
          r.recordingType === 'LIVE_SCREEN' ||
          (!r.filename.startsWith('trap_') && !r.filename.includes('trap'))
      );
      setRecordings(screenRecordings);
    } catch (err: any) {
      console.error('Failed to load live screen evidence:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      loadEvidence();
    }
  }, [deviceId]);

  const handleDeletePhoto = async (e: React.MouseEvent, photoId: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this live screen snapshot proof from server?')) return;
    try {
      await api.deleteIntruderPhoto(deviceId, photoId);
      setSnapshots((prev) => prev.filter((p) => p.id !== photoId));
      if (activePhoto?.id === photoId) setActivePhoto(null);
      setStatusMsg('Snapshot deleted successfully.');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      alert(`Failed to delete snapshot: ${err.message}`);
    }
  };

  const handleDeleteVideo = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Permanently delete this live screen video recording from server?')) return;
    try {
      await api.deleteRecording(deviceId, id);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      if (activeVideo?.id === id) setActiveVideo(null);
      setStatusMsg('Video recording deleted successfully.');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      alert(`Failed to delete recording: ${err.message}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const totalCount = snapshots.length + recordings.length;

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-5">
      {/* Header and Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Camera className="w-4 h-4 text-cyan-400" />
            Live Screen Forensic Evidence (Photos &amp; Recordings)
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Proofs captured directly from live screen sessions (Save Proof snapshots and live video recordings)
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Sub-Filter Switcher */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs font-mono">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1 rounded-lg font-bold transition-all ${
                filter === 'ALL'
                  ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setFilter('PHOTOS')}
              className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                filter === 'PHOTOS'
                  ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Camera className="w-3 h-3 text-cyan-300" />
              <span>Snapshots ({snapshots.length})</span>
            </button>
            <button
              onClick={() => setFilter('VIDEOS')}
              className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                filter === 'VIDEOS'
                  ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3 h-3 text-purple-300" />
              <span>Videos ({recordings.length})</span>
            </button>
          </div>

          <button
            onClick={loadEvidence}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-mono transition disabled:opacity-50"
            title="Reload live screen evidence"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Grid Content */}
      {totalCount === 0 ? (
        <div className="py-16 text-center text-slate-500 font-mono text-xs">
          <Camera className="w-8 h-8 text-cyan-500/30 mx-auto mb-2" />
          <p>No live screen proofs saved yet.</p>
          <p className="text-[11px] text-slate-600 mt-1">
            Open the Live Remote tab and click "Save Proof" or "Save Live (Record Video)" to archive evidence.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* 1. SNAPSHOTS (PHOTOS) */}
          {(filter === 'ALL' || filter === 'PHOTOS') &&
            snapshots.map((item) => {
              const photoUrl = item.screenPhotoUrl || item.frontPhotoUrl || '';
              return (
                <div
                  key={item.id}
                  onClick={() => setActivePhoto(item)}
                  className="group relative bg-slate-950/80 rounded-xl border border-slate-800 hover:border-cyan-500/50 transition-all cursor-pointer overflow-hidden shadow-md flex flex-col justify-between"
                >
                  <div className="relative aspect-[9/16] bg-black/60 flex items-center justify-center overflow-hidden">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt="Live screen proof"
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <Camera className="w-8 h-8 text-slate-700" />
                    )}

                    {/* Badge */}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/90 text-cyan-300 border border-cyan-500/50 flex items-center gap-1 shadow-md">
                      <Camera className="w-3 h-3 text-cyan-400" />
                      SCREEN SNAPSHOT
                    </span>

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <div className="p-2 rounded-full bg-cyan-500/80 text-black">
                        <Eye className="w-4 h-4" />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900/90 border-t border-slate-800/80">
                    <p className="text-xs font-semibold text-white truncate">
                      {item.triggerReason || 'Live Screen Proof Snapshot'}
                    </p>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60 text-[11px] font-mono text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {new Date(item.timestamp || item.createdAt).toLocaleTimeString()}
                      </span>
                      <div className="flex items-center gap-1">
                        {photoUrl && (
                          <a
                            href={photoUrl}
                            download={`livescreen_snapshot_${item.id}.jpg`}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition"
                            title="Download image"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={(e) => handleDeletePhoto(e, item.id)}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                          title="Delete snapshot"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

          {/* 2. LIVE SCREEN VIDEO RECORDINGS */}
          {(filter === 'ALL' || filter === 'VIDEOS') &&
            recordings.map((rec) => {
              return (
                <div
                  key={rec.id}
                  onClick={() => setActiveVideo(rec)}
                  className="group relative bg-slate-950/80 rounded-xl border border-slate-800 hover:border-purple-500/50 transition-all cursor-pointer overflow-hidden shadow-md flex flex-col justify-between"
                >
                  <div className="relative aspect-[9/16] bg-black/60 flex items-center justify-center overflow-hidden">
                    <video
                      src={rec.url}
                      className="w-full h-full object-contain pointer-events-none"
                      preload="metadata"
                    />

                    {/* Badge */}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950/90 text-purple-300 border border-purple-500/50 flex items-center gap-1 shadow-md">
                      <Film className="w-3 h-3 text-purple-400" />
                      LIVE RECORDING
                    </span>

                    {/* Play Button Overlay */}
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/60 transition-colors flex items-center justify-center">
                      <div className="p-3 rounded-full bg-purple-600/90 text-white shadow-lg group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 fill-white ml-0.5" />
                      </div>
                    </div>

                    {/* Duration badge */}
                    {rec.duration && (
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-black/80 text-white border border-white/10">
                        {rec.duration}
                      </span>
                    )}
                  </div>

                  <div className="p-3 bg-slate-900/90 border-t border-slate-800/80">
                    <p className="text-xs font-semibold text-white truncate font-mono">
                      {rec.filename}
                    </p>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60 text-[11px] font-mono text-slate-400">
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3 text-slate-500" />
                        {formatSize(rec.sizeBytes)}
                      </span>
                      <div className="flex items-center gap-1">
                        <a
                          href={rec.url}
                          download={rec.filename}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded text-slate-400 hover:text-purple-400 hover:bg-slate-800 transition"
                          title="Download video file"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={(e) => handleDeleteVideo(e, rec.id)}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                          title="Delete recording"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* PHOTO PREVIEW MODAL */}
      {activePhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActivePhoto(null)}
        >
          <div
            className="cyber-card rounded-2xl max-w-2xl w-full p-4 border border-cyan-500/50 shadow-2xl relative space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-mono font-bold text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" />
                Live Screen Snapshot Evidence
              </h3>
              <button
                onClick={() => setActivePhoto(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[75vh] flex items-center justify-center bg-black/80 rounded-xl overflow-hidden p-2">
              <img
                src={activePhoto.screenPhotoUrl || activePhoto.frontPhotoUrl || ''}
                alt="Fullscreen proof"
                className="max-h-[70vh] object-contain rounded-lg"
              />
            </div>

            <div className="flex items-center justify-between pt-2 text-xs font-mono text-slate-400">
              <span>Reason: <strong className="text-cyan-400">{activePhoto.triggerReason || 'Live Screen Proof'}</strong></span>
              <a
                href={activePhoto.screenPhotoUrl || activePhoto.frontPhotoUrl || ''}
                download={`livescreen_snapshot_${activePhoto.id}.jpg`}
                className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Photo</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* VIDEO PLAYER MODAL */}
      {activeVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveVideo(null)}
        >
          <div
            className="cyber-card rounded-2xl max-w-2xl w-full p-4 border border-purple-500/50 shadow-2xl relative space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-mono font-bold text-white flex items-center gap-2">
                <Film className="w-4 h-4 text-purple-400" />
                Live Screen Video Playback
              </h3>
              <button
                onClick={() => setActiveVideo(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-[9/16] max-h-[70vh] mx-auto bg-black rounded-xl overflow-hidden flex items-center justify-center">
              <video
                src={activeVideo.url}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between pt-2 text-xs font-mono text-slate-400">
              <span>File: <strong className="text-purple-400">{activeVideo.filename}</strong></span>
              <a
                href={activeVideo.url}
                download={activeVideo.filename}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.3)]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Video</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
