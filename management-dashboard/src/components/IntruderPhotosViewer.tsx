import React, { useEffect, useState } from 'react';
import {
  Camera,
  Download,
  Trash2,
  RefreshCw,
  Eye,
  ShieldAlert,
  X,
  Clock,
} from 'lucide-react';
import { IntruderPhoto } from '../types';
import { api } from '../services/api';

interface IntruderPhotosViewerProps {
  deviceId: string;
  onCaptureRequested: () => void;
  isCapturing: boolean;
  refreshTrigger?: number;
}

export const IntruderPhotosViewer: React.FC<IntruderPhotosViewerProps> = ({
  deviceId,
  onCaptureRequested,
  isCapturing,
  refreshTrigger,
}) => {
  const [photos, setPhotos] = useState<IntruderPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<{ url: string; title: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPhotos = async () => {
    setLoading(true);
    try {
      const data = await api.getIntruderPhotos(deviceId);
      // Strictly show only real camera photos (Front & Back cameras)
      const cameraOnly = data.filter(
        (p) =>
          p.photoType !== 'LIVE_SCREEN_PROOF' &&
          !p.triggerReason?.toLowerCase().includes('proof') &&
          !p.triggerReason?.toLowerCase().includes('live screen')
      );
      setPhotos(cameraOnly);
    } catch (err) {
      console.error('Failed loading intruder photos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      loadPhotos();
    }
  }, [deviceId, refreshTrigger]);

  useEffect(() => {
    if (!isCapturing && deviceId) {
      loadPhotos();
    }
  }, [isCapturing]);

  const handleDelete = async (photoId: string) => {
    if (!confirm('Permanently delete this photo evidence record from the server?')) return;
    setDeletingId(photoId);
    try {
      await api.deleteIntruderPhoto(deviceId, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      alert('Failed to delete photo');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Camera className="w-4 h-4 text-rose-400" />
            Anti-Theft Silent Intruder Snapshots (Front &amp; Back Camera)
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Photographic evidence automatically wiped from phone storage and saved to server
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onCaptureRequested}
            disabled={isCapturing}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-medium text-xs transition shadow-sm hover:shadow-rose-600/30 disabled:opacity-50"
          >
            <Camera className={`w-3.5 h-3.5 ${isCapturing ? 'animate-pulse' : ''}`} />
            <span>{isCapturing ? 'Snapping Cameras...' : 'Capture Photo Now'}</span>
          </button>

          <button
            onClick={loadPhotos}
            disabled={loading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50"
            title="Refresh photos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Security Info Banner */}
      <div className="p-3 bg-rose-950/30 border border-rose-800/60 rounded-lg flex items-center justify-between text-xs text-rose-300">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>
            <strong>Anti-Theft Protection Active:</strong> Photos taken through this feature are processed in memory and never stored in the phone's Gallery or user storage.
          </span>
        </div>
        <span className="font-mono text-[11px] px-2 py-0.5 bg-rose-900/50 rounded text-rose-200">
          {photos.length} Captured Evidence Records
        </span>
      </div>

      {/* Photos Grid */}
      {photos.length === 0 ? (
        <div className="py-16 text-center space-y-3 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <Camera className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-300">No intruder evidence photos captured yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Click "Capture Photo Now" or trigger it from Quick Actions to capture silent snapshots of whoever is holding the stolen phone.
            </p>
          </div>
          <button
            onClick={onCaptureRequested}
            disabled={isCapturing}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-medium text-xs transition"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Take First Intruder Snapshot</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {photos.map((session, index) => (
            <div
              key={session.id}
              className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/80 pb-2.5 gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-rose-950 border border-rose-800 flex items-center justify-center text-rose-400 text-xs font-bold font-mono">
                    #{photos.length - index}
                  </div>
                  <div className="flex items-center space-x-1.5 text-xs text-slate-300">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Captured: <strong>{formatDate(session.timestamp)}</strong></span>
                  </div>
                  {session.triggerReason && (
                    <span
                      className={`px-2.5 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1.5 ${
                        session.triggerReason.toLowerCase().includes('trap')
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-800/80'
                          : 'bg-blue-950/80 text-blue-300 border border-blue-800/80'
                      }`}
                    >
                      <span>{session.triggerReason.toLowerCase().includes('trap') ? '⚡' : '🛡️'}</span>
                      <span>{session.triggerReason}</span>
                    </span>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(session.id)}
                  disabled={deletingId === session.id}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800 text-[11px] transition disabled:opacity-50"
                  title="Delete evidence record"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              </div>

              {/* Dual Cameras Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Front Camera */}
                <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      FRONT CAMERA (Intruder Face)
                    </span>
                    {session.frontPhotoUrl && (
                      <a
                        href={session.frontPhotoUrl}
                        download={`intruder_front_${session.id}.jpg`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> Download
                      </a>
                    )}
                  </div>

                  {session.frontPhotoUrl ? (
                    <div
                      onClick={() =>
                        setPreviewUrl({
                          url: session.frontPhotoUrl!,
                          title: `Front Camera (Intruder) - ${formatDate(session.timestamp)}`,
                        })
                      }
                      className="relative group cursor-pointer aspect-video bg-black rounded-lg overflow-hidden border border-slate-800"
                    >
                      <img
                        src={session.frontPhotoUrl}
                        alt="Intruder Front Camera"
                        className="w-full h-full object-contain group-hover:scale-105 transition duration-300"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition text-white text-xs font-medium gap-1.5 backdrop-blur-sm">
                        <Eye className="w-4 h-4" /> Click to Enlarge
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video bg-slate-950/60 rounded-lg flex items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800">
                      Front camera unavailable
                    </div>
                  )}
                </div>

                {/* Back Camera */}
                <div className="space-y-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                      BACK CAMERA (Environment / Scene)
                    </span>
                    {session.backPhotoUrl && (
                      <a
                        href={session.backPhotoUrl}
                        download={`intruder_back_${session.id}.jpg`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-400 hover:text-amber-300 text-[11px] flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> Download
                      </a>
                    )}
                  </div>

                  {session.backPhotoUrl ? (
                    <div
                      onClick={() =>
                        setPreviewUrl({
                          url: session.backPhotoUrl!,
                          title: `Back Camera (Environment) - ${formatDate(session.timestamp)}`,
                        })
                      }
                      className="relative group cursor-pointer aspect-video bg-black rounded-lg overflow-hidden border border-slate-800"
                    >
                      <img
                        src={session.backPhotoUrl}
                        alt="Intruder Back Camera"
                        className="w-full h-full object-contain group-hover:scale-105 transition duration-300"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition text-white text-xs font-medium gap-1.5 backdrop-blur-sm">
                        <Eye className="w-4 h-4" /> Click to Enlarge
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video bg-slate-950/60 rounded-lg flex items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800">
                      Back camera unavailable
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4">
          <div className="max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl space-y-3 p-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-sm font-semibold text-white">{previewUrl.title}</span>
              <button
                onClick={() => setPreviewUrl(null)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[75vh] flex items-center justify-center bg-black rounded-lg overflow-hidden">
              <img
                src={previewUrl.url}
                alt="Enlarged Intruder Photo"
                className="max-h-[72vh] w-auto object-contain"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <a
                href={previewUrl.url}
                download="intruder_snapshot.jpg"
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download High-Res</span>
              </a>
              <button
                onClick={() => setPreviewUrl(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
