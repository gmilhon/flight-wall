// Flight Wall server: serves the control panel + display, and a small JSON API.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

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
