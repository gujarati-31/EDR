import React, { useState } from 'react';
import { Shield, Lock, User, Eye, EyeOff, AlertCircle, LogIn, CheckCircle2 } from 'lucide-react';

/**
 * ============================================================================
 * 🔐 CONFIGURE YOUR ADMIN CREDENTIALS HERE
 * You can change your username and password right below:
 * ============================================================================
 */
export const ADMIN_CREDENTIALS = {
  username: 'test',      // <-- ENTER YOUR USERNAME HERE
  password: 'tesT@PriT@07' // <-- ENTER YOUR PASSWORD HERE
};
// ============================================================================

interface LoginPageProps {
  onLogin: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const inputUser = username.trim();
    const inputPass = password;

    if (!inputUser || !inputPass) {
      setError('Please enter both username and password.');
      return;
    }

    setIsLoading(true);

    // Validate against configured credentials
    setTimeout(() => {
      if (
        inputUser === ADMIN_CREDENTIALS.username &&
        inputPass === ADMIN_CREDENTIALS.password
      ) {
        if (rememberMe) {
          localStorage.setItem('edr_auth', 'true');
        } else {
          sessionStorage.setItem('edr_auth', 'true');
        }
        onLogin();
      } else {
        setError('Invalid username or password. Access denied.');
        setIsLoading(false);
      }
    }, 300);
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Cyber Ambient Glows */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-slate-900/90 border border-cyan-900/50 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] backdrop-blur-xl p-6 sm:p-8 relative z-10">
        
        {/* Header with Cyber Shield */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="relative p-3.5 bg-gradient-to-br from-cyan-950 to-slate-900 text-cyan-400 rounded-2xl border border-cyan-500/40 shadow-[0_0_25px_rgba(6,182,212,0.3)] mb-3.5">
            <Shield className="w-9 h-9 text-cyan-400" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-wider text-white uppercase font-mono">
              CYBER-EDR <span className="text-cyan-400 font-normal">CONSOLE</span>
            </h1>
          </div>
          <p className="text-xs font-mono text-cyan-300/80 mt-1 uppercase tracking-widest">
            Restricted Admin Access
          </p>
          <div className="mt-2 text-[11px] text-slate-400 max-w-xs">
            Enter your administrative credentials to manage endpoint devices &amp; security vault.
          </div>
        </div>

        {/* Error Alert Banner */}
        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-950/80 border border-rose-700/60 text-rose-200 text-xs font-mono flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username Field */}
          <div>
            <label className="block text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Admin Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <User className="w-4 h-4 text-cyan-400/70" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoFocus
                autoComplete="username"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all"
              />
            </div>
          </div>

          {/* Password Field */}
          <div>
            <label className="block text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Admin Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4 text-cyan-400/70" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                className="w-full pl-10 pr-11 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition"
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember Session Checkbox */}
          <div className="flex items-center justify-between text-xs pt-1">
            <label className="flex items-center gap-2 text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-500/30 w-3.5 h-3.5 accent-cyan-500"
              />
              <span className="font-mono text-[11px]">Keep me signed in</span>
            </label>
            <span className="text-[10px] font-mono text-cyan-400/60 uppercase">
              Encrypted Session
            </span>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-slate-950 font-mono font-bold text-sm tracking-wider uppercase transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In to EDR Console</span>
              </>
            )}
          </button>
        </form>

        {/* Security Footer Note */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
          <p className="text-[10px] font-mono text-slate-500 flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>Authorized Administrator Personnel Only</span>
          </p>
        </div>
      </div>
    </div>
  );
};
