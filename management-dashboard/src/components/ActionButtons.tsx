import React, { useState } from 'react';
import {
  Download,
  Lock,
  RotateCcw,
  Trash2,
  FileX,
  AlertTriangle,
  CheckCircle2,
  Camera,
} from 'lucide-react';
import { api } from '../services/api';

interface ActionButtonsProps {
  deviceId: string;
  isOnline: boolean;
  lastSyncedTimestamp: string;
  onCommandDispatched: () => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  deviceId,
  isOnline,
  lastSyncedTimestamp,
  onCommandDispatched,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showFileModal, setShowFileModal] = useState(false);
  const [filePath, setFilePath] = useState('/sdcard/Download/suspicious.apk');

  const executeCommand = async (type: any, params?: any, name?: string) => {
    setLoadingAction(type);
    setFeedback(null);
    try {
      const res = await api.dispatchCommand(deviceId, type, params);
      setFeedback({
        type: 'success',
        message: `Command "${name || type}" sent! Status: ${res.status}`,
      });
      onCommandDispatched();
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Failed to dispatch command: ${err.message || 'Server error'}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const formattedLastSync = lastSyncedTimestamp
    ? new Date(lastSyncedTimestamp).toLocaleString()
    : 'Never';

  return (
    <div className="cyber-card rounded-2xl p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-cyan-400" />
            Quick Response Command Terminal
          </h2>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
            Status: <span className={isOnline ? 'text-emerald-400' : 'text-slate-500'}>{isOnline ? 'ONLINE (Direct Execution)' : 'OFFLINE (Queued in DB)'}</span> • Last Sync: <span className="text-cyan-400">{formattedLastSync}</span>
          </p>
        </div>

        {feedback && (
          <div
            className={`flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-lg border ${
              feedback.type === 'success'
                ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800'
                : 'text-rose-300 bg-rose-950/40 border-rose-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{feedback.message}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5">
        {/* CAPTURE PHOTO (INTRUDER SNAPSHOT) */}
        <button
          onClick={() => executeCommand('CAPTURE_PHOTO', {}, 'Capture Intruder Photo (Front & Back)')}
          disabled={loadingAction === 'CAPTURE_PHOTO'}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-950 to-slate-900 hover:from-rose-900 hover:to-slate-800 text-rose-200 border border-rose-500/40 text-xs font-mono font-semibold transition-all shadow-[0_0_15px_rgba(244,63,94,0.15)] disabled:opacity-50"
          title="Take silent photos from front and back cameras, send to server, and erase from device"
        >
          <Camera className={`w-3.5 h-3.5 text-rose-400 ${loadingAction === 'CAPTURE_PHOTO' ? 'animate-pulse' : ''}`} />
          <span>{loadingAction === 'CAPTURE_PHOTO' ? 'Snapping...' : 'Snap Cameras'}</span>
        </button>

        {/* GET LOGS BUTTON */}
        <button
          onClick={() => executeCommand('GET_LOGS', {}, 'Get Logs (Immediate Delta Sync)')}
          disabled={loadingAction === 'GET_LOGS'}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-950 to-slate-900 hover:from-cyan-900 hover:to-slate-800 text-cyan-200 border border-cyan-500/40 text-xs font-mono font-semibold transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] disabled:opacity-50"
        >
          <Download className={`w-3.5 h-3.5 text-cyan-400 ${loadingAction === 'GET_LOGS' ? 'animate-bounce' : ''}`} />
          <span>{loadingAction === 'GET_LOGS' ? 'Syncing...' : 'Sync Logs Now'}</span>
        </button>

        {/* LOCK DEVICE */}
        <button
          onClick={() => executeCommand('LOCK_DEVICE', {}, 'Lock Phone')}
          disabled={loadingAction === 'LOCK_DEVICE'}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-mono font-semibold transition disabled:opacity-50"
        >
          <Lock className="w-3.5 h-3.5 text-amber-400" />
          <span>Lock Screen</span>
        </button>

        {/* REBOOT DEVICE */}
        <button
          onClick={() => executeCommand('REBOOT_DEVICE', {}, 'Reboot Phone')}
          disabled={loadingAction === 'REBOOT_DEVICE'}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-mono font-semibold transition disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Reboot Device</span>
        </button>

        {/* DELETE FILE */}
        <button
          onClick={() => setShowFileModal(true)}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-mono font-semibold transition"
        >
          <FileX className="w-3.5 h-3.5 text-rose-400" />
          <span>Purge File...</span>
        </button>

        {/* FACTORY WIPE */}
        <button
          onClick={() => {
            if (window.confirm('CRITICAL WARNING: This will factory reset and erase all data on the target phone! Are you sure?')) {
              executeCommand('WIPE_DEVICE', {}, 'Factory Wipe');
            }
          }}
          disabled={loadingAction === 'WIPE_DEVICE'}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 text-xs font-mono font-semibold transition disabled:opacity-50 ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Emergency Wipe</span>
        </button>
      </div>

      {/* Delete File Modal */}
      {showFileModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-white flex items-center gap-2 mb-2">
              <FileX className="w-4 h-4 text-rose-400" />
              Remote File Deletion
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Specify the absolute path of the file on the Android device to securely delete (e.g. photos, videos, PDFs, malware APKs).
            </p>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500 mb-4"
              placeholder="/sdcard/Download/filename.ext"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowFileModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowFileModal(false);
                  executeCommand('DELETE_FILE', { filePath }, `Delete File (${filePath})`);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-500"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
