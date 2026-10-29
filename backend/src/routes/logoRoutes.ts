import { Router } from 'express';
import { logoService } from '../services/logoService.js';

export function createLogoRouter() {
  const router = Router();

  // Redirect directly to the online image so it can be used directly as <img src="/api/logos/icon?package=...&name=..." />
  router.get('/icon', async (req, res) => {
    const pkg = req.query.package as string | undefined;
    const name = req.query.name as string | undefined;

    if (!pkg && !name) {
      return res.status(400).send('package or name query required');
    }

    try {
      const logoUrl = await logoService.findAppLogo(pkg, name);
      if (logoUrl) {
        res.setHeader('Cache-Control', 'public, max-age=604800'); // Cache for 7 days
        return res.redirect(302, logoUrl);
      }
    } catch (e) {
      // fallback
    }

    return res.status(404).json({ success: false, message: 'Logo not found online' });
  });

  // JSON lookup endpoint
  router.get('/lookup', async (req, res) => {
    const pkg = req.query.package as string | undefined;
    const name = req.query.name as string | undefined;

    try {
      const logoUrl = await logoService.findAppLogo(pkg, name);
      res.json({ success: !!logoUrl, logoUrl });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

