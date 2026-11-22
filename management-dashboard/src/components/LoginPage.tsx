import React, { useState } from 'react';
import {
  Shield,
  Lock,
  User,
  AlertCircle,
  Eye,
  EyeOff,
  LogIn,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';

interface LoginPageProps {
  onLogin: (sessionToken: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await api.login(username.trim(), password.trim());
      if (!res.success || !res.token) {
        throw new Error(res.error || 'Invalid credentials.');
      }

      sessionStorage.setItem('edr_auth', 'true');
      sessionStorage.setItem('edr_token', res.token);
      sessionStorage.setItem('edr_auth_time', Date.now().toString());
      onLogin(res.token);
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
      {/* Cyber Ambient Background Glows */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Glassmorphic Security Container */}
      <div className="w-full max-w-md bg-slate-900/90 border border-cyan-900/60 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.15)] backdrop-blur-2xl p-6 sm:p-8 relative z-10">
        
        {/* Top Header Badge */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative p-3.5 bg-gradient-to-br from-cyan-950 to-slate-900 text-cyan-400 rounded-2xl border border-cyan-500/40 shadow-[0_0_25px_rgba(6,182,212,0.3)] mb-3">
            <Shield className="w-8 h-8 text-cyan-400" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
            </span>
          </div>

          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-wider text-white uppercase font-mono">
              CYBER-EDR <span className="text-cyan-400 font-normal">CONSOLE</span>
            </h1>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 mt-1.5 rounded-full bg-cyan-950/80 border border-cyan-800/60 text-[10px] font-mono text-cyan-300 uppercase tracking-widest">
            <Lock className="w-3 h-3 text-cyan-400" />
            <span>Administrator Login</span>
          </div>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="mb-5 p-3 rounded-xl bg-rose-950/80 border border-rose-700/60 text-rose-200 text-xs font-mono flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">
              Admin Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter admin username"
                autoFocus
                disabled={isSubmitting}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs tracking-wider placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">
              Admin Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                disabled={isSubmitting}
                className="w-full pl-10 pr-10 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs tracking-wider placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 transition disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !username.trim() || !password.trim()}
            className="w-full mt-2 py-3.5 rounded-xl font-mono text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-slate-950 shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98]"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In to EDR Console</span>
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
          <span>Protected by AES-256</span>
          <span>CYBER-EDR v3.0</span>
        </div>
      </div>
    </div>
  );
};
