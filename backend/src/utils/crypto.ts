import crypto from 'crypto';
import fs from 'fs';

const MAGIC_HEADER = Buffer.from('EDR1'); // 4 bytes magic prefix
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12-byte nonce for AES-GCM
const TAG_LENGTH = 16; // 16-byte authentication tag

/**
 * Derives a 256-bit (32-byte) AES key from the master encryption secret.
 */
export function getMasterKey(): Buffer {
  const secret = process.env.EDR_ENCRYPTION_KEY || 'edr-soc-defense-master-key-2026-secure-aes256';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Checks whether a buffer was encrypted by the EDR crypto module.
 */
export function isEncrypted(buffer: Buffer): boolean {
  return buffer.length >= 32 && buffer.subarray(0, 4).equals(MAGIC_HEADER);
}

/**
 * Encrypts arbitrary buffer data with AES-256-GCM authenticated encryption.
 * Output format: [4 bytes 'EDR1'] + [12 bytes IV] + [16 bytes AuthTag] + [Ciphertext]
 */
export function encryptBuffer(buffer: Buffer): Buffer {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([MAGIC_HEADER, iv, tag, encrypted]);
}

/**
 * Decrypts an AES-256-GCM encrypted buffer. If data is not encrypted (e.g. legacy),
 * returns the original buffer safely.
 */
export function decryptBuffer(buffer: Buffer): Buffer {
  if (!isEncrypted(buffer)) {
    return buffer;
  }

  const key = getMasterKey();
  const iv = buffer.subarray(4, 4 + IV_LENGTH);
  const tag = buffer.subarray(4 + IV_LENGTH, 4 + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(4 + IV_LENGTH + TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err: any) {
    console.error('[Crypto] Decryption failed or authentication tag mismatch:', err.message);
    throw new Error('Decryption integrity check failed');
  }
}

/**
 * Encrypts a string to a base64 encoded payload.
 */
export function encryptString(text: string): string {
  const buffer = Buffer.from(text, 'utf-8');
  return encryptBuffer(buffer).toString('base64');
}

/**
 * Decrypts a base64 encoded encrypted string.
 */
export function decryptString(cipherBase64: string): string {
  const buffer = Buffer.from(cipherBase64, 'base64');
  return decryptBuffer(buffer).toString('utf-8');
}

/**
 * Encrypts a file on disk in-place.
 */
export function encryptFileInPlace(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath);
  if (isEncrypted(raw)) return; // Already encrypted
  const encrypted = encryptBuffer(raw);
  fs.writeFileSync(filePath, encrypted);
}

/**
 * Reads and decrypts a file into memory without ever saving unencrypted bytes to disk.
 */
export function readAndDecryptFile(filePath: string): Buffer {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath);
  return decryptBuffer(raw);
}

