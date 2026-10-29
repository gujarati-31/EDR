import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { EDRWebSocketGateway } from './gateway/wsServer.js';
import { readAndDecryptFile } from './utils/crypto.js';
import { createDeviceRouter } from './routes/deviceRoutes.js';
import { createPolicyRouter } from './routes/policyRoutes.js';
import { createCommandRouter } from './routes/commandRoutes.js';
import { createLogRouter } from './routes/logRoutes.js';
import { createUsageRouter } from './routes/usageRoutes.js';
import { createLogoRouter } from './routes/logoRoutes.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Ensure upload directories exist
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Encrypted uploads middleware: files stored on disk are AES-256-GCM encrypted.
// When requested, they are decrypted in transient RAM and served to authorized clients.
app.use('/uploads', (req, res, next) => {
  const relPath = decodeURIComponent(req.path);
  const targetPath = path.join(UPLOADS_DIR, relPath);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    try {
      const decrypted = readAndDecryptFile(targetPath);
      const ext = path.extname(targetPath).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') {
        res.setHeader('Content-Type', 'image/jpeg');
      } else if (ext === '.mp4') {
        res.setHeader('Content-Type', 'video/mp4');
      } else if (ext === '.webm') {
        res.setHeader('Content-Type', 'video/webm');
      }
      res.setHeader('Content-Length', decrypted.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(decrypted);
    } catch (err: any) {
      console.warn('[Uploads] Error decrypting on-the-fly:', err.message);
      return next();
    }
  }
  next();
}, express.static(UPLOADS_DIR));

// Initialize WebSocket Gateway
const wsGateway = new EDRWebSocketGateway(server);

// Routes
app.use('/api/devices', createDeviceRouter(wsGateway));
app.use('/api/policies', createPolicyRouter(wsGateway));
app.use('/api/commands', createCommandRouter(wsGateway));
app.use('/api/logs', createLogRouter(wsGateway));
app.use('/api/usage', createUsageRouter(wsGateway));
app.use('/api/logos', createLogoRouter());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'EDR Central Backend',
    timestamp: new Date().toISOString(),
  });
});

// Serve built Dashboard frontend (single URL deployment)
const candidateDashboardDirs = [
  path.resolve(process.cwd(), '..', 'management-dashboard', 'dist'),
  path.resolve(process.cwd(), 'client-dist'),
  path.resolve(process.cwd(), 'public'),
];

for (const d of candidateDashboardDirs) {
  if (fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html'))) {
    app.use(express.static(d));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(path.join(d, 'index.html'));
    });
    console.log(`[Dashboard] Serving static frontend from: ${d}`);
    break;
  }
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`🛡️  Android EDR Central Server is LIVE`);
  console.log(`📡 HTTP API:      http://localhost:${PORT}/api`);
  console.log(`⚡ WebSocket Bus: ws://localhost:${PORT}/ws`);
  console.log(`===================================================`);
});

export { app, server, wsGateway };

