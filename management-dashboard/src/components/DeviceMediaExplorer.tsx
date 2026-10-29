import React, { useState, useEffect, useCallback } from 'react';
import {
  Image as ImageIcon,
  Video,
  Folder,
  Search,
  Download,
  Maximize2,
  X,
  RefreshCw,
  HardDrive,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileQuestion,
  Loader2,
} from 'lucide-react';
import { api } from '../services/api';

interface MediaItem {
  id: string;
  name: string;
  type: 'IMAGE' | 'VIDEO';
  mimeType: string;
  size: number;
  dateModified: number;
  width: number;
  height: number;
  duration: number;
  bucket: string;
  thumbnail: string;
}

interface DeviceMediaExplorerProps {
  deviceId: string;
  isOnline: boolean;
}

export const DeviceMediaExplorer: React.FC<DeviceMediaExplorerProps> = ({ deviceId, isOnline }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [totalVideos, setTotalVideos] = useState(0);
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'IMAGE' | 'VIDEO'>('ALL');
  const [bucketFilter, setBucketFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 48;

  // Selected item for full modal viewing
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [isMediaLoading, setIsMediaLoading] = useState(false);

  const fetchMedia = useCallback(async () => {
    if (!isOnline) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api.getLiveDeviceMediaList(deviceId, {
        type: typeFilter,
        bucket: bucketFilter === 'ALL' ? undefined : bucketFilter,
        search: searchQuery.trim() || undefined,
        offset: page * pageSize,
        limit: pageSize,
      });

      setItems(data.items || []);
      setTotalCount(data.totalMatched || 0);
      setTotalImages(data.totalImages || 0);
      setTotalVideos(data.totalVideos || 0);
      setBuckets(data.buckets || {});
    } catch (err: any) {
      setError(err.message || 'Failed retrieving live media from phone');
    } finally {
      setLoading(false);
    }
  }, [deviceId, isOnline, typeFilter, bucketFilter, searchQuery, page]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDuration = (ms: number) => {
    if (!ms || ms <= 0) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return 'Unknown';
    const d = new Date(timestamp);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDownload = (item: MediaItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const url = api.getLiveMediaFileUrl(deviceId, item.id, item.type, true);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      {/* Top Banner / Cyber Header */}
      <div className="cyber-card p-6 bg-gradient-to-r from-gray-900 via-[#0a0f1d] to-[#071224] border border-cyan-500/20 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-56 h-56 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <HardDrive className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-wider text-white">LIVE PHONE GALLERY & VIDEOS</h2>
                  <span className="px-2.5 py-0.5 text-[10px] font-mono tracking-widest uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
                    Zero Server Storage
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Browse and stream every photo and video on the phone in real-time. Ephemeral RAM stream &bull; 0 bytes stored on server.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900/80 border border-gray-800 text-xs text-gray-300">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
              <span className="font-mono">{isOnline ? 'DEVICE ONLINE' : 'DEVICE OFFLINE'}</span>
            </div>

            <button
              onClick={() => fetchMedia()}
              disabled={loading || !isOnline}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs font-medium transition disabled:opacity-50"
              title="Refresh Media from Phone"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Gallery</span>
            </button>
          </div>
        </div>

        {/* Live Storage & Media Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-gray-800/80 text-xs">
          <div className="p-2.5 rounded-lg bg-gray-950/50 border border-gray-800/60">
            <span className="text-gray-400 text-[11px] block">Total Media on Phone</span>
            <span className="text-white font-mono text-base font-bold">{totalImages + totalVideos}</span>
            <span className="text-gray-400 text-[10px] ml-1.5">files</span>
          </div>

          <div className="p-2.5 rounded-lg bg-gray-950/50 border border-gray-800/60">
            <span className="text-cyan-400 text-[11px] flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> Photos
            </span>
            <span className="text-cyan-300 font-mono text-base font-bold">{totalImages}</span>
            <span className="text-gray-400 text-[10px] ml-1.5">photos</span>
          </div>

          <div className="p-2.5 rounded-lg bg-gray-950/50 border border-gray-800/60">
            <span className="text-purple-400 text-[11px] flex items-center gap-1">
              <Video className="w-3 h-3" /> Videos
            </span>
            <span className="text-purple-300 font-mono text-base font-bold">{totalVideos}</span>
            <span className="text-gray-400 text-[10px] ml-1.5">videos</span>
          </div>

          <div className="p-2.5 rounded-lg bg-gray-950/50 border border-gray-800/60">
            <span className="text-emerald-400 text-[11px] flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Server Disk Usage
            </span>
            <span className="text-emerald-300 font-mono text-base font-bold">0.00 MB</span>
            <span className="text-emerald-400/80 text-[10px] ml-1.5 font-mono">(Direct Proxy)</span>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="cyber-card p-4 bg-gray-900/60 border border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Media Type Tabs */}
        <div className="flex items-center gap-1 p-1 bg-gray-950/80 rounded-lg border border-gray-800 self-start">
          <button
            onClick={() => { setTypeFilter('ALL'); setPage(0); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              typeFilter === 'ALL'
                ? 'bg-cyan-500 text-black font-semibold shadow-sm'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            All Media ({totalImages + totalVideos})
          </button>
          <button
            onClick={() => { setTypeFilter('IMAGE'); setPage(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              typeFilter === 'IMAGE'
                ? 'bg-cyan-500 text-black font-semibold shadow-sm'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Photos ({totalImages})
          </button>
          <button
            onClick={() => { setTypeFilter('VIDEO'); setPage(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              typeFilter === 'VIDEO'
                ? 'bg-cyan-500 text-black font-semibold shadow-sm'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            Videos ({totalVideos})
          </button>
        </div>

        {/* Search & Folder/Bucket Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Folder/Bucket Dropdown */}
          <div className="flex items-center gap-1.5 bg-gray-950/80 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-300">
            <Folder className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={bucketFilter}
              onChange={(e) => { setBucketFilter(e.target.value); setPage(0); }}
              className="bg-transparent text-gray-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-gray-900 text-white">All Folders ({Object.keys(buckets).length})</option>
              {Object.entries(buckets).map(([name, count]) => (
                <option key={name} value={name} className="bg-gray-900 text-white">
                  {name} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search filename..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
              className="pl-8 pr-3 py-1.5 bg-gray-950/80 border border-gray-800 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 w-48"
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {!isOnline ? (
        <div className="cyber-card p-12 text-center border border-yellow-500/20 bg-yellow-950/10">
          <AlertCircle className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white uppercase tracking-wider">Device is Offline</h3>
          <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
            Live photos and videos reside solely on the physical device and are never copied to server storage.
            When the device connects to the network, you can browse all files instantly.
          </p>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-gray-900/60 border border-gray-800 animate-pulse flex flex-col justify-end p-2">
              <div className="h-3 w-3/4 bg-gray-800 rounded mb-1" />
              <div className="h-2 w-1/2 bg-gray-800/60 rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="cyber-card p-8 text-center border border-red-500/20 bg-red-950/10">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => fetchMedia()}
            className="mt-3 px-4 py-1.5 text-xs rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="cyber-card p-12 text-center border border-gray-800">
          <FileQuestion className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <h4 className="text-sm font-semibold text-gray-300">No Media Found</h4>
          <p className="text-xs text-gray-500 mt-1">No photos or videos matched your search or folder filter.</p>
          {(bucketFilter !== 'ALL' || searchQuery) && (
            <button
              onClick={() => { setBucketFilter('ALL'); setSearchQuery(''); setPage(0); }}
              className="mt-3 text-xs text-cyan-400 underline hover:text-cyan-300"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Media Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedMedia(item)}
                className="group relative rounded-xl overflow-hidden bg-gray-950 border border-gray-800/80 hover:border-cyan-500/60 transition cursor-pointer shadow-lg hover:shadow-cyan-500/10"
              >
                {/* Media Thumbnail Container */}
                <div className="aspect-square w-full bg-gray-900 relative flex items-center justify-center overflow-hidden">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : item.type === 'VIDEO' ? (
                    <div className="flex flex-col items-center justify-center text-purple-400">
                      <Video className="w-8 h-8 opacity-70" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-gray-600">
                      <ImageIcon className="w-8 h-8 opacity-50" />
                    </div>
                  )}

                  {/* Top Type & Duration Badge */}
                  <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between pointer-events-none">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wide font-semibold flex items-center gap-1 shadow-sm ${
                        item.type === 'VIDEO'
                          ? 'bg-purple-950/80 text-purple-300 border border-purple-500/40'
                          : 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/40'
                      }`}
                    >
                      {item.type === 'VIDEO' ? <Video className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                      {item.type === 'VIDEO' ? formatDuration(item.duration) : 'PHOTO'}
                    </span>

                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-black/70 text-gray-300 border border-gray-700/60">
                      {item.bucket || 'Storage'}
                    </span>
                  </div>

                  {/* Hover Overlay with Action Buttons */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedMedia(item); }}
                      className="p-2 rounded-full bg-cyan-500 text-black hover:bg-cyan-400 shadow-md transition"
                      title="View / Play"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleDownload(item, e)}
                      className="p-2 rounded-full bg-gray-800 text-white hover:bg-gray-700 border border-gray-600 shadow-md transition"
                      title="Download to PC"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Footer Metadata */}
                <div className="p-2 bg-gradient-to-t from-gray-950 via-gray-950 to-gray-900/90 border-t border-gray-800/60">
                  <p className="text-[11px] font-medium text-gray-200 truncate" title={item.name}>
                    {item.name}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 mt-1">
                    <span>{formatBytes(item.size)}</span>
                    <span>{formatDate(item.dateModified)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between py-3 border-t border-gray-800/80 text-xs">
              <span className="text-gray-400 font-mono">
                Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalCount)} of {totalCount} items
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                  disabled={page === 0}
                  className="px-3 py-1 rounded bg-gray-900 border border-gray-800 text-gray-300 hover:text-white disabled:opacity-40 transition flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>

                <span className="font-mono text-gray-300 px-2">
                  Page {page + 1} of {totalPages}
                </span>

                <button
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages - 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 rounded bg-gray-900 border border-gray-800 text-gray-300 hover:text-white disabled:opacity-40 transition flex items-center gap-1"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full Resolution On-Demand Media Modal */}
      {selectedMedia && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-5xl bg-[#090d16] border border-cyan-500/30 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-gray-950/80">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${selectedMedia.type === 'VIDEO' ? 'bg-purple-500/20 text-purple-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                  {selectedMedia.type === 'VIDEO' ? <Video className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white truncate max-w-md" title={selectedMedia.name}>
                    {selectedMedia.name}
                  </h3>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400">
                    <span className="text-emerald-400">Live Device Stream</span>
                    <span>&bull;</span>
                    <span>{formatBytes(selectedMedia.size)}</span>
                    {selectedMedia.width > 0 && (
                      <>
                        <span>&bull;</span>
                        <span>{selectedMedia.width}x{selectedMedia.height}</span>
                      </>
                    )}
                    <span>&bull;</span>
                    <span>{formatDate(selectedMedia.dateModified)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(selectedMedia)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-white border border-gray-700 transition"
                  title="Download File directly to your computer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <button
                  onClick={() => setSelectedMedia(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Media Player / Viewer */}
            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden relative min-h-[400px]">
              {selectedMedia.type === 'VIDEO' ? (
                <video
                  controls
                  autoPlay
                  className="max-h-[70vh] max-w-full rounded"
                  src={api.getLiveMediaFileUrl(deviceId, selectedMedia.id, 'VIDEO')}
                >
                  Your browser does not support HTML5 video streaming.
                </video>
              ) : (
                <>
                  {isMediaLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 z-10">
                      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                      <span className="text-xs font-mono text-cyan-300">Streaming image bytes from phone...</span>
                    </div>
                  )}
                  <img
                    src={api.getLiveMediaFileUrl(deviceId, selectedMedia.id, 'IMAGE')}
                    alt={selectedMedia.name}
                    className="max-h-[70vh] max-w-full object-contain select-none"
                    onLoadStart={() => setIsMediaLoading(true)}
                    onLoad={() => setIsMediaLoading(false)}
                    onError={() => setIsMediaLoading(false)}
                  />
                </>
              )}
            </div>

            {/* Modal Footer / Telemetry Bar */}
            <div className="px-5 py-2.5 bg-gray-950/90 border-t border-gray-800/80 flex flex-wrap items-center justify-between text-[11px] font-mono text-gray-400">
              <div className="flex items-center gap-4">
                <span>Folder: <span className="text-gray-200">{selectedMedia.bucket}</span></span>
                <span>MIME: <span className="text-cyan-300">{selectedMedia.mimeType}</span></span>
                <span>Media ID: <span className="text-gray-300">{selectedMedia.id}</span></span>
              </div>
              <div className="text-emerald-400 text-[10px] flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                <span>Zero Server Storage: Streamed directly through Gateway RAM</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
