import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Camera,
  Download,
  Trash2,
  Clock,
  Film,
  Smartphone,
  HardDrive,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  X,
  Sliders,
} from 'lucide-react';
import { api } from '../services/api';
import { RecordedVideo } from '../types';

interface LiveScreenViewerProps {
  deviceId: string;
  isOnline: boolean;
  screenFrame: {
    frameBase64: string;
    timestamp: string;
    seq?: number;
    captureTime?: number;
    width?: number;
    height?: number;
    fps?: number;
    frameSizeBytes?: number;
  } | null;
  streamStatus: { active: boolean; error?: string; targetFps?: number } | null;
}

interface BufferedFrame {
  img: HTMLImageElement;
  seq: number;
  captureTime: number;
  arrivalLocalTime: number;
  base64: string;
}

export const LiveScreenViewer: React.FC<LiveScreenViewerProps> = ({
  deviceId,
  isOnline,
  screenFrame,
  streamStatus,
}) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCommandPending, setIsCommandPending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [autoSaveProof, setAutoSaveProof] = useState(false);
  const [lastSavedProofTime, setLastSavedProofTime] = useState<number>(0);
  const [savedProofs, setSavedProofs] = useState<Array<{ id: string; url: string; time: string }>>([]);

  // Video Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordings, setRecordings] = useState<RecordedVideo[]>([]);
  const [activeVideoModal, setActiveVideoModal] = useState<RecordedVideo | null>(null);

  // Smooth Buffer Engine (Default: 300ms for smooth 15 FPS playback with minimal delay)
  const [bufferDelayMs, setBufferDelayMs] = useState<number>(300);
  const [bufferedQueueCount, setBufferedQueueCount] = useState<number>(0);

  // Performance Telemetry
  const [fps, setFps] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState<string | null>(null);

  // Display & Recording Canvas Ref
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameQueueRef = useRef<BufferedFrame[]>([]);
  const currentRenderedFrameRef = useRef<BufferedFrame | null>(null);
  const bufferStartTimestampRef = useRef<number>(0);

  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const recordingSecondsRef = useRef(0);

  // FPS calculation refs
  const frameCountRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());

  // Load existing proof snapshots and video recordings on mount
  useEffect(() => {
    if (deviceId) {
      api.getIntruderPhotos(deviceId).then((photos) => {
        const formatted = photos
          .filter((p) => p.frontPhotoUrl || p.triggerReason?.includes('Proof') || p.triggerReason?.includes('Live'))
          .map((p) => ({
            id: p.id,
            url: p.frontPhotoUrl || '',
            time: new Date(p.timestamp || p.createdAt).toLocaleTimeString(),
          }));
        setSavedProofs(formatted);
      }).catch((e) => console.error('Failed loading photos:', e));

      api.getRecordings(deviceId).then((recs) => {
        setRecordings(recs);
      }).catch((e) => console.error('Failed loading recordings:', e));
    }
  }, [deviceId]);

  // Sync stream status from phone
  useEffect(() => {
    if (streamStatus) {
      setIsStreaming(streamStatus.active);
      if (streamStatus.error) {
        setStatusMsg({ text: streamStatus.error, type: 'error' });
      }
    }
  }, [streamStatus]);

  // Receive and enqueue incoming frame into Jitter Buffer
  useEffect(() => {
    if (screenFrame?.frameBase64) {
      setIsStreaming(true);
      setTotalFrames((prev) => prev + 1);
      setLastFrameTime(screenFrame.timestamp);

      frameCountRef.current += 1;
      const now = Date.now();
      if (now - lastFpsCalcRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsCalcRef.current = now;
      }

      // Pre-decode into HTMLImageElement and enqueue
      const img = new Image();
      const arrival = Date.now();
      img.onload = () => {
        frameQueueRef.current.push({
          img,
          seq: screenFrame.seq || totalFrames,
          captureTime: screenFrame.captureTime || arrival,
          arrivalLocalTime: arrival,
          base64: screenFrame.frameBase64,
        });

        // Ensure queue is strictly sorted by arrival time
        frameQueueRef.current.sort((a, b) => a.arrivalLocalTime - b.arrivalLocalTime);

        // Limit queue size to 60 frames (~3-4 seconds) to prevent memory accumulation
        if (frameQueueRef.current.length > 60) {
          frameQueueRef.current.splice(0, frameQueueRef.current.length - 60);
        }
        setBufferedQueueCount(frameQueueRef.current.length);
      };
      img.src = `data:image/jpeg;base64,${screenFrame.frameBase64}`;

      // Handle Auto-Save Proof every 10 seconds if enabled
      if (autoSaveProof && now - lastSavedProofTime > 10000) {
        setLastSavedProofTime(now);
        saveFrameAsProof(screenFrame.frameBase64, 'Auto-Archived Live Screen Proof');
      }
    }
  }, [screenFrame, autoSaveProof, lastSavedProofTime]);

  // High-framerate playback render loop
  useEffect(() => {
    let animId: number;

    const smoothPlaybackLoop = () => {
      const canvas = displayCanvasRef.current;
      const queue = frameQueueRef.current;

      if (canvas && queue.length > 0) {
        const now = Date.now();

        if (bufferStartTimestampRef.current === 0) {
          bufferStartTimestampRef.current = now;
        }

        const elapsedSinceStart = now - bufferStartTimestampRef.current;
        const targetDelay = Math.min(bufferDelayMs, 3000);

        // Find the newest frame that has reached play time
        let activeIdx = -1;
        if (targetDelay === 0 || elapsedSinceStart < targetDelay || queue.length <= 1) {
          // Play immediately on first frame or minimal queue without black screen delay
          activeIdx = queue.length - 1;
        } else {
          const targetPlayTime = now - targetDelay;
          for (let i = 0; i < queue.length; i++) {
            if (queue[i].arrivalLocalTime <= targetPlayTime) {
              activeIdx = i;
            } else {
              break;
            }
          }
        }

        if (activeIdx >= 0) {
          const frameToRender = queue[activeIdx];
          currentRenderedFrameRef.current = frameToRender;

          const ctx = canvas.getContext('2d');
          if (ctx && frameToRender.img.complete) {
            const targetW = frameToRender.img.naturalWidth || 480;
            const targetH = frameToRender.img.naturalHeight || 1066;

            if (canvas.width !== targetW || canvas.height !== targetH) {
              canvas.width = targetW;
              canvas.height = targetH;
            }

            ctx.drawImage(frameToRender.img, 0, 0, canvas.width, canvas.height);
          }

          // Purge consumed frames from buffer
          if (activeIdx > 0) {
            queue.splice(0, activeIdx);
            setBufferedQueueCount(queue.length);
          }
        }
      }

      animId = requestAnimationFrame(smoothPlaybackLoop);
    };

    animId = requestAnimationFrame(smoothPlaybackLoop);
    return () => cancelAnimationFrame(animId);
  }, [bufferDelayMs]);

  // Format seconds to MM:SS
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // --- BUTTON 1: START / STOP LIVE STREAM (Controls Phone Transmission) ---
  const handleStartStream = async () => {
    if (!isOnline) {
      alert('Endpoint is currently offline. Screen stream requires live connection.');
      return;
    }

    setIsCommandPending(true);
    setStatusMsg({ text: 'Sending START_SCREEN_STREAM command to phone...', type: 'info' });
    try {
      bufferStartTimestampRef.current = 0;
      frameQueueRef.current = [];
      await api.dispatchCommand(deviceId, 'START_SCREEN_STREAM');
      setIsStreaming(true);
      setStatusMsg({ text: 'Live screen stream active. Streaming smooth frames...', type: 'success' });
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (err: any) {
      setStatusMsg({ text: `Failed starting screen stream: ${err.message}`, type: 'error' });
      setIsStreaming(false);
    } finally {
      setIsCommandPending(false);
    }
  };

  const handleStopStream = async () => {
    if (isRecording) {
      stopRecording();
    }

    setIsCommandPending(true);
    setStatusMsg({ text: 'Sending STOP_SCREEN_STREAM command to phone...', type: 'info' });
    try {
      await api.dispatchCommand(deviceId, 'STOP_SCREEN_STREAM');
      setIsStreaming(false);
      setFps(0);
      setStatusMsg({ text: 'Live screen stream stopped.', type: 'info' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ text: `Failed stopping screen stream: ${err.message}`, type: 'error' });
    } finally {
      setIsCommandPending(false);
    }
  };

  // --- BUTTON 2: SAVE LIVE / RECORD VIDEO (Separate Button with Running MM:SS Timer) ---
  const startRecording = () => {
    if (!displayCanvasRef.current) return;
    if (!screenFrame?.frameBase64 && !isStreaming) {
      setStatusMsg({
        text: 'Live stream must be running before recording. Click "Start Live Screen" first.',
        type: 'error',
      });
      return;
    }

    try {
      // Capture 30 FPS canvas video stream
      const canvasStream = displayCanvasRef.current.captureStream(30);

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4';

      const mr = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 2500000 });
      mediaRecorderRef.current = mr;
      recordedChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      mr.onstop = async () => {
        const recordedBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        const finalSecs = recordingSecondsRef.current;
        const durationFormatted = formatTime(finalSecs);

        // 1. Immediately trigger automatic download to computer
        const localDownloadUrl = URL.createObjectURL(recordedBlob);
        const a = document.createElement('a');
        a.href = localDownloadUrl;
        a.download = `edr_recording_${deviceId}_${Date.now()}.webm`;
        a.click();

        // 2. Upload video recording to server for legal proof
        try {
          const savedRecord = await api.uploadRecording(deviceId, recordedBlob, durationFormatted);
          setRecordings((prev) => [savedRecord, ...prev]);
          setStatusMsg({
            text: `🎥 Video proof saved successfully (${durationFormatted})! Downloaded and backed up to server.`,
            type: 'success',
          });
          setTimeout(() => setStatusMsg(null), 5000);
        } catch (err: any) {
          console.error('Failed uploading video to server:', err);
          const fallbackRec: RecordedVideo = {
            id: crypto.randomUUID(),
            deviceId,
            filename: `recording_${Date.now()}.webm`,
            url: localDownloadUrl,
            duration: durationFormatted,
            sizeBytes: recordedBlob.size,
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          setRecordings((prev) => [fallbackRec, ...prev]);
        }
      };

      mr.start(250); // Collect chunk every 250ms
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          recordingSecondsRef.current = next;
          return next;
        });
      }, 1000);

      setStatusMsg({
        text: '🔴 Video recording started. Live phone screen display is being captured...',
        type: 'info',
      });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      console.error('Failed to start MediaRecorder:', err);
      setStatusMsg({ text: `Failed starting video recorder: ${err.message}`, type: 'error' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  };

  // Helper: Save a single still frame as proof
  const saveFrameAsProof = async (base64Img: string, reason: string) => {
    try {
      await api.uploadIntruderPhoto(deviceId, {
        screenPhotoBase64: base64Img,
        photoType: 'LIVE_SCREEN_PROOF',
        triggerReason: reason,
        timestamp: new Date().toISOString(),
      });
      const photos = await api.getIntruderPhotos(deviceId);
      const formatted = photos
        .filter((p) => p.photoType === 'LIVE_SCREEN_PROOF' || p.triggerReason?.includes('Proof') || p.triggerReason?.includes('Live'))
        .map((p) => ({
          id: p.id,
          url: p.screenPhotoUrl || p.frontPhotoUrl || '',
          time: new Date(p.timestamp || p.createdAt).toLocaleTimeString(),
        }));
      setSavedProofs(formatted);
    } catch (err) {
      console.error('Failed to save frame proof:', err);
    }
  };

  const handleManualProofSnapshot = async () => {
    if (!currentRenderedFrameRef.current?.base64 && !screenFrame?.frameBase64) {
      alert('No active screen frame available to capture.');
      return;
    }
    const base64 = currentRenderedFrameRef.current?.base64 || screenFrame!.frameBase64;
    setStatusMsg({ text: 'Saving forensic live screen proof snapshot...', type: 'info' });
    try {
      await saveFrameAsProof(base64, 'Manual Live Screen Proof Snapshot');
      setStatusMsg({ text: 'Proof snapshot successfully saved and archived!', type: 'success' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ text: `Failed saving proof snapshot: ${err.message}`, type: 'error' });
    }
  };

  const handleDeleteRecording = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Permanently delete this saved video recording?')) return;
    try {
      await api.deleteRecording(deviceId, id);
      setRecordings((prev) => prev.filter((r) => r.id !== id));
      if (activeVideoModal?.id === id) setActiveVideoModal(null);
    } catch (err: any) {
      alert(`Failed to delete recording: ${err.message}`);
    }
  };

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            Live Remote Screen Mirroring &amp; Anti-Theft View
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Real-time low-latency WebSocket screen projection &amp; forensic video recorder
          </p>
        </div>

        {/* Action Buttons: Stop Live Screen and Save Live (Recording) are SEPARATE buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* BUTTON 1: Start / Stop Live Screen (Remote Device Stream) */}
          {!isStreaming ? (
            <button
              onClick={handleStartStream}
              disabled={isCommandPending || !isOnline}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-lg shadow-emerald-950/40 disabled:opacity-50"
              title="Start remote screen streaming from phone"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isCommandPending ? 'Connecting...' : 'Start Live Screen'}</span>
            </button>
          ) : (
            <button
              onClick={handleStopStream}
              disabled={isCommandPending}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition shadow-sm disabled:opacity-50"
              title="Stop the live screen stream from phone"
            >
              <Square className="w-3.5 h-3.5 fill-current text-rose-400" />
              <span>{isCommandPending ? 'Stopping...' : 'Stop Live Screen'}</span>
            </button>
          )}

          {/* BUTTON 2: Save Live / Record Video (Independent recording button with running MM:SS timer) */}
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={!isStreaming}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition shadow-lg shadow-purple-950/40 disabled:opacity-40"
              title="Record live screen video directly to your computer"
            >
              <Film className="w-4 h-4 text-purple-200" />
              <span>Save Live (Record Video)</span>
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition shadow-lg shadow-rose-950/60 animate-pulse"
              title="Stop recording and download video proof"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
              <span>⏹ Stop &amp; Save Video ({formatTime(recordingSeconds)})</span>
            </button>
          )}

          {/* BUTTON 3: Save Forensic Proof Snapshot */}
          <button
            onClick={handleManualProofSnapshot}
            disabled={!isStreaming && totalFrames === 0}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-medium transition disabled:opacity-40"
            title="Save instant high-resolution frame snapshot to legal proof archive"
          >
            <Camera className="w-3.5 h-3.5 text-amber-400" />
            <span>Save Proof</span>
          </button>

          {/* Auto Archive Toggle */}
          <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer select-none px-2 py-1 rounded bg-slate-850/80 border border-slate-800">
            <input
              type="checkbox"
              checked={autoSaveProof}
              onChange={(e) => setAutoSaveProof(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-purple-600 focus:ring-0"
            />
            <span className="text-[11px] text-slate-400">Auto-Archive (10s)</span>
          </label>
        </div>
      </div>

      {/* Smoothness Engine Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-lg text-xs">
        <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          Live Screen Streaming Engine Active
        </span>

        {/* Fluid Buffer Presets */}
        <div className="flex items-center space-x-2">
          <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            Buffer:
          </span>
          <button
            onClick={() => setBufferDelayMs(0)}
            className={`px-2 py-0.5 rounded font-medium transition ${
              bufferDelayMs === 0
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚡ Realtime (0s)
          </button>
          <button
            onClick={() => setBufferDelayMs(500)}
            className={`px-2 py-0.5 rounded font-medium transition flex items-center space-x-1 ${
              bufferDelayMs === 500
                ? 'bg-emerald-600 text-white font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>✨ Smooth 500ms</span>
            <span className="text-[9px] px-1 bg-black/30 rounded">Recommended</span>
          </button>
          <button
            onClick={() => setBufferDelayMs(1500)}
            className={`px-2 py-0.5 rounded font-medium transition ${
              bufferDelayMs === 1500
                ? 'bg-purple-600 text-white font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🛡️ Anti-Lag (1.5s)
          </button>
          {bufferedQueueCount > 0 && (
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-900">
              {bufferedQueueCount} frames
            </span>
          )}
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMsg && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between border ${
            statusMsg.type === 'error'
              ? 'bg-rose-950/40 border-rose-800 text-rose-300'
              : statusMsg.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-blue-950/40 border-blue-800 text-blue-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {statusMsg.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : statusMsg.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            ) : (
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        </div>
      )}

      {/* Main Streaming Display Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Phone Bezel Container with GPU Hardware Accelerated Canvas */}
        <div className="lg:col-span-7 flex flex-col items-center justify-center p-6 bg-slate-950/80 rounded-2xl border border-slate-800/80 shadow-inner">
          {/* Realistic Phone Bezel */}
          <div className="relative w-[310px] sm:w-[340px] aspect-[9/19.5] bg-black rounded-[44px] p-3.5 shadow-2xl shadow-black ring-1 ring-slate-800 border-4 border-slate-850 flex flex-col">
            {/* Top Speaker Notch */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-24 h-4 bg-black rounded-full z-20 flex items-center justify-center space-x-2">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-900 ring-1 ring-slate-800"></div>
              <div className="w-8 h-1 bg-slate-900 rounded-full"></div>
            </div>

            {/* Screen Inner Display: Rendered on GPU Canvas at 60 FPS */}
            <div className="relative w-full h-full bg-slate-950 rounded-[34px] overflow-hidden flex items-center justify-center border border-slate-900">
              {/* Hardware Accelerated Canvas */}
              <canvas
                ref={displayCanvasRef}
                width={540}
                height={1200}
                className={`w-full h-full object-contain select-none ${
                  isStreaming ? 'block' : 'hidden'
                }`}
              />

              {!isStreaming && (
                <div className="p-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                    <Smartphone className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">Live Screen Standby</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-[200px] mx-auto">
                      {isOnline
                        ? 'Click "Start Live Screen" above to stream live display.'
                        : 'Endpoint is offline. Turn on phone or connect to network.'}
                    </p>
                  </div>
                  {isOnline && (
                    <button
                      onClick={handleStartStream}
                      disabled={isCommandPending}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Start Stream</span>
                    </button>
                  )}
                </div>
              )}

              {/* Streaming Overlay Badge inside Phone */}
              {isStreaming && (
                <div className="absolute top-3 left-4 right-4 flex items-center justify-between text-[10px] text-white/90 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full z-10 font-mono">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                    <span className="font-bold text-rose-300">LIVE</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span>{fps > 0 ? `${fps} FPS` : 'Streaming'}</span>
                  </div>
                </div>
              )}

              {/* Active Recording Watermark Badge */}
              {isRecording && (
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs text-white bg-rose-950/80 border border-rose-600/80 backdrop-blur-md px-3.5 py-1.5 rounded-full z-10 font-mono shadow-lg animate-pulse">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping"></span>
                    <span className="font-bold text-rose-200">REC [SCREEN]</span>
                  </div>
                  <span className="font-bold text-white tracking-widest">{formatTime(recordingSeconds)}</span>
                </div>
              )}
            </div>

            {/* Bottom Navigation Pill */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 bg-slate-800 rounded-full"></div>
          </div>
        </div>

        {/* Right Column: Telemetry, Saved Videos & Proof Gallery */}
        <div className="lg:col-span-5 space-y-4">
          {/* Live Telemetry Card */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              Stream Telemetry &amp; Health
            </h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Status</span>
                <span className={`font-semibold ${isStreaming ? 'text-emerald-400 flex items-center gap-1.5' : 'text-slate-400'}`}>
                  {isStreaming ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      ACTIVE STREAM
                    </>
                  ) : (
                    'STANDBY'
                  )}
                </span>
              </div>

              <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Framerate</span>
                <span className="font-mono font-bold text-white text-sm">
                  {fps > 0 ? `${fps} FPS` : isStreaming ? '~15 FPS' : '0 FPS'}
                </span>
              </div>

              <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 col-span-2">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Frames Received</span>
                <span className="font-mono font-bold text-cyan-300 text-sm">
                  {totalFrames.toLocaleString()}
                </span>
              </div>
            </div>

            {lastFrameTime && (
              <div className="text-[11px] text-slate-400 flex items-center space-x-1.5 pt-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>Last frame: <strong className="text-slate-300 font-mono">{new Date(lastFrameTime).toLocaleTimeString()}</strong></span>
              </div>
            )}
          </div>

          {/* Saved Video Recordings Section */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Film className="w-4 h-4 text-purple-400" />
                Saved Video Recordings ({recordings.length})
              </h3>
              <span className="text-[10px] text-slate-500">Video Proof</span>
            </div>

            {recordings.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800/80 text-center">
                <p className="text-xs text-slate-400">No recorded video proofs yet.</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Click &quot;Save Live (Record Video)&quot; to capture screen.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
                {recordings.map((rec) => (
                  <div
                    key={rec.id}
                    onClick={() => setActiveVideoModal(rec)}
                    className="flex items-center justify-between p-2.5 bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-purple-800/60 rounded-lg cursor-pointer transition text-xs group"
                  >
                    <div className="flex items-center space-x-2.5 truncate">
                      <div className="w-8 h-8 rounded bg-purple-950/60 border border-purple-800/60 flex items-center justify-center text-purple-400 shrink-0 group-hover:scale-105 transition">
                        <Play className="w-3.5 h-3.5 fill-purple-400" />
                      </div>
                      <div className="truncate">
                        <p className="font-semibold text-slate-200 truncate group-hover:text-purple-300 transition">
                          {rec.filename}
                        </p>
                        <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                          <span>{rec.duration || '00:15'}</span>
                          <span>•</span>
                          <span>{rec.sizeBytes ? `${Math.round(rec.sizeBytes / 1024)} KB` : 'WebM Video'}</span>
                          <span>•</span>
                          <span>{new Date(rec.createdAt || rec.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
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
                        onClick={(e) => handleDeleteRecording(e, rec.id)}
                        className="p-1.5 rounded hover:bg-rose-950 text-slate-400 hover:text-rose-400 transition"
                        title="Delete Recording"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session Proof Snapshots Gallery */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Camera className="w-4 h-4 text-amber-400" />
                Session Proof Snapshots ({savedProofs.length})
              </h3>
              <span className="text-[10px] text-slate-500">Saved to server</span>
            </div>

            {savedProofs.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800/80 text-center">
                <p className="text-xs text-slate-400">No snapshot proofs saved yet.</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Click &quot;Save Proof&quot; to archive still frames.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-[140px] overflow-y-auto pr-1">
                {savedProofs.map((proof) => (
                  <div
                    key={proof.id}
                    className="group relative rounded-lg overflow-hidden border border-slate-800 aspect-[9/16] bg-slate-900 flex items-center justify-center cursor-pointer hover:border-amber-500/50 transition"
                    onClick={() => window.open(proof.url, '_blank')}
                    title="Click to view full resolution snapshot"
                  >
                    <img
                      src={proof.url}
                      alt="Proof"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-end p-1.5">
                      <span className="text-[9px] text-white font-mono">{proof.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Video Modal Player */}
      {activeVideoModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4 p-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Film className="w-4 h-4 text-purple-400" />
                <h4 className="text-sm font-semibold text-white truncate max-w-xs">{activeVideoModal.filename}</h4>
              </div>
              <button
                onClick={() => setActiveVideoModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Player */}
            <div className="rounded-xl overflow-hidden bg-black aspect-[9/16] max-h-[460px] mx-auto flex items-center justify-center border border-slate-800">
              <video
                src={activeVideoModal.url}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-400">
                Duration: <strong className="text-slate-200">{activeVideoModal.duration || '00:15'}</strong>
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href={activeVideoModal.url}
                  download={activeVideoModal.filename}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download WebM</span>
                </a>
                <button
                  onClick={() => setActiveVideoModal(null)}
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
