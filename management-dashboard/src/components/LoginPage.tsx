import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Lock,
  Camera,
  Fingerprint,
  AlertCircle,
  CheckCircle2,
  Key,
  RefreshCw,
  Scan,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../services/api';
import {
  extractFaceFeatureVector,
  executeLivenessChallenge,
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

  // Flow & Step Navigation
  // Steps: 'FACE' (Step 1) -> 'FINGERPRINT' (Step 2) -> 'RECOVERY' | 'NOT_ENROLLED'
  const [authStep, setAuthStep] = useState<'FACE' | 'FINGERPRINT' | 'RECOVERY' | 'NOT_ENROLLED'>('FACE');
  const [faceVerificationToken, setFaceVerificationToken] = useState<string | null>(null);
  const [faceSimilarity, setFaceSimilarity] = useState<number | null>(null);

  // Camera & Face Verification State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanningFace, setIsScanningFace] = useState(false);
  const [livenessStatusText, setLivenessStatusText] = useState<string>('Align face inside the biometric frame');
  const [flashColor, setFlashColor] = useState<string | null>(null);

  // Fingerprint / WebAuthn State
  const [isVerifyingFingerprint, setIsVerifyingFingerprint] = useState(false);
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);

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
        setAuthStep('FACE');
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

  // 2. Camera Management (Start/Stop stream)
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        return; // already active
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err: any) {
      console.error('[Camera] Access error:', err);
      setCameraError(
        'Camera permission denied or camera device not found. Please allow camera access in your browser settings.'
      );
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Start camera when entering Face step
  useEffect(() => {
    if (authStep === 'FACE') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [authStep]);

  // ============================================================================
  // STEP 1: FACE VERIFICATION WITH ACTIVE LIVENESS
  // ============================================================================
  const handleVerifyFace = async () => {
    if (!videoRef.current || isScanningFace) return;
    setIsScanningFace(true);
    setGeneralError(null);

    try {
      // Execute active optical reflection challenge + micro-movement check
      const livenessResult = await executeLivenessChallenge(
        videoRef.current,
        (color) => setFlashColor(color),
        (text) => setLivenessStatusText(text)
      );

      if (!livenessResult.faceDetected) {
        setGeneralError('No face detected in the frame. Please look directly into the camera.');
        setLivenessStatusText('Face not detected. Center face in frame.');
        setIsScanningFace(false);
        return;
      }

      setLivenessStatusText('Extracting biometric signature...');
      const extraction = extractFaceFeatureVector(videoRef.current);

      setLivenessStatusText('Server verifying biometric template...');
      const response = await api.verifyFace(extraction.descriptor, {
        faceDetected: true,
        lightReflectionScore: livenessResult.lightReflectionScore,
        microMotionScore: livenessResult.microMotionScore,
        challengeTimestamp: Date.now(),
      });

      if (!response.success || !response.faceVerificationToken) {
        setGeneralError(response.error || 'Face verification failed.');
        if (response.isLocked) {
          loadStatus();
        } else if (typeof response.remainingAttempts === 'number') {
          setGeneralError(
            `${response.error || 'Identity mismatch.'} (${response.remainingAttempts} attempts remaining)`
          );
        }
        setLivenessStatusText('Verification rejected. Try again.');
        setIsScanningFace(false);
        return;
      }

      // Step 1 Success!
      setFaceVerificationToken(response.faceVerificationToken);
      setFaceSimilarity(response.similarity || 95);
      setLivenessStatusText(`Identity Verified (${response.similarity || 95}% match)`);

      // Smooth transition to Step 2 (Fingerprint)
      setTimeout(() => {
        setIsScanningFace(false);
        stopCamera();
        setAuthStep('FINGERPRINT');
      }, 700);
    } catch (err: any) {
      setGeneralError(err.message || 'An error occurred during face scan.');
      setLivenessStatusText('Scan interrupted.');
      setIsScanningFace(false);
    }
  };

  // ============================================================================
  // STEP 2: FINGERPRINT VERIFICATION VIA WEBAUTHN
  // Server strictly enforces that Step 1 must have passed!
  // ============================================================================
  const handleVerifyFingerprint = async () => {
    if (!faceVerificationToken) {
      setGeneralError('Face verification session expired. Please verify face again.');
      setAuthStep('FACE');
      return;
    }

    setIsVerifyingFingerprint(true);
    setFingerprintError(null);
    setGeneralError(null);

    try {
      // 1. Request WebAuthn Challenge from Server (server validates faceVerificationToken)
      const challengeRes = await api.getFingerprintChallenge(faceVerificationToken);
      if (!challengeRes.success || !challengeRes.data) {
        throw new Error(challengeRes.error || 'Failed to initialize fingerprint challenge');
      }

      const { challenge, credentialId } = challengeRes.data;

      // 2. Invoke browser/device platform biometric prompt (Windows Hello / Touch ID / Fingerprint)
      const assertion = await authenticatePlatformPasskey(challenge, credentialId);

      // 3. Send Assertion & Face Verification Token to Server for final verification
      const verifyRes = await api.verifyFingerprint(faceVerificationToken, assertion);

      if (!verifyRes.success || !verifyRes.token) {
        throw new Error(verifyRes.error || 'Fingerprint verification failed.');
      }

      // 4. Success! Save Session Token and Notify App
      sessionStorage.setItem('edr_auth', 'true');
      sessionStorage.setItem('edr_token', verifyRes.token);
      onLogin(verifyRes.token);
    } catch (err: any) {
      console.error('[Fingerprint] Verification error:', err);
      const msg = err.message || 'Fingerprint verification failed.';
      setFingerprintError(msg);
      setGeneralError(msg);
    } finally {
      setIsVerifyingFingerprint(false);
    }
  };

  // Auto-prompt fingerprint scanner when entering Step 2
  useEffect(() => {
    if (authStep === 'FINGERPRINT' && faceVerificationToken) {
      const timer = setTimeout(() => {
        handleVerifyFingerprint();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [authStep, faceVerificationToken]);

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

  // ============================================================================
  // RENDER: LOADING STATUS
  // ============================================================================
  if (isLoadingStatus) {
    return (
      <div className="min-h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="relative p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-400 mb-4 animate-pulse">
          <Scan className="w-10 h-10 animate-spin" />
        </div>
        <p className="text-xs font-mono text-cyan-300 tracking-widest uppercase">
          Initializing Biometric Security Module...
        </p>
      </div>
    );
  }

  // Format lockout timer MM:SS
  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
      {/* Dynamic Ambient Optical Reflection Background Flash */}
      <div
        className="fixed inset-0 pointer-events-none transition-colors duration-200 z-0"
        style={{ backgroundColor: flashColor || 'transparent' }}
      />

      {/* Cyber Ambient Background Glows */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Glassmorphic Security Container */}
      <div className="w-full max-w-lg bg-slate-900/90 border border-cyan-900/60 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.15)] backdrop-blur-2xl p-6 sm:p-8 relative z-10">
        
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
            <span>Multi-Factor Biometric Authentication</span>
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
              If your sensors are impaired, use your offline emergency recovery key below.
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
                For zero-trust security, remote registration from the web browser is disabled. Please run the local Python provisioning script directly on the server to register your face and biometric credentials:
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

            <div className="text-[11px] font-mono text-slate-500 text-left p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
              <div>&bull; Step 1: Captures face template (webcam or photo)</div>
              <div>&bull; Step 2: Configures hardware biometric authenticator</div>
              <div>&bull; Step 3: Generates encrypted emergency recovery key</div>
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
        {/* VIEW 2: SCREEN 1 - BIOMETRIC FACE VERIFICATION (CAMERA)            */}
        {/* ================================================================== */}
        {authStep === 'FACE' && (
          <div className="space-y-4">
            {/* Step Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs font-mono">
              <span className="flex items-center gap-2 text-cyan-400 font-bold">
                <Camera className="w-4 h-4 text-cyan-400" />
                <span>STEP 1: FACE VERIFICATION</span>
              </span>
              <span className="text-[11px] text-slate-500">
                {authStatus?.remainingAttempts !== undefined
                  ? `${authStatus.remainingAttempts} attempts remaining`
                  : 'Screen 1 of 2'}
              </span>
            </div>

            {/* Video Live Scanner Reticle */}
            <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-cyan-500/40 shadow-inner flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />

              {/* HUD Targeting Graphic */}
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-4">
                <div className="w-full flex justify-between text-[10px] font-mono text-cyan-400/80">
                  <span>FACIAL::RECOGNITION</span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                    LIVE
                  </span>
                </div>

                {/* Center Oval Reticle */}
                <div
                  className={`w-36 h-48 sm:w-44 sm:h-56 rounded-full border-2 border-dashed transition-all duration-300 flex items-center justify-center ${
                    isScanningFace
                      ? 'border-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.6)]'
                      : 'border-cyan-500/40'
                  }`}
                >
                  {isScanningFace && (
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-bounce" />
                  )}
                </div>

                <div className="text-[11px] font-mono text-cyan-300 bg-slate-950/85 px-3 py-1 rounded-full border border-cyan-500/30">
                  {livenessStatusText}
                </div>
              </div>
            </div>

            {cameraError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs font-mono">
                {cameraError}
              </div>
            )}

            <button
              type="button"
              onClick={handleVerifyFace}
              disabled={isScanningFace || !isCameraActive || lockCountdownSec > 0}
              className="w-full py-3.5 rounded-xl font-mono text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-slate-950 shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {isScanningFace ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Liveness &amp; Template...</span>
                </>
              ) : (
                <>
                  <Scan className="w-4 h-4" />
                  <span>Start Biometric Face Scan</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ================================================================== */}
        {/* VIEW 3: SCREEN 2 - BIOMETRIC FINGERPRINT VERIFICATION (WEBAUTHN)   */}
        {/* Server enforces: Only rendered after Screen 1 passed!              */}
        {/* ================================================================== */}
        {authStep === 'FINGERPRINT' && (
          <div className="space-y-5 text-center">
            {/* Step Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs font-mono">
              <span className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>STEP 1 PASSED ({faceSimilarity ?? 95}% MATCH)</span>
              </span>
              <span className="text-[11px] text-cyan-400 font-bold">STEP 2 OF 2</span>
            </div>

            <div>
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Touch Biometric Fingerprint Sensor
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Touch your fingerprint sensor, Touch ID, or Windows Hello platform authenticator.
              </p>
            </div>

            {/* Glowing Fingerprint Graphic */}
            <div className="p-8 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 flex flex-col items-center justify-center gap-4 relative overflow-hidden">
              <div className="absolute inset-0 bg-radial-gradient from-cyan-500/10 to-transparent pointer-events-none" />
              
              <div className="relative p-6 rounded-full bg-cyan-950/80 border border-cyan-500/50 shadow-[0_0_35px_rgba(6,182,212,0.4)]">
                <Fingerprint className="w-14 h-14 text-cyan-400 animate-pulse" />
              </div>

              <div className="text-xs font-mono text-cyan-300">
                {isVerifyingFingerprint ? 'Awaiting hardware sensor verification...' : 'Ready for fingerprint touch'}
              </div>
            </div>

            {fingerprintError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs font-mono text-left">
                {fingerprintError}
              </div>
            )}

            <button
              type="button"
              onClick={handleVerifyFingerprint}
              disabled={isVerifyingFingerprint || lockCountdownSec > 0}
              className="w-full py-3.5 rounded-xl font-mono text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-slate-950 shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {isVerifyingFingerprint ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Scanning Fingerprint...</span>
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4" />
                  <span>Retry Fingerprint Scan</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ================================================================== */}
        {/* VIEW 4: EMERGENCY OFFLINE RECOVERY KEY MODAL / FORM                */}
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
                  <UnlockIcon className="w-4 h-4" />
                  <span>Authenticate with Recovery Key</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setRecoveryError(null);
                setAuthStep('FACE');
              }}
              className="w-full py-2 text-xs font-mono text-slate-400 hover:text-cyan-400 transition text-center"
            >
              &larr; Back to Biometric Scanner
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

function UnlockIcon(props: any) {
  return <Key {...props} />;
}
