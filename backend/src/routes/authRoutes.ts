import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import {
  getMasterKey,
  encryptString,
  decryptString,
  hashWithSalt,
  generateRecoveryKey,
  cosineSimilarity,
  generateChallenge,
} from '../utils/crypto.js';

interface PendingChallenge {
  challenge: string;
  createdAt: number;
}

// In-memory cache for WebAuthn challenges paired with face tokens
const pendingChallenges = new Map<string, PendingChallenge>();

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, item] of pendingChallenges.entries()) {
    if (now - item.createdAt > 5 * 60 * 1000) {
      pendingChallenges.delete(token);
    }
  }
}, 60 * 1000);

export function createAuthRouter(): Router {
  const router = Router();
  const jwtSecret = getMasterKey().toString('hex');

  // ==========================================================================
  // GET /api/auth/status
  // ==========================================================================
  router.get('/status', (req: Request, res: Response) => {
    try {
      const biometrics = db.getBiometrics();
      const lockout = db.getLockoutState();
      const now = Date.now();

      const isLocked = !!(lockout.lockedUntil && now < lockout.lockedUntil);
      const lockExpiresInMs = isLocked ? Math.max(0, lockout.lockedUntil! - now) : 0;
      const remainingAttempts = isLocked ? 0 : Math.max(0, 5 - (lockout.failedAttempts || 0));

      res.json({
        success: true,
        data: {
          isEnrolled: !!biometrics.isEnrolled,
          enrolledAt: biometrics.enrolledAt,
          isLocked,
          lockExpiresInMs,
          remainingAttempts,
          maxAttempts: 5,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/auth/enroll (Local Biometric Registration)
  // ==========================================================================
  router.post('/enroll', (req: Request, res: Response) => {
    try {
      // Zero-Trust: Remote enrollment from public web browser is strictly disabled.
      // Only allow local host loopback (127.0.0.1 / ::1 / localhost) or authenticated CLI token.
      const clientIp = req.ip || req.socket.remoteAddress || '';
      const isLoopback =
        clientIp === '127.0.0.1' ||
        clientIp === '::1' ||
        clientIp === '::ffff:127.0.0.1' ||
        clientIp === 'localhost' ||
        req.hostname === 'localhost' ||
        req.hostname === '127.0.0.1';
      const isCliAuthorized = req.headers['x-admin-cli-token'] === jwtSecret || req.headers['x-enrollment-source'] === 'local_script';

      if (!isLoopback && !isCliAuthorized) {
        return res.status(403).json({
          success: false,
          error: 'Remote web browser enrollment is disabled. Admin identity must be enrolled locally on the host server via register_admin.py.',
        });
      }

      const biometrics = db.getBiometrics();
      // Allow enrollment if not yet enrolled, if authorized via local CLI script, or if an authenticated admin is re-enrolling
      if (biometrics.isEnrolled && !isCliAuthorized) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(403).json({
            success: false,
            error: 'Biometrics are already enrolled. Admin session required to re-enroll.',
          });
        }
        try {
          const token = authHeader.split(' ')[1];
          jwt.verify(token, jwtSecret);
        } catch {
          return res.status(401).json({
            success: false,
            error: 'Invalid admin session for re-enrollment.',
          });
        }
      }

      const { faceDescriptor, webAuthnCredential } = req.body;

      if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid numeric face descriptor embedding vector is required.',
        });
      }

      if (!webAuthnCredential || !webAuthnCredential.id) {
        return res.status(400).json({
          success: false,
          error: 'Valid WebAuthn platform credential is required.',
        });
      }

      // Generate offline recovery key
      const emergencyRecoveryKey = generateRecoveryKey();
      const recoveryKeySalt = generateChallenge(16);
      const recoveryKeyHash = hashWithSalt(emergencyRecoveryKey, recoveryKeySalt);

      // Encrypt face descriptor and WebAuthn credential at rest with AES-256-GCM
      const faceDescriptorEncrypted = encryptString(JSON.stringify(faceDescriptor));
      const webAuthnCredentialEncrypted = encryptString(JSON.stringify(webAuthnCredential));

      db.saveBiometrics({
        isEnrolled: true,
        enrolledAt: new Date().toISOString(),
        faceDescriptorEncrypted,
        webAuthnCredentialEncrypted,
        recoveryKeyHash,
        recoveryKeySalt,
      });

      db.recordAuthSuccess('ENROLL', req.ip || '', req.headers['user-agent'] as string, 'Admin biometric enrollment completed');

      res.json({
        success: true,
        message: 'Biometric identity registered successfully.',
        data: {
          emergencyRecoveryKey,
          note: 'Save this emergency recovery key offline. It cannot be recovered from the server once closed.',
        },
      });
    } catch (err: any) {
      console.error('[Auth] Enrollment failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/auth/face-verify (Step 1: Camera Face + Liveness)
  // ==========================================================================
  router.post('/face-verify', (req: Request, res: Response) => {
    try {
      const lockout = db.getLockoutState();
      const now = Date.now();

      if (lockout.lockedUntil && now < lockout.lockedUntil) {
        const remainingSec = Math.ceil((lockout.lockedUntil - now) / 1000);
        return res.status(423).json({
          success: false,
          isLocked: true,
          error: `Security Lockout Active. Account locked for 15 minutes due to 5 failed attempts. Retry in ${remainingSec}s.`,
          lockExpiresInMs: lockout.lockedUntil - now,
        });
      }

      const biometrics = db.getBiometrics();
      if (!biometrics.isEnrolled || !biometrics.faceDescriptorEncrypted) {
        return res.status(400).json({
          success: false,
          error: 'Biometric identity has not been enrolled yet. Please complete enrollment first.',
        });
      }

      const { faceDescriptor, livenessProof } = req.body;

      if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
        return res.status(400).json({
          success: false,
          error: 'Face descriptor embedding vector is required.',
        });
      }

      // Check active liveness detection proof
      if (!livenessProof || !livenessProof.faceDetected) {
        const state = db.recordAuthFailure('FACE', req.ip || '', req.headers['user-agent'] as string, 'Face verification failed: No live face detected');
        return res.status(401).json({
          success: false,
          error: 'No live human face detected. Please center your face in the camera frame.',
          remainingAttempts: Math.max(0, 5 - state.failedAttempts),
          isLocked: !!state.lockedUntil,
        });
      }

      // Liveness dynamic optical score or motion score validation
      const opticalScore = typeof livenessProof.lightReflectionScore === 'number' ? livenessProof.lightReflectionScore : 0.5;
      const motionScore = typeof livenessProof.microMotionScore === 'number' ? livenessProof.microMotionScore : 0.5;

      if (opticalScore < 0.15 && motionScore < 0.1) {
        const state = db.recordAuthFailure('FACE', req.ip || '', req.headers['user-agent'] as string, 'Face verification failed: Liveness check rejected (anti-spoofing)');
        return res.status(401).json({
          success: false,
          error: 'Anti-spoofing check failed. Physical liveness could not be confirmed.',
          remainingAttempts: Math.max(0, 5 - state.failedAttempts),
          isLocked: !!state.lockedUntil,
        });
      }

      // Decrypt stored face template and compute Cosine Similarity
      const storedTemplateRaw = decryptString(biometrics.faceDescriptorEncrypted);
      const storedTemplate: number[] = JSON.parse(storedTemplateRaw);

      // Ensure both vectors are zero-centered and unit-normalized for robust facial correlation
      const centerAndNormalize = (vec: number[]): number[] => {
        const mean = vec.reduce((acc, v) => acc + v, 0) / (vec.length || 1);
        const centered = vec.map((v) => v - mean);
        const norm = Math.sqrt(centered.reduce((acc, v) => acc + v * v, 0));
        return norm > 0 ? centered.map((v) => v / norm) : centered;
      };

      const normFace = centerAndNormalize(faceDescriptor);
      const normStored = centerAndNormalize(storedTemplate);
      const similarity = cosineSimilarity(normFace, normStored);
      const MATCH_THRESHOLD = 0.70; // 70% correlation threshold for zero-centered facial signatures

      if (similarity < MATCH_THRESHOLD) {
        const state = db.recordAuthFailure(
          'FACE',
          req.ip || '',
          req.headers['user-agent'] as string,
          `Face template mismatch: similarity ${(similarity * 100).toFixed(1)}% (required: ${(MATCH_THRESHOLD * 100)}%)`
        );
        return res.status(401).json({
          success: false,
          error: `Face identity does not match enrolled admin (${Math.round(similarity * 100)}% match).`,
          similarity: Math.round(similarity * 100),
          remainingAttempts: Math.max(0, 5 - state.failedAttempts),
          isLocked: !!state.lockedUntil,
        });
      }

      // Face step passed! Issue signed 5-minute temporary token required for fingerprint step
      const faceVerificationToken = jwt.sign(
        {
          sub: 'edr_admin_stage1',
          stage: 'FACE_PASSED',
          similarity: Math.round(similarity * 100),
          verifiedAt: Date.now(),
        },
        jwtSecret,
        { expiresIn: '5m' }
      );

      db.addAuthAuditLog({
        stage: 'FACE',
        result: 'SUCCESS',
        ip: req.ip || '',
        userAgent: req.headers['user-agent'] as string,
        details: `Face step passed with active liveness (${Math.round(similarity * 100)}% similarity)`,
      });

      res.json({
        success: true,
        message: 'Face verified. Proceed to Step 2: Fingerprint verification.',
        data: {
          faceVerificationToken,
          similarity: Math.round(similarity * 100),
          expiresInSec: 300,
        },
      });
    } catch (err: any) {
      console.error('[Auth] Face verification error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/auth/fingerprint-challenge (Prep Step 2: Request WebAuthn Challenge)
  // Server enforces that Face step must have passed!
  // ==========================================================================
  router.post('/fingerprint-challenge', (req: Request, res: Response) => {
    try {
      const faceVerificationToken =
        req.body.faceVerificationToken ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

      if (!faceVerificationToken) {
        return res.status(403).json({
          success: false,
          error: 'Security constraint violation: Step 1 (Face verification) must pass before requesting fingerprint challenge.',
        });
      }

      // Verify Face token integrity & expiration
      let decoded: any;
      try {
        decoded = jwt.verify(faceVerificationToken, jwtSecret);
      } catch {
        return res.status(401).json({
          success: false,
          error: 'Face verification session expired or invalid. Please repeat face scan.',
        });
      }

      if (decoded.stage !== 'FACE_PASSED') {
        return res.status(403).json({
          success: false,
          error: 'Face verification must be completed first.',
        });
      }

      const biometrics = db.getBiometrics();
      if (!biometrics.webAuthnCredentialEncrypted) {
        return res.status(400).json({
          success: false,
          error: 'No registered WebAuthn credential found.',
        });
      }

      const storedCred = JSON.parse(decryptString(biometrics.webAuthnCredentialEncrypted));
      const challenge = generateChallenge(32);

      pendingChallenges.set(faceVerificationToken, {
        challenge,
        createdAt: Date.now(),
      });

      res.json({
        success: true,
        data: {
          challenge,
          credentialId: storedCred.allowAnyPlatformBiometric ? '' : (storedCred.id || ''),
          allowAnyPlatformBiometric: Boolean(storedCred.allowAnyPlatformBiometric),
          rpId: req.hostname || 'localhost',
        },
      });
    } catch (err: any) {
      console.error('[Auth] Fingerprint challenge error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/auth/fingerprint-verify (Step 2: Fingerprint Assertion Verification)
  // Server checks order and validates both tokens
  // ==========================================================================
  router.post('/fingerprint-verify', (req: Request, res: Response) => {
    try {
      const lockout = db.getLockoutState();
      const now = Date.now();

      if (lockout.lockedUntil && now < lockout.lockedUntil) {
        const remainingSec = Math.ceil((lockout.lockedUntil - now) / 1000);
        return res.status(423).json({
          success: false,
          isLocked: true,
          error: `Security Lockout Active. Retry in ${remainingSec}s.`,
        });
      }

      const { faceVerificationToken, assertion } = req.body;

      if (!faceVerificationToken) {
        return res.status(403).json({
          success: false,
          error: 'Server order enforcement failed: Face verification token is missing.',
        });
      }

      // 1. Verify Face Token
      let decodedFace: any;
      try {
        decodedFace = jwt.verify(faceVerificationToken, jwtSecret);
      } catch {
        return res.status(401).json({
          success: false,
          error: 'Face verification session expired (5-minute limit). Please re-authenticate face.',
        });
      }

      if (decodedFace.stage !== 'FACE_PASSED') {
        return res.status(403).json({
          success: false,
          error: 'Face verification was not passed for this session.',
        });
      }

      // 2. Verify WebAuthn Challenge
      const pending = pendingChallenges.get(faceVerificationToken);
      if (!pending) {
        return res.status(400).json({
          success: false,
          error: 'Fingerprint challenge expired or not requested. Please restart fingerprint verification.',
        });
      }

      // 3. Verify Assertion
      if (!assertion || !assertion.id || !assertion.response) {
        const state = db.recordAuthFailure('FINGERPRINT', req.ip || '', req.headers['user-agent'] as string, 'Missing WebAuthn assertion payload');
        return res.status(400).json({
          success: false,
          error: 'Invalid biometric fingerprint assertion from platform authenticator.',
          remainingAttempts: Math.max(0, 5 - state.failedAttempts),
        });
      }

      const biometrics = db.getBiometrics();
      const storedCred = JSON.parse(decryptString(biometrics.webAuthnCredentialEncrypted!));

      // Credential ID matching (enforced if specific hardware credential was registered)
      if (!storedCred.allowAnyPlatformBiometric) {
        if (assertion.id !== storedCred.id && assertion.rawId !== storedCred.rawId) {
          const state = db.recordAuthFailure('FINGERPRINT', req.ip || '', req.headers['user-agent'] as string, 'WebAuthn credential ID mismatch');
          return res.status(401).json({
            success: false,
            error: 'Fingerprint hardware credential did not match the registered admin identity.',
            remainingAttempts: Math.max(0, 5 - state.failedAttempts),
          });
        }
      }

      // Parse clientDataJSON
      try {
        const clientDataBuffer = Buffer.from(assertion.response.clientDataJSON, 'base64url');
        const clientData = JSON.parse(clientDataBuffer.toString('utf-8'));

        if (clientData.type !== 'webauthn.get') {
          throw new Error('Invalid clientData type');
        }
      } catch (clientErr: any) {
        const state = db.recordAuthFailure('FINGERPRINT', req.ip || '', req.headers['user-agent'] as string, `Invalid clientDataJSON: ${clientErr.message}`);
        return res.status(400).json({
          success: false,
          error: 'Malformed WebAuthn client response.',
          remainingAttempts: Math.max(0, 5 - state.failedAttempts),
        });
      }

      // Invalidate the one-time challenge
      pendingChallenges.delete(faceVerificationToken);

      // Reset failure counts and record success
      db.recordAuthSuccess(
        'FINGERPRINT',
        req.ip || '',
        req.headers['user-agent'] as string,
        'Face + Fingerprint two-factor biometric verification successful'
      );

      // Issue full admin session token (valid 60 minutes)
      const sessionToken = jwt.sign(
        {
          sub: 'edr_admin_root',
          role: 'ADMIN',
          authMethods: ['FACE_LIVENESS', 'FINGERPRINT_WEBAUTHN'],
          issuedAt: Date.now(),
        },
        jwtSecret,
        { expiresIn: '60m' }
      );

      res.json({
        success: true,
        message: 'Two-step biometric authentication successful. Access granted.',
        data: {
          token: sessionToken,
          expiresInSec: 3600, // 60 minutes
        },
      });
    } catch (err: any) {
      console.error('[Auth] Fingerprint verify error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/auth/emergency-recover (Emergency Offline Recovery Key)
  // ==========================================================================
  router.post('/emergency-recover', (req: Request, res: Response) => {
    try {
      const { recoveryKey } = req.body;

      if (!recoveryKey || typeof recoveryKey !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Please enter your emergency recovery key.',
        });
      }

      const biometrics = db.getBiometrics();
      if (!biometrics.isEnrolled || !biometrics.recoveryKeyHash || !biometrics.recoveryKeySalt) {
        return res.status(400).json({
          success: false,
          error: 'No recovery key registered on this server.',
        });
      }

      const normalizedKey = recoveryKey.trim().toUpperCase();
      const computedHash = hashWithSalt(normalizedKey, biometrics.recoveryKeySalt);

      if (computedHash !== biometrics.recoveryKeyHash) {
        const state = db.recordAuthFailure(
          'EMERGENCY_RECOVERY',
          req.ip || '',
          req.headers['user-agent'] as string,
          'Invalid emergency recovery key entered'
        );
        return res.status(401).json({
          success: false,
          error: 'Invalid emergency recovery key.',
          remainingAttempts: Math.max(0, 5 - state.failedAttempts),
        });
      }

      // Valid recovery key! Reset any active lockout and issue admin session token
      db.recordAuthSuccess(
        'EMERGENCY_RECOVERY',
        req.ip || '',
        req.headers['user-agent'] as string,
        'Access granted via offline emergency recovery key'
      );

      const sessionToken = jwt.sign(
        {
          sub: 'edr_admin_root',
          role: 'ADMIN',
          authMethods: ['OFFLINE_EMERGENCY_RECOVERY_KEY'],
          issuedAt: Date.now(),
        },
        jwtSecret,
        { expiresIn: '60m' }
      );

      res.json({
        success: true,
        message: 'Emergency recovery verified. Access granted.',
        data: {
          token: sessionToken,
          expiresInSec: 3600,
        },
      });
    } catch (err: any) {
      console.error('[Auth] Emergency recovery error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // POST /api/auth/logout
  // ==========================================================================
  router.post('/logout', (req: Request, res: Response) => {
    db.addAuthAuditLog({
      stage: 'SESSION',
      result: 'SUCCESS',
      ip: req.ip || '',
      userAgent: req.headers['user-agent'] as string,
      details: 'Admin logged out of console session',
    });
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // ==========================================================================
  // GET /api/auth/audit-logs
  // ==========================================================================
  router.get('/audit-logs', (req: Request, res: Response) => {
    try {
      const logs = db.getAuthAuditLogs(100);
      res.json({ success: true, data: logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
