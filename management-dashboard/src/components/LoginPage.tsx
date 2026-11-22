import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Lock,
  Fingerprint,
  AlertCircle,
  CheckCircle2,
  Key,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../services/api';
import {
  authenticatePlatformPasskey,
} from '../services/biometricService';
import { AuthStatus } from '../types';

interface LoginPageProps {
  onLogin: (sessionToken: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  // Authentication & System State
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);

  // Flow & Step Navigation: 'BIOMETRIC' | 'RECOVERY' | 'NOT_ENROLLED'
  const [authStep, setAuthStep] = useState<'BIOMETRIC' | 'RECOVERY' | 'NOT_ENROLLED'>('BIOMETRIC');

  // Fingerprint / Biometric State
  const [isVerifyingBiometric, setIsVerifyingBiometric] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [biometricStatusText, setBiometricStatusText] = useState<string>(
    'Touch your fingerprint sensor or platform authenticator'
  );
  const [isSuccess, setIsSuccess] = useState(false);

  // Emergency Recovery Modal State
  const [recoveryInput, setRecoveryInput] = useState('');
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Lockout & Error Notifications
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [lockCountdownSec, setLockCountdownSec] = useState<number>(0);

  // 1. Load Initial Authentication Status from Server
  const loadStatus = async () => {
    try {
      setIsLoadingStatus(true);
      setGeneralError(null);
      const status = await api.getAuthStatus();
      setAuthStatus(status);

      if (!status.isEnrolled) {
        setAuthStep('NOT_ENROLLED');
      } else {
        setAuthStep('BIOMETRIC');
      }

      if (status.isLocked && status.lockExpiresInMs > 0) {
        setLockCountdownSec(Math.ceil(status.lockExpiresInMs / 1000));
      }
    } catch (err: any) {
      setGeneralError(`Failed to connect to authentication server: ${err.message}`);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // Lockout Countdown Timer
  useEffect(() => {
    if (lockCountdownSec <= 0) return;
    const interval = setInterval(() => {
      setLockCountdownSec((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          loadStatus();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockCountdownSec]);

  // ============================================================================
  // BIOMETRIC / FINGERPRINT VERIFICATION VIA WEBAUTHN
  // ============================================================================
  const handleVerifyBiometric = async () => {
    if (isVerifyingBiometric || lockCountdownSec > 0) return;

    setIsVerifyingBiometric(true);
    setBiometricError(null);
    setGeneralError(null);
    setBiometricStatusText('Initializing biometric challenge...');

    try {
      // 1. Request WebAuthn Challenge from Server
      const challengeRes = await api.getFingerprintChallenge();
      if (!challengeRes.success || !challengeRes.data) {
        throw new Error(challengeRes.error || 'Failed to initialize biometric challenge');
      }

      const { challenge, credentialId, challengeId } = challengeRes.data;

      setBiometricStatusText('Awaiting fingerprint sensor touch / Windows Hello / Touch ID...');

      // 2. Invoke browser/device platform biometric prompt (Fingerprint / Touch ID / Windows Hello)
      const assertion = await authenticatePlatformPasskey(challenge, credentialId);

      setBiometricStatusText('Verifying biometric credential with central server...');

      // 3. Send Assertion to Server for final verification
      const verifyRes = await api.verifyFingerprint(assertion, challengeId, challenge);

      if (!verifyRes.success || !verifyRes.token) {
        if (verifyRes.isLocked) {
          loadStatus();
        }
        throw new Error(verifyRes.error || 'Biometric verification failed.');
      }

      // 4. Success!
      setIsSuccess(true);
      setBiometricStatusText('Biometric Verified! Access Granted.');
      sessionStorage.setItem('edr_auth', 'true');
      sessionStorage.setItem('edr_token', verifyRes.token);

      setTimeout(() => {
        onLogin(verifyRes.token!);
      }, 500);
    } catch (err: any) {
      console.error('[Biometric] Verification error:', err);
      const msg = err.message || 'Biometric verification cancelled or failed.';
      setBiometricError(msg);
      setBiometricStatusText('Biometric cancelled or failed. Touch below to retry.');
    } finally {
      setIsVerifyingBiometric(false);
    }
  };

  // Auto-prompt fingerprint scanner when on BIOMETRIC step
  const hasAutoPromptedRef = useRef(false);
  useEffect(() => {
    if (
      authStep === 'BIOMETRIC' &&
      !hasAutoPromptedRef.current &&
      !isLoadingStatus &&
      lockCountdownSec === 0 &&
      authStatus?.isEnrolled
    ) {
      hasAutoPromptedRef.current = true;
      const timer = setTimeout(() => {
        handleVerifyBiometric();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [authStep, isLoadingStatus, lockCountdownSec, authStatus]);

  // ============================================================================
  // EMERGENCY RECOVERY HANDLER
  // ============================================================================
  const handleEmergencyRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryInput.trim()) return;

    setIsSubmittingRecovery(true);
    setRecoveryError(null);

    try {
      const res = await api.emergencyRecover(recoveryInput.trim());
      if (!res.success || !res.token) {
        throw new Error(res.error || 'Invalid emergency recovery key.');
      }

      sessionStorage.setItem('edr_auth', 'true');
      sessionStorage.setItem('edr_token', res.token);
      onLogin(res.token);
    } catch (err: any) {
      setRecoveryError(err.message || 'Recovery key verification failed.');
    } finally {
      setIsSubmittingRecovery(false);
    }
  };

  // Format lockout timer MM:SS
  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (isLoadingStatus) {
    return (
      <div className="min-h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="relative p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-400 mb-4 animate-pulse">
          <Fingerprint className="w-10 h-10 animate-spin" />
        </div>
        <p className="text-xs font-mono text-cyan-300 tracking-widest uppercase">
          Initializing Biometric Security Module...
        </p>
      </div>
    );
  }

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
            <span>Biometric Fingerprint Authentication</span>
          </div>
        </div>

        {/* Global Error Banner */}
        {generalError && (
          <div className="mb-5 p-3 rounded-xl bg-rose-950/80 border border-rose-700/60 text-rose-200 text-xs font-mono flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span className="flex-1">{generalError}</span>
          </div>
        )}

        {/* Account Lockout Notice */}
        {lockCountdownSec > 0 && (
          <div className="mb-5 p-4 rounded-2xl bg-amber-950/70 border border-amber-600/70 text-amber-200 text-xs font-mono flex flex-col items-center text-center gap-2">
            <ShieldAlert className="w-7 h-7 text-amber-400 animate-pulse" />
            <span className="font-bold text-amber-300 uppercase tracking-wide">
              Security Lockout Active
            </span>
            <p className="text-[11px] text-amber-200/80">
              5 consecutive verification failures detected. Access is temporarily locked.
            </p>
            <div className="text-lg font-mono font-bold text-amber-400 bg-black/40 px-3 py-1 rounded-lg border border-amber-500/40">
              {formatTimer(lockCountdownSec)}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              If your biometric sensor is impaired, use your offline emergency recovery key below.
            </p>
          </div>
        )}

        {/* ================================================================== */}
        {/* VIEW 0: ENROLLMENT REQUIRED (LOCAL PROVISIONING ONLY)              */}
        {/* ================================================================== */}
        {authStep === 'NOT_ENROLLED' && (
          <div className="space-y-5 text-center">
            <div className="inline-flex p-3.5 rounded-2xl bg-amber-950/60 border border-amber-600/50 text-amber-400">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Admin Biometrics Not Enrolled
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                For zero-trust security, remote registration from the web browser is disabled. Please run the local Python provisioning script directly on the server to register your biometric credentials:
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-black/80 border border-slate-800 text-left font-mono">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 flex items-center justify-between">
                <span>Terminal CLI Command</span>
                <span className="text-cyan-400">Server Host Only</span>
              </div>
              <div className="text-xs text-cyan-300 font-bold select-all bg-slate-900/90 px-3 py-2 rounded-lg border border-cyan-900/40">
                python register_admin.py
              </div>
            </div>

            <button
              type="button"
              onClick={loadStatus}
              className="w-full py-3.5 rounded-xl font-mono text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-slate-950 shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Check Enrollment Status</span>
            </button>
          </div>
        )}

        {/* ================================================================== */}
        {/* VIEW 1: DIRECT BIOMETRIC / FINGERPRINT LOGIN                       */}
        {/* ================================================================== */}
        {authStep === 'BIOMETRIC' && (
          <div className="space-y-6 text-center">
            <div>
              <h3 className="text-base font-mono font-bold text-white uppercase tracking-wider">
                Touch Biometric Sensor
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Touch your fingerprint sensor, Touch ID, or Windows Hello platform authenticator.
              </p>
            </div>

            {/* Glowing Concentric Fingerprint Visual */}
            <div className="p-10 rounded-3xl bg-cyan-950/20 border border-cyan-500/30 flex flex-col items-center justify-center gap-4 relative overflow-hidden">
              {/* Outer pulsing ring */}
              <div
                className={`absolute w-44 h-44 rounded-full border border-cyan-500/20 transition-all duration-700 pointer-events-none ${
                  isVerifyingBiometric ? 'animate-ping opacity-60' : 'opacity-20'
                }`}
              />
              {/* Middle ring */}
              <div
                className={`absolute w-36 h-36 rounded-full border border-cyan-400/30 transition-all duration-500 pointer-events-none ${
                  isVerifyingBiometric ? 'animate-pulse' : ''
                }`}
              />

              <div
                className={`relative p-7 rounded-full border transition-all duration-300 ${
                  isSuccess
                    ? 'bg-emerald-950/80 border-emerald-400 text-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.6)]'
                    : isVerifyingBiometric
                    ? 'bg-cyan-950/90 border-cyan-400 text-cyan-300 shadow-[0_0_40px_rgba(6,182,212,0.5)]'
                    : 'bg-cyan-950/60 border-cyan-500/50 text-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.3)] hover:scale-105 cursor-pointer'
                }`}
                onClick={handleVerifyBiometric}
              >
                {isSuccess ? (
                  <CheckCircle2 className="w-16 h-16 text-emerald-400 animate-in zoom-in" />
                ) : (
                  <Fingerprint
                    className={`w-16 h-16 ${
                      isVerifyingBiometric ? 'animate-pulse text-cyan-300' : 'text-cyan-400'
                    }`}
                  />
                )}
              </div>

              <div className="text-xs font-mono text-cyan-300 max-w-xs transition-all">
                {biometricStatusText}
              </div>
            </div>

            {biometricError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs font-mono text-left">
                {biometricError}
              </div>
            )}

            <button
              type="button"
              onClick={handleVerifyBiometric}
              disabled={isVerifyingBiometric || lockCountdownSec > 0 || isSuccess}
              className="w-full py-3.5 rounded-xl font-mono text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-emerald-600 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400 text-slate-950 shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {isVerifyingBiometric ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Awaiting Biometric Touch...</span>
                </>
              ) : isSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Access Granted</span>
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4" />
                  <span>Touch Sensor to Login</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ================================================================== */}
        {/* VIEW 2: EMERGENCY OFFLINE RECOVERY KEY MODAL / FORM                */}
        {/* ================================================================== */}
        {authStep === 'RECOVERY' && (
          <form onSubmit={handleEmergencyRecover} className="space-y-4">
            <div className="text-center">
              <div className="inline-flex p-2.5 rounded-xl bg-amber-950/60 border border-amber-600/50 text-amber-400 mb-2">
                <Key className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Emergency Recovery Access
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Enter your 24-character offline recovery key saved during enrollment.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">
                Recovery Key (Format: EDR-XXXX-XXXX-XXXX-XXXX)
              </label>
              <input
                type="text"
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
                placeholder="EDR-XXXX-XXXX-XXXX-XXXX"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-amber-300 font-mono text-sm tracking-widest placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition"
              />
            </div>

            {recoveryError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs font-mono">
                {recoveryError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingRecovery || !recoveryInput.trim()}
              className="w-full py-3.5 rounded-xl font-mono text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 shadow-[0_0_25px_rgba(245,158,11,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {isSubmittingRecovery ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Key...</span>
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Authenticate with Recovery Key</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setRecoveryError(null);
                setAuthStep('BIOMETRIC');
              }}
              className="w-full py-2 text-xs font-mono text-slate-400 hover:text-cyan-400 transition text-center"
            >
              &larr; Back to Biometric Fingerprint Login
            </button>
          </form>
        )}

        {/* Footer Navigation / Recovery Link */}
        {authStep !== 'RECOVERY' && authStep !== 'NOT_ENROLLED' && (
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <button
              type="button"
              onClick={() => setAuthStep('RECOVERY')}
              className="hover:text-amber-400 transition flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5 text-amber-400/80" />
              <span>Use Offline Recovery Key</span>
            </button>

            <span className="text-[10px] text-slate-500">AES-256 Encrypted</span>
          </div>
        )}
      </div>
    </div>
  );
};
