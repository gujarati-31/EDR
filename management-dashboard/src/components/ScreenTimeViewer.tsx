import React, { useEffect, useState } from 'react';
import { Clock, Calendar, ChevronLeft, ChevronRight, Activity } from 'lucide-react';
import { AppUsage } from '../types';
import { api } from '../services/api';
import { AppLogo } from './AppLogo';

interface ScreenTimeViewerProps {
  deviceId: string;
}

export const ScreenTimeViewer: React.FC<ScreenTimeViewerProps> = ({ deviceId }) => {
  const [usageData, setUsageData] = useState<AppUsage[]>([]);
  const [totalFormatted, setTotalFormatted] = useState('0h 0m');
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const loadUsageForDate = async (targetDate?: string) => {
    setLoading(true);
    try {
      const res = await api.getAppUsage(deviceId, targetDate || selectedDate);
      setUsageData(res.data || []);
      setTotalFormatted(res.formattedScreenTime || '0h 0m');
      setTotalSeconds(res.totalScreenTimeSeconds || 0);
      if (res.availableDates && res.availableDates.length > 0) {
        setAvailableDates(res.availableDates);
      }
      if (res.selectedDate) {
        setSelectedDate(res.selectedDate);
      }
    } catch (err) {
      console.error('Failed to load screen time usage:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      loadUsageForDate(selectedDate);
    }
  }, [deviceId, selectedDate]);

  const handlePrevDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() - 1);
    const newDateStr = cur.toISOString().split('T')[0];
    setSelectedDate(newDateStr);
  };

  const handleNextDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() + 1);
    const newDateStr = cur.toISOString().split('T')[0];
    setSelectedDate(newDateStr);
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs > 0) return `${hrs}h ${remMins}m`;
    return `${mins}m ${sec % 60}s`;
  };

  // Format date display (e.g. "Sunday, Oct 25, 2026")
  const formattedDateTitle = new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  return (
    <div className="cyber-card rounded-2xl p-6 space-y-6">
      {/* Day Selector Navigation Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-xs font-mono font-bold tracking-wider text-slate-300 uppercase flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            Daily Screen Time &amp; Digital Wellbeing
          </h2>
          <p className="text-[11px] font-mono text-slate-400 mt-0.5">
            Day-wise usage from 12:00 AM to 11:59 PM (native Android UsageStats engine)
          </p>
        </div>

        {/* Date Selector Navigation */}
        <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-xl p-1.5 shadow-inner">
          <button
            onClick={handlePrevDay}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
            title="Previous Day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2 px-3 py-1 bg-slate-900 rounded-lg border border-slate-800 text-xs">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
            />
            {isToday && (
              <span className="text-[10px] bg-blue-900/60 text-blue-300 px-1.5 py-0.2 rounded font-semibold border border-blue-700/50">
                Today
              </span>
            )}
          </div>

          <button
            onClick={handleNextDay}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
            title="Next Day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Hero Display: Total Screen Time for this day */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950/40 border border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-6 shadow-lg">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
            <Activity className="w-8 h-8 animate-pulse" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Screen Time for {formattedDateTitle}
            </div>
            <div className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 font-mono mt-1">
              {totalFormatted}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Window: 12:00:00 AM to 11:59:59 PM • {usageData.length} active apps
            </div>
          </div>
        </div>

        {/* Quick Date Pills */}
        {availableDates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-w-xs justify-end">
            {availableDates.slice(0, 5).map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDate(d)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border font-mono transition ${
                  selectedDate === d
                    ? 'bg-blue-600 text-white border-blue-500 font-semibold shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                {d === new Date().toISOString().split('T')[0] ? 'Today' : d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* App Breakdown List */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          App Activity on {selectedDate}
        </h3>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Harvesting day-wise usage stats...
          </div>
        ) : usageData.length === 0 ? (
          <div className="py-12 text-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6">
            <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-400">
              No application activity recorded for {formattedDateTitle}.
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Select another date above or click "Get Logs" on the action bar to sync.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
            {usageData.map((item, index) => {
              const percentage =
                totalSeconds > 0 ? (item.foregroundSeconds / totalSeconds) * 100 : 0;

              return (
                <div
                  key={`${item.id || item.packageName}-${item.usageDate}`}
                  className="bg-slate-950/70 border border-slate-800/80 hover:border-slate-700/80 rounded-xl p-3.5 transition flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {/* App Online Logo with Fallback */}
                      <AppLogo
                        packageName={item.packageName}
                        appName={item.appName || item.packageName}
                        size={38}
                      />

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-sm text-white">
                            {item.appName || item.packageName}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            #{index + 1}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {item.packageName}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono text-cyan-400 font-bold text-sm">
                        {formatSeconds(item.foregroundSeconds)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {percentage.toFixed(1)}% of day
                      </div>
                    </div>
                  </div>

                  {/* Visual Screen Time Bar */}
                  <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800/60">
                    <div
                      className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(Math.max(percentage, 1), 100)}%` }}
                    />
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
