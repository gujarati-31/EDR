import fs from 'fs';
import path from 'path';

interface LogoCache {
  [key: string]: string; // key: packageName or appName in lowercase -> logo URL
}

const CACHE_FILE = path.resolve(process.cwd(), 'data', 'logo_cache.json');

class LogoService {
  private cache: LogoCache = {};

  constructor() {
    this.loadCache();
    this.seedKnownLogos();
  }

  private loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        this.cache = JSON.parse(raw);
      }
    } catch (e) {
      this.cache = {};
    }
  }

  private saveCache() {
    try {
      const dataDir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (e) {
      // ignore
    }
  }

  private seedKnownLogos() {
    const known: Record<string, string> = {
      'com.google.android.youtube': 'https://play-lh.googleusercontent.com/1-hPxOqv_26umupViY84CHeTGCur_IQXuqNrmTueBeVKQMoW-bfl8ULdfFt-nMZmzA=s256',
      'youtube': 'https://play-lh.googleusercontent.com/1-hPxOqv_26umupViY84CHeTGCur_IQXuqNrmTueBeVKQMoW-bfl8ULdfFt-nMZmzA=s256',
      'com.whatsapp': 'https://play-lh.googleusercontent.com/bYtqbOcTYOVuQOnhCwEU8RLEmmGA4EzRiIA8PtvSofFu6hClACZAsXdLnPJ-yHvZFw=s256',
      'whatsapp': 'https://play-lh.googleusercontent.com/bYtqbOcTYOVuQOnhCwEU8RLEmmGA4EzRiIA8PtvSofFu6hClACZAsXdLnPJ-yHvZFw=s256',
      'com.instagram.android': 'https://play-lh.googleusercontent.com/VRMW0EAGvdkgnt6NuDHvdja-eWyaRACoJonQIwOGhkFFxmiyUM1uxAAdJaLnOIgwhFs=s256',
      'instagram': 'https://play-lh.googleusercontent.com/VRMW0EAGvdkgnt6NuDHvdja-eWyaRACoJonQIwOGhkFFxmiyUM1uxAAdJaLnOIgwhFs=s256',
      'com.facebook.katana': 'https://play-lh.googleusercontent.com/KCMiJqlStJpHtL-cxQ6CqQUVMmsIgfinOGggAnKaMioWZxWn0EBIdUrRIOxpahZiKX4=s256',
      'facebook': 'https://play-lh.googleusercontent.com/KCMiJqlStJpHtL-cxQ6CqQUVMmsIgfinOGggAnKaMioWZxWn0EBIdUrRIOxpahZiKX4=s256',
      'org.telegram.messenger': 'https://play-lh.googleusercontent.com/ZU9AnErrorInfo=s256',
      'telegram': 'https://play-lh.googleusercontent.com/ZU9AnErrorInfo=s256',
      'com.dts.freefiremax': 'https://play-lh.googleusercontent.com/bLp6q2f8nZ4GZ4_XQ-4b7q=s256',
      'free fire max': 'https://play-lh.googleusercontent.com/bLp6q2f8nZ4GZ4_XQ-4b7q=s256',
      'com.snapchat.android': 'https://play-lh.googleusercontent.com/KxeHzcLY6xyhp2WKn5fmiSDaWus-AcuyDLRICollxRWkoDex7GlqO7AnLQfgnbuujYc=s256',
      'snapchat': 'https://play-lh.googleusercontent.com/KxeHzcLY6xyhp2WKn5fmiSDaWus-AcuyDLRICollxRWkoDex7GlqO7AnLQfgnbuujYc=s256',
      'com.cricbuzz.android': 'https://play-lh.googleusercontent.com/C1mP5Q3fD8_X7E1k3s_f5=s256',
      'cricbuzz': 'https://play-lh.googleusercontent.com/C1mP5Q3fD8_X7E1k3s_f5=s256',
      'com.truecaller': 'https://play-lh.googleusercontent.com/s6nE1j9Vn_Q8o1Z=s256',
      'truecaller': 'https://play-lh.googleusercontent.com/s6nE1j9Vn_Q8o1Z=s256',
      'com.android.chrome': 'https://play-lh.googleusercontent.com/KwUbnFvDpYflCyTSFsSpl39ndBmDU0QqDTriTm25st7VTxaPUbCraOUucqlAFCfhubI=s256',
      'chrome': 'https://play-lh.googleusercontent.com/KwUbnFvDpYflCyTSFsSpl39ndBmDU0QqDTriTm25st7VTxaPUbCraOUucqlAFCfhubI=s256',
      'com.google.android.gm': 'https://play-lh.googleusercontent.com/KSuaRLrmHGjeD8gQwZv350PVE5zHueiqREflvd950PUppIOxdJV-NuGluOAsiQzYZQI=s256',
      'gmail': 'https://play-lh.googleusercontent.com/KSuaRLrmHGjeD8gQwZv350PVE5zHueiqREflvd950PUppIOxdJV-NuGluOAsiQzYZQI=s256',
    };

    for (const [k, v] of Object.entries(known)) {
      if (!this.cache[k]) {
        this.cache[k] = v;
      }
    }
  }

  /**
   * Searches online for an app logo by package name and/or app name
   */
  async findAppLogo(packageName?: string, appName?: string): Promise<string | null> {
    const pkgKey = packageName ? packageName.trim().toLowerCase() : '';
    const nameKey = appName ? appName.trim().toLowerCase() : '';

    // 1. Check Cache
    if (pkgKey && this.cache[pkgKey]) return this.cache[pkgKey];
    if (nameKey && this.cache[nameKey]) return this.cache[nameKey];

    // 2. Search Google Play by Package Name
    if (pkgKey && !pkgKey.startsWith('com.android.') && !pkgKey.startsWith('android')) {
      const playUrl = await this.fetchFromGooglePlayPackage(pkgKey);
      if (playUrl) {
        this.cache[pkgKey] = playUrl;
        if (nameKey) this.cache[nameKey] = playUrl;
        this.saveCache();
        return playUrl;
      }
    }

    // 3. Search Google Play by App Name
    if (nameKey && nameKey.length > 1) {
      const searchUrl = await this.searchGooglePlayByName(nameKey);
      if (searchUrl) {
        if (pkgKey) this.cache[pkgKey] = searchUrl;
        this.cache[nameKey] = searchUrl;
        this.saveCache();
        return searchUrl;
      }
    }

    // 4. Search iTunes API by App Name
    if (nameKey && nameKey.length > 1) {
      const itunesUrl = await this.searchItunesByName(nameKey);
      if (itunesUrl) {
        if (pkgKey) this.cache[pkgKey] = itunesUrl;
        this.cache[nameKey] = itunesUrl;
        this.saveCache();
        return itunesUrl;
      }
    }

    return null;
  }

  private async fetchFromGooglePlayPackage(pkg: string): Promise<string | null> {
    try {
      const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!res.ok) return null;
      const html = await res.text();

      // Look for og:image meta tag
      const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
      if (ogMatch && ogMatch[1]) {
        return this.cleanGooglePlayIconUrl(ogMatch[1]);
      }

      // Look for itemprop="image"
      const itemMatch = html.match(/itemprop="image"[^>]*src="([^"]+)"/);
      if (itemMatch && itemMatch[1]) {
        return this.cleanGooglePlayIconUrl(itemMatch[1]);
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  private async searchGooglePlayByName(name: string): Promise<string | null> {
    try {
      const url = `https://play.google.com/store/search?q=${encodeURIComponent(name)}&c=apps&hl=en`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!res.ok) return null;
      const html = await res.text();

      // Find first play-lh.googleusercontent.com image url
      const match = html.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/);
      if (match && match[1]) {
        return this.cleanGooglePlayIconUrl(match[1]);
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  private async searchItunesByName(name: string): Promise<string | null> {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=1`;
      const res = await fetch(url);
      if (res.ok) {
        const json: any = await res.json();
        if (json.results && json.results.length > 0) {
          return json.results[0].artworkUrl512 || json.results[0].artworkUrl100 || null;
        }
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  private cleanGooglePlayIconUrl(rawUrl: string): string {
    // Replace size parameters like =s... or =w... with =s256 for a crisp 256x256 icon
    if (rawUrl.includes('googleusercontent.com')) {
      const baseUrl = rawUrl.split('=')[0];
      return `${baseUrl}=s256`;
    }
    return rawUrl;
  }
}

export const logoService = new LogoService();

