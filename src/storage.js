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
    units: 'aviation', // 'aviation' | 'metric' | 'imperial' (preset)
    altUnit: 'auto', spdUnit: 'auto', vertUnit: 'auto', distUnit: 'auto', // per-metric overrides
    titleMode: 'flight', // 'flight' (callsign) | 'airline' (airline name)
    maxFlights: 5,
    sort: 'distance', // 'distance' | 'altitude' | 'speed'
    theme: 'departure', // 'departure' | 'radar' | 'minimal'
    refreshSec: 10,
    sidePanel: 'map', // 'map' | 'radar' | 'off'
    layout: 'board', // 'board' (multi-row) | 'cycle' (single flight, auto-cycling)
    cycleSec: 5, // seconds each flight shows in cycle mode
    showLogos: true,
    showAircraftIcons: true,
    alertOnAppear: true, // sound/visual alert when a tracked flight appears
    showSightings: true, // count repeat tail numbers and badge them
    // Display filters (area mode). Empty/complete = no filtering.
    filters: {
      types: ['commercial', 'smalljet', 'light', 'heli', 'other'],
      altMinFt: null,
      altMaxFt: null,
      airlines: [],
    },
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
  layout: ['board', 'cycle'],
  titleMode: ['flight', 'airline'],
  altUnit: ['auto', 'aviation', 'ft', 'm', 'km'],
  spdUnit: ['auto', 'kt', 'kmh', 'mph', 'ms'],
  vertUnit: ['auto', 'fpm', 'ms'],
  distUnit: ['auto', 'nm', 'km', 'mi'],
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

const FILTER_TYPES = ['commercial', 'smalljet', 'light', 'heli', 'other'];
function cleanFilters(input, base) {
  const b = base || { types: [...FILTER_TYPES], altMinFt: null, altMaxFt: null, airlines: [] };
  if (!input || typeof input !== 'object') return b;
  let types = Array.isArray(input.types) ? input.types.filter((t) => FILTER_TYPES.includes(t)) : b.types;
  if (!types.length) types = [...FILTER_TYPES]; // at least one type must show
  const bound = (v, dflt) => (v == null || v === '' ? null : Math.round(clamp(num(v, dflt), 0, 60000)));
  const airlines = Array.isArray(input.airlines)
    ? [...new Set(input.airlines.map((a) => String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)).filter((a) => a.length >= 2))].slice(0, 10)
    : b.airlines;
  return { types, altMinFt: bound(input.altMinFt, 0), altMaxFt: bound(input.altMaxFt, 60000), airlines };
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
    altUnit: pick(src.altUnit, ONE_OF.altUnit, d.altUnit),
    spdUnit: pick(src.spdUnit, ONE_OF.spdUnit, d.spdUnit),
    vertUnit: pick(src.vertUnit, ONE_OF.vertUnit, d.vertUnit),
    distUnit: pick(src.distUnit, ONE_OF.distUnit, d.distUnit),
    titleMode: pick(src.titleMode, ONE_OF.titleMode, d.titleMode),
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
    layout: pick(src.layout, ONE_OF.layout, d.layout),
    cycleSec: Math.round(clamp(num(src.cycleSec, d.cycleSec), 2, 30)),
    showLogos: src.showLogos === undefined ? d.showLogos : Boolean(src.showLogos),
    showAircraftIcons: src.showAircraftIcons === undefined ? d.showAircraftIcons : Boolean(src.showAircraftIcons),
    alertOnAppear: src.alertOnAppear === undefined ? d.alertOnAppear : Boolean(src.alertOnAppear),
    showSightings: src.showSightings === undefined ? d.showSightings : Boolean(src.showSightings),
    filters: cleanFilters(src.filters, d.filters),
    trackedFlights: tracked,
    audio: cleanAudio(src.audio, d.audio),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

// Backends are generic key/value stores over a named "store" (collection/file),
// so settings and sightings share one backend in different namespaces.
function makeMemoryBackend() {
  const stores = new Map();
  const s = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    kind: 'memory',
    async get(store, id) { return s(store).get(id) || null; },
    async set(store, id, value) { s(store).set(id, value); },
    async list(store) { return [...s(store).keys()]; },
  };
}

function makeFileBackend() {
  const fileFor = (store) => path.resolve(config.dataDir, `${store}.json`);
  async function load(store) {
    try {
      return JSON.parse(await fs.readFile(fileFor(store), 'utf8'));
    } catch {
      return {};
    }
  }
  async function save(store, all) {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(fileFor(store), JSON.stringify(all, null, 2));
  }
  return {
    kind: 'file',
    async get(store, id) { return (await load(store))[id] || null; },
    async set(store, id, value) {
      const all = await load(store);
      all[id] = value;
      await save(store, all);
    },
    async list(store) { return Object.keys(await load(store)); },
  };
}

async function makeFirestoreBackend() {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore(
    config.projectId ? { projectId: config.projectId } : {}
  );
  // Probe once so we can fail fast and fall back if Firestore isn't reachable.
  await db.collection(config.firestoreCollection).limit(1).get();
  return {
    kind: 'firestore',
    async get(store, id) {
      const snap = await db.collection(store).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async set(store, id, value) {
      await db.collection(store).doc(id).set(value);
    },
    async list(store) {
      const snap = await db.collection(store).get();
      return snap.docs.map((d) => d.id);
    },
  };
}

// ---------------------------------------------------------------------------
// Public API (backend-agnostic, with a short read cache)
// ---------------------------------------------------------------------------

const SCREENS = config.firestoreCollection || 'screens';
const SIGHTINGS = config.sightingsCollection || 'sightings';

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

  let stored = await backend.get(SCREENS, id);
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
  await backend.set(SCREENS, id, settings);
  cache.set(id, { settings, at: Date.now() });
  return settings;
}

export async function listScreens() {
  const ids = await backend.list(SCREENS);
  return ids.length ? ids : [DEFAULT_SCREEN_ID];
}

// Sightings persistence (separate namespace; driven by src/sightings.js).
export async function loadSightings(screenId) {
  return backend.get(SIGHTINGS, cleanScreenId(screenId));
}
export async function storeSightings(screenId, data) {
  await backend.set(SIGHTINGS, cleanScreenId(screenId), data);
}

export function cleanScreenId(id) {
  const clean = String(id || DEFAULT_SCREEN_ID)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
  return clean || DEFAULT_SCREEN_ID;
}
