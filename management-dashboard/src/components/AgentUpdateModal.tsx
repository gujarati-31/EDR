import React, { useEffect, useState, useCallback } from 'react';
import { UploadCloud, X, CheckCircle2, AlertCircle, Loader2, Send, PackageCheck, QrCode, Copy, Check, ShieldCheck, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { AppRelease, ProvisioningQrData } from '../types';
import { api } from '../services/api';

const DEFAULT_RELEASE_CHECKSUM = 'ax7KU6-Ih_42hDN-pREz3SazcvRF5qQmOR2Dxug-41E';

interface AgentUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReleaseUpdated: (msg: string, type: 'success' | 'error' | 'info') => void;
  selectedDeviceId?: string;
  selectedDeviceName?: string;
}

export const AgentUpdateModal: React.FC<AgentUpdateModalProps> = ({
  isOpen,
  onClose,
  onReleaseUpdated,
  selectedDeviceId,
  selectedDeviceName,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'qr'>('upload');
  const [latest, setLatest] = useState<AppRelease | null>(null);
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [versionCode, setVersionCode] = useState<string>('7');
  const [versionName, setVersionName] = useState<string>('3.4.0');
  const [releaseNotes, setReleaseNotes] = useState<string>('');
  const [signatureChecksum, setSignatureChecksum] = useState<string>(DEFAULT_RELEASE_CHECKSUM);
  const [pushToAll, setPushToAll] = useState<boolean>(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [qrData, setQrData] = useState<ProvisioningQrData | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState<string>('');
  const [qrServerUrl, setQrServerUrl] = useState<string>('');
  const [qrChecksum, setQrChecksum] = useState<string>(DEFAULT_RELEASE_CHECKSUM);
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadProvisioningQr = useCallback(async (srv?: string, csum?: string) => {
    setIsLoadingQr(true);
    try {
      const data = await api.getProvisioningQr(srv, csum);
      setQrData(data);
      if (data?.qrString) {
        const img = await QRCode.toDataURL(data.qrString, {
          width: 240,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        setQrImageUrl(img);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed loading provisioning QR data');
    } finally {
      setIsLoadingQr(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    api.getLatestRelease().then((rel) => {
      setLatest(rel);
      if (rel) {
        setVersionCode(String(rel.versionCode + 1));
        if (rel.signatureChecksum) {
          setSignatureChecksum(rel.signatureChecksum);
          setQrChecksum(rel.signatureChecksum);
        }
      }
    }).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'qr') return;
    loadProvisioningQr(qrServerUrl, qrChecksum);
  }, [isOpen, activeTab, loadProvisioningQr]);

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }).catch(() => {});
  };

  if (!isOpen) return null;

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apkFile) {
      setErrorMsg('Please select an .apk file first.');
      return;
    }
    const parsedCode = parseInt(versionCode, 10);
    if (!parsedCode || parsedCode < 1 || !versionName.trim()) {
      setErrorMsg('Enter valid numeric Version Code and Version Name (e.g. 7 and 3.4.0).');
      return;
    }

    setErrorMsg(null);
    setIsUploading(true);
    try {
      const res = await api.uploadAgentRelease(
        apkFile,
        parsedCode,
        versionName.trim(),
        releaseNotes.trim(),
        pushToAll,
        signatureChecksum.trim() || undefined
      );
      if (!res.success || !res.data) {
        setErrorMsg(res.message || 'Upload failed');
        return;
      }
      setLatest(res.data);
      setApkFile(null);
      setReleaseNotes('');
      onReleaseUpdated(res.message, 'success');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed uploading APK release');
    } finally {
      setIsUploading(false);
    }
  };

  const handlePushExisting = async (target: string) => {
    setIsPushing(true);
    setErrorMsg(null);
    try {
      const res = await api.pushAgentUpdate(target, true);
      onReleaseUpdated(res.message, res.success ? 'success' : 'error');
      if (res.success) onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed pushing update');
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-950 border border-cyan-500/40 shadow-[0_0_40px_rgba(6,182,212,0.2)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <UploadCloud className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                OTA Agent Release & Device Owner
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                Push OTA APKs & provision phones for zero-tap silent updates
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-900/40 px-5 gap-2 pt-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-t-xl text-xs font-mono font-bold border-b-2 transition ${
              activeTab === 'upload'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Upload & Push OTA</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-t-xl text-xs font-mono font-bold border-b-2 transition ${
              activeTab === 'qr'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Device Owner QR (Silent OTA)</span>
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {activeTab === 'upload' ? (
            <>
          {/* Currently Hosted APK Card */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-slate-400 uppercase flex items-center gap-1.5">
                <PackageCheck className="w-4 h-4 text-emerald-400" />
                Latest Hosted APK
              </span>
              {latest && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-500/40">
                  v{latest.versionName} (code {latest.versionCode})
                </span>
              )}
            </div>

            {latest ? (
              <div className="text-[11px] font-mono text-slate-300 space-y-1">
                <div>File: <span className="text-cyan-300">{latest.filename}</span> ({(latest.fileSize / (1024 * 1024)).toFixed(2)} MB)</div>
                <div className="text-slate-400">SHA-256: {latest.sha256.slice(0, 20)}...</div>
                <div className="flex items-center flex-wrap gap-2 pt-2">
                  {selectedDeviceId && (
                    <button
                      type="button"
                      disabled={isPushing}
                      onClick={() => handlePushExisting(selectedDeviceId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-500/50 transition disabled:opacity-50"
                    >
                      {isPushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>PUSH TO {selectedDeviceName || 'DEVICE'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isPushing}
                    onClick={() => handlePushExisting('all')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/50 transition disabled:opacity-50"
                  >
                    {isPushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>PUSH TO ALL ONLINE PHONES</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs font-mono text-slate-500">
                No APK uploaded yet. Upload your first APK release below.
              </div>
            )}
          </div>

          {/* Upload New APK Form */}
          <form onSubmit={handleUpload} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-mono font-bold text-slate-300 mb-1.5">
                Select New EDR APK File (.apk)
              </label>
              <input
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                onChange={(e) => setApkFile(e.target.files?.[0] || null)}
                className="block w-full text-xs font-mono text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-cyan-500/40 file:text-xs file:font-mono file:font-bold file:bg-cyan-950/70 file:text-cyan-200 hover:file:bg-cyan-900 cursor-pointer bg-slate-900/60 border border-slate-800 rounded-xl p-1.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono font-bold text-slate-300 mb-1">
                  Version Code (integer)
                </label>
                <input
                  type="number"
                  min={1}
                  value={versionCode}
                  onChange={(e) => setVersionCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-white focus:border-cyan-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono font-bold text-slate-300 mb-1">
                  Version Name
                </label>
                <input
                  type="text"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  placeholder="3.4.0"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-white focus:border-cyan-500 outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono font-bold text-slate-300 mb-1">
                Release Notes (optional)
              </label>
              <input
                type="text"
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder="Bug fixes & sensor optimization"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-white focus:border-cyan-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono font-bold text-slate-300 mb-1">
                Signature Checksum (URL-safe Base64 for Enterprise QR)
              </label>
              <input
                type="text"
                value={signatureChecksum}
                onChange={(e) => setSignatureChecksum(e.target.value)}
                placeholder={DEFAULT_RELEASE_CHECKSUM}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono text-cyan-200 focus:border-cyan-500 outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-mono text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pushToAll}
                onChange={(e) => setPushToAll(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500"
              />
              <span>Push update immediately to all ONLINE phones after upload</span>
            </label>

            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-700/60 text-rose-200 text-xs font-mono flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-white hover:bg-slate-900 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUploading || !apkFile}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)] transition disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>UPLOADING APK...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>UPLOAD RELEASE</span>
                  </>
                )}
              </button>
            </div>
          </form>
            </>
          ) : (
            <div className="space-y-4">
              {!qrData?.hasApk && !isLoadingQr && (
                <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/50 text-amber-200 text-xs font-mono flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">No Release APK Uploaded Yet</div>
                    <div className="text-[11px] text-amber-300/90 mt-0.5">
                      Upload the signed <code className="text-white">app-release.apk</code> on the <button type="button" onClick={() => setActiveTab('upload')} className="underline text-cyan-300 font-bold">Upload & Push OTA</button> tab first so Android setup has a live APK URL to download.
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-white border-2 border-emerald-500/40 shadow-inner min-h-[250px]">
                  {isLoadingQr ? (
                    <div className="flex flex-col items-center gap-2 text-slate-600 text-xs font-mono">
                      <Loader2 className="w-6 h-6 animate-spin text-cyan-600" />
                      <span>Generating QR...</span>
                    </div>
                  ) : qrImageUrl ? (
                    <img src={qrImageUrl} alt="Android Enterprise Device Owner QR" className="w-56 h-56" />
                  ) : (
                    <span className="text-xs font-mono text-slate-500">QR unavailable</span>
                  )}
                </div>

                <div className="space-y-2.5 text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-bold uppercase text-[11px]">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Zero-Tap Silent OTA Provisioning</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                    <li>Factory-reset the target company/client phone (must be at Welcome screen).</li>
                    <li>Tap an empty area of the Welcome screen <span className="text-white font-bold">6 times</span> rapidly until QR scanner opens.</li>
                    <li>Connect to <span className="text-white font-bold">Wi-Fi</span> and scan this QR code. Android auto-installs Phone EDR as <span className="text-emerald-300 font-bold">Device Owner</span>.</li>
                  </ol>
                  {qrData?.latestRelease && (
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-300">
                      APK: <span className="text-cyan-300">{qrData.latestRelease.filename}</span> (v{qrData.latestRelease.versionName})
                    </div>
                  )}
                </div>
              </div>

              {/* Optional Server URL / Checksum Override */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 mb-1">
                    Server URL Override (optional)
                  </label>
                  <input
                    type="text"
                    value={qrServerUrl}
                    onChange={(e) => setQrServerUrl(e.target.value)}
                    placeholder="Auto (https://phone-edr-central.onrender.com)"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-white focus:border-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 mb-1">
                    Signing Checksum
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={qrChecksum}
                      onChange={(e) => setQrChecksum(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-300 focus:border-emerald-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => loadProvisioningQr(qrServerUrl, qrChecksum)}
                      title="Regenerate QR"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingQr ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* QR JSON Payload & ADB Fallback */}
              {qrData?.qrString && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                      Android Enterprise Provisioning JSON
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText('qrjson', qrData.qrString)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-300 hover:text-cyan-200"
                    >
                      {copiedKey === 'qrjson' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'qrjson' ? 'Copied' : 'Copy QR JSON'}</span>
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-28">
                    {JSON.stringify(qrData.qrPayload, null, 2)}
                  </pre>
                </div>
              )}

              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                    ADB Fallback (Phone with no Google/Work accounts added)
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText('adb', 'adb shell dpm set-device-owner com.edr.agent/.admin.EdrDeviceAdminReceiver')}
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-300 hover:text-cyan-200"
                  >
                    {copiedKey === 'adb' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'adb' ? 'Copied' : 'Copy ADB Command'}</span>
                  </button>
                </div>
                <code className="block text-[11px] font-mono text-emerald-300 break-all">
                  adb shell dpm set-device-owner com.edr.agent/.admin.EdrDeviceAdminReceiver
                </code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
