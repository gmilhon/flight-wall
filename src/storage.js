// Pluggable settings storage keyed by screen id.
//
// A "screen" is one display (e.g. "main", "kitchen"). Each stores the settings
// the display renders and the control panel edits. Backends:
//   - firestore : durable, shared across Cloud Run instances (production)
//   - file      : ./data/screens.json (local dev, zero setup)
//   - memory    : in-process only (tests / fallback)
//
// A tiny read-through cache keeps display polling cheap.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { clamp } from './geo.js';

export const DEFAULT_SCREEN_ID = 'main';

/** Factory for a fresh default settings object for a given screen id. */
export function defaultSettings(screenId = DEFAULT_SCREEN_ID) {
  return {
    screenId,
    label: '',
    mode: 'area', // 'area' | 'flight'
    home: { lat: null, lon: null, label: '' },
    radiusNm: 15,
    units: 'aviation', // 'aviation' | 'metric' | 'imperial'
    maxFlights: 5,
    sort: 'distance', // 'distance' | 'altitude' | 'speed'
    theme: 'departure', // 'departure' | 'radar' | 'minimal'
    refreshSec: 10,
    sidePanel: 'map', // 'map' | 'radar' | 'off'
    showLogos: true,
    showAircraftIcons: true,
    alertOnAppear: true, // sound/visual alert when a tracked flight appears
    trackedFlights: [], // up to 5 callsigns / flight numbers
    // Live ATC audio. Channels can be panned left/center/right (e.g. two airports
    // in stereo). See docs/ATC_AUDIO.md for sources and terms.
    audio: { enabled: false, volume: 0.8, channels: [] },
    updatedAt: 0,
  };
}

const ONE_OF = {
  mode: ['area', 'flight'],
  units: ['aviation', 'metric', 'imperial'],
  sort: ['distance', 'altitude', 'speed'],
  theme: ['departure', 'radar', 'minimal'],
  sidePanel: ['map', 'radar', 'off'],
};

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanCallsign(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function cleanAudioUrl(u) {
  const s = String(u || '').trim().slice(0, 300);
  return /^https?:\/\//i.test(s) ? s : '';
}

function cleanChannel(c) {
  if (!c || typeof c !== 'object') return null;
  const url = cleanAudioUrl(c.url);
  const label = String(c.label ?? '').slice(0, 40);
  if (!url && !label) return null;
  return {
    label,
    url,
    pan: ['left', 'center', 'right'].includes(c.pan) ? c.pan : 'center',
    volume: clamp(num(c.volume, 1), 0, 1),
    proxy: Boolean(c.proxy),
  };
}

function cleanAudio(input, base) {
  let audio = base || { enabled: false, volume: 0.8, channels: [] };
  if (input && typeof input === 'object') {
    audio = {
      enabled: input.enabled === undefined ? audio.enabled : Boolean(input.enabled),
      volume: clamp(num(input.volume, audio.volume), 0, 1),
      channels: Array.isArray(input.channels)
        ? input.channels.map(cleanChannel).filter(Boolean).slice(0, 4)
        : audio.channels,
    };
  }
  return audio;
}

/**
 * Coerce arbitrary (untrusted) input into a valid settings object, merging
 * over the current/default settings so partial updates are allowed.
 */
export function sanitizeSettings(input, base) {
  const d = base || defaultSettings(input?.screenId);
  const src = input && typeof input === 'object' ? input : {};
  const home = src.home && typeof src.home === 'object' ? src.home : {};

  const lat = home.lat === null || home.lat === '' ? null : num(home.lat, d.home.lat);
  const lon = home.lon === null || home.lon === '' ? null : num(home.lon, d.home.lon);

  const tracked = Array.isArray(src.trackedFlights)
    ? src.trackedFlights.map(cleanCallsign).filter((s) => s.length >= 2).slice(0, 5)
    : d.trackedFlights;

  return {
    screenId: d.screenId,
    label: String(src.label ?? d.label).slice(0, 40),
    mode: pick(src.mode, ONE_OF.mode, d.mode),
    home: {
      lat: lat === null ? null : clamp(lat, -90, 90),
      lon: lon === null ? null : clamp(lon, -180, 180),
      label: String(home.label ?? d.home.label).slice(0, 60),
    },
    radiusNm: Math.round(clamp(num(src.radiusNm, d.radiusNm), 1, 250)),
    units: pick(src.units, ONE_OF.units, d.units),
    maxFlights: Math.round(clamp(num(src.maxFlights, d.maxFlights), 1, 8)),
    sort: pick(src.sort, ONE_OF.sort, d.sort),
    theme: pick(src.theme, ONE_OF.theme, d.theme),
    refreshSec: Math.round(clamp(num(src.refreshSec, d.refreshSec), 5, 60)),
    // Migrate legacy showRadar: false -> sidePanel 'off'.
    sidePanel: pick(
      src.sidePanel,
      ONE_OF.sidePanel,
      src.sidePanel === undefined && src.showRadar === false ? 'off' : d.sidePanel
    ),
    showLogos: src.showLogos === undefined ? d.showLogos : Boolean(src.showLogos),
    showAircraftIcons: src.showAircraftIcons === undefined ? d.showAircraftIcons : Boolean(src.showAircraftIcons),
    alertOnAppear: src.alertOnAppear === undefined ? d.alertOnAppear : Boolean(src.alertOnAppear),
    trackedFlights: tracked,
    audio: cleanAudio(src.audio, d.audio),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

function makeMemoryBackend() {
  const store = new Map();
  return {
    kind: 'memory',
    async get(id) {
      return store.get(id) || null;
    },
    async set(id, settings) {
      store.set(id, settings);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

function makeFileBackend() {
  const file = path.resolve(config.dataDir, 'screens.json');
  let ready = null;

  async function load() {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  async function save(all) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(all, null, 2));
  }

  return {
    kind: 'file',
    async get(id) {
      const all = await load();
      return all[id] || null;
    },
    async set(id, settings) {
      const all = await load();
      all[id] = settings;
      await save(all);
    },
    async list() {
      return Object.keys(await load());
    },
    _ready: ready,
  };
}

async function makeFirestoreBackend() {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore(
    config.projectId ? { projectId: config.projectId } : {}
  );
  const col = db.collection(config.firestoreCollection);
  // Probe once so we can fail fast and fall back if Firestore isn't reachable.
  await col.limit(1).get();
  return {
    kind: 'firestore',
    async get(id) {
      const snap = await col.doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async set(id, settings) {
      await col.doc(id).set(settings);
    },
    async list() {
      const snap = await col.get();
      return snap.docs.map((d) => d.id);
    },
  };
}

// ---------------------------------------------------------------------------
// Public API (backend-agnostic, with a short read cache)
// ---------------------------------------------------------------------------

let backend = null;
let backendKind = 'unknown';
const cache = new Map(); // id -> { settings, at }
const CACHE_MS = 4000;

export async function initStorage() {
  if (config.storage === 'firestore') {
    try {
      backend = await makeFirestoreBackend();
    } catch (err) {
      console.error(
        `[storage] Firestore unavailable (${err.message}); falling back to in-memory storage. ` +
          `Settings will not persist across restarts.`
      );
      backend = makeMemoryBackend();
    }
  } else if (config.storage === 'memory') {
    backend = makeMemoryBackend();
  } else {
    backend = makeFileBackend();
  }
  backendKind = backend.kind;
  console.log(`[storage] using ${backendKind} backend`);
  return backendKind;
}

export function storageKind() {
  return backendKind;
}

export async function getScreen(screenId) {
  const id = cleanScreenId(screenId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;

  let stored = await backend.get(id);
  if (!stored) stored = defaultSettings(id);
  // Merge stored over defaults so new fields appear for old documents.
  const settings = { ...defaultSettings(id), ...stored, screenId: id };
  cache.set(id, { settings, at: Date.now() });
  return settings;
}

export async function saveScreen(screenId, input) {
  const id = cleanScreenId(screenId);
  const current = await getScreen(id);
  const settings = sanitizeSettings({ ...input, screenId: id }, current);
  await backend.set(id, settings);
  cache.set(id, { settings, at: Date.now() });
  return settings;
}

export async function listScreens() {
  const ids = await backend.list();
  return ids.length ? ids : [DEFAULT_SCREEN_ID];
}

export function cleanScreenId(id) {
  const clean = String(id || DEFAULT_SCREEN_ID)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
  return clean || DEFAULT_SCREEN_ID;
}
