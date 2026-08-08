// Flight Wall server: serves the control panel + display, and a small JSON API.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { config, isPinRequired } from './config.js';
import {
  initStorage,
  storageKind,
  getScreen,
  saveScreen,
  listScreens,
  cleanScreenId,
  DEFAULT_SCREEN_ID,
} from './storage.js';
import { getFlightsForScreen } from './flights.js';

const APP_VERSION = '1.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// --- Helpers ---------------------------------------------------------------

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Guards settings writes when CONTROL_PIN is configured. Reads stay public.
function requirePin(req, res, next) {
  if (!isPinRequired()) return next();
  const pin = req.get('x-control-pin') || req.body?.pin || '';
  if (constantTimeEqual(pin, config.controlPin)) return next();
  return res.status(401).json({ error: 'invalid-pin' });
}

const screenOf = (req) => cleanScreenId(req.query.screen || req.body?.screenId);

// --- API -------------------------------------------------------------------

// Note: Cloud Run's frontend intercepts the exact path "/healthz", so use "/health".
app.get('/health', (_req, res) => res.json({ ok: true, version: APP_VERSION }));

app.get('/api/config', (_req, res) => {
  res.json({
    version: APP_VERSION,
    pinRequired: isPinRequired(),
    storage: storageKind(),
    defaultScreen: DEFAULT_SCREEN_ID,
  });
});

app.get('/api/screens', async (_req, res, next) => {
  try {
    res.json({ screens: await listScreens() });
  } catch (err) {
    next(err);
  }
});

app.get('/api/settings', async (req, res, next) => {
  try {
    res.json(await getScreen(screenOf(req)));
  } catch (err) {
    next(err);
  }
});

app.post('/api/settings', requirePin, async (req, res, next) => {
  try {
    const saved = await saveScreen(screenOf(req), req.body || {});
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// Single call the display polls: current settings + computed flights.
app.get('/api/state', async (req, res, next) => {
  try {
    const settings = await getScreen(screenOf(req));
    let flights = [];
    let note = null;
    let error = null;
    try {
      const result = await getFlightsForScreen(settings);
      flights = result.flights;
      note = result.note || null;
    } catch (err) {
      // Keep the endpoint 200 so the display can show its last-known data.
      error = err.upstream ? 'upstream-unavailable' : 'flight-error';
      console.error('[state] flight fetch failed:', err.message);
    }
    res.json({ settings, flights, note, error, generatedAt: Date.now() });
  } catch (err) {
    next(err);
  }
});

// Map tile proxy: keeps the map working even when clients block CDN hosts,
// and caches tiles in-process. Source: CARTO dark basemap (© OSM, © CARTO).
const tileCache = new Map();
app.get('/api/map/:z/:x/:y', async (req, res) => {
  const z = parseInt(req.params.z, 10);
  const x = parseInt(req.params.x, 10);
  const y = parseInt(req.params.y, 10);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19) return res.status(400).end();
  const max = 2 ** z;
  if (x < 0 || y < 0 || x >= max || y >= max) return res.status(400).end();

  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) {
    res.set('Content-Type', cached.type);
    res.set('Cache-Control', 'public, max-age=604800');
    return res.send(cached.buf);
  }
  try {
    const sub = 'abcd'[(x + y) % 4];
    const r = await fetch(`https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': config.userAgent },
    });
    if (!r.ok) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || 'image/png';
    tileCache.set(key, { buf, type });
    if (tileCache.size > 800) tileCache.delete(tileCache.keys().next().value);
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

// Live ATC audio proxy: streams a configured channel URL to the browser with
// CORS enabled (required for Web Audio panning) and over HTTPS (avoids mixed
// content for http feeds). Only URLs present in the given screen's audio config
// are proxied, so this is not an open proxy. See docs/ATC_AUDIO.md for terms.
app.get('/api/audio-proxy', async (req, res) => {
  const screen = cleanScreenId(req.query.screen);
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url)) return res.status(400).end();
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return res.status(400).end();
  }
  // Basic SSRF guard: refuse loopback/private/link-local hosts.
  if (
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' || host.endsWith('.local') || host.endsWith('.internal')
  ) {
    return res.status(400).end();
  }
  const settings = await getScreen(screen);
  const allowed = new Set((settings.audio?.channels || []).map((c) => c.url));
  if (!allowed.has(url)) return res.status(403).end();

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const up = await fetch(url, {
      headers: { 'User-Agent': config.userAgent, Accept: '*/*' },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!up.ok || !up.body) {
      if (!res.headersSent) res.status(502).end();
      return;
    }
    res.setHeader('Content-Type', up.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // pipeline cleans up both streams and rejects (rather than throwing) on
    // client disconnect / abort — so a dropped listener never crashes the server.
    await pipeline(Readable.fromWeb(up.body), res);
  } catch {
    if (!res.headersSent) {
      try { res.status(502).end(); } catch { /* ignore */ }
    } else {
      try { res.destroy(); } catch { /* ignore */ }
    }
  }
});

// --- Static + pages --------------------------------------------------------

app.use(
  express.static(publicDir, {
    etag: true,
    setHeaders(res) {
      // Always revalidate (cheap 304s). Avoids stale assets after a deploy.
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/display', (_req, res) => res.sendFile(path.join(publicDir, 'display.html')));

// --- Errors ----------------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'server-error', message: err.message });
});

// --- Boot ------------------------------------------------------------------

initStorage()
  .then(() => {
    app.listen(config.port, () => {
      console.log(
        `Flight Wall v${APP_VERSION} on :${config.port} ` +
          `(storage=${storageKind()}, pin=${isPinRequired() ? 'on' : 'off'})`
      );
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
