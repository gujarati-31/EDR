import fs from 'fs';
import { readAndDecryptFile } from './crypto.js';

/**
 * Extracts exact duration from an MP4 buffer by parsing the 'mvhd' (Movie Header) atom.
 * Returns formatted "MM:SS" or "HH:MM:SS", or null if not an MP4 or mvhd not found.
 */
export function extractMp4DurationFromBuffer(buffer: Buffer): string | null {
  try {
    const mvhdHeader = Buffer.from('mvhd');
    const mvhdIdx = buffer.indexOf(mvhdHeader);
    if (mvhdIdx === -1 || mvhdIdx + 24 > buffer.length) {
      return null;
    }

    // mvhd layout:
    // [4 bytes size][4 bytes 'mvhd'][1 byte version][3 bytes flags]
    // version offset is mvhdIdx + 4
    const version = buffer.readUInt8(mvhdIdx + 4);
    let offset = mvhdIdx + 8; // skip header + version + flags

    let timescale = 0;
    let duration = 0;

    if (version === 0) {
      if (offset + 16 > buffer.length) return null;
      // 4 bytes creation_time + 4 bytes mod_time
      offset += 8;
      timescale = buffer.readUInt32BE(offset);
      duration = buffer.readUInt32BE(offset + 4);
    } else if (version === 1) {
      if (offset + 28 > buffer.length) return null;
      // 8 bytes creation_time + 8 bytes mod_time
      offset += 16;
      timescale = buffer.readUInt32BE(offset);
      const high = buffer.readUInt32BE(offset + 4);
      const low = buffer.readUInt32BE(offset + 8);
      duration = high * 4294967296 + low;
    } else {
      return null;
    }

    if (timescale <= 0 || isNaN(duration) || duration < 0) {
      return null;
    }

    const totalSeconds = Math.round(duration / timescale);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } catch (err) {
    return null;
  }
}

/**
 * Extracts exact MP4 duration from a file path on disk (handles AES-256-GCM encrypted or raw files).
 */
export function extractMp4DurationFromFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    // We only need the first 256KB or so if moov is at the beginning,
    // but in case moov is at the end (standard Android MediaMuxer places moov at the end upon close),
    // reading the decrypted buffer gives complete accurate access.
    const buf = readAndDecryptFile(filePath);
    return extractMp4DurationFromBuffer(buf);
  } catch {
    return null;
  }
}
