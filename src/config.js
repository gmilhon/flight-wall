// Central configuration, all overridable via environment variables.
// Sensible defaults let the app run locally with zero setup (file storage),
// and switch to Firestore automatically when running on Cloud Run.

const onCloudRun = Boolean(process.env.K_SERVICE);

export const config = {
  // HTTP
  port: Number(process.env.PORT) || 8080,

  // Optional PIN that protects settings writes (POST /api/settings).
  // Reads and the display stay public. Empty string = no PIN required.
  controlPin: process.env.CONTROL_PIN || '',

  // Storage backend: 'firestore' | 'file' | 'memory'.
  // Defaults to Firestore on Cloud Run, file storage locally.
  storage: process.env.STORAGE || (onCloudRun ? 'firestore' : 'file'),
  projectId:
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || undefined,
  firestoreCollection: process.env.FS_COLLECTION || 'screens',
  sightingsCollection: process.env.FS_SIGHTINGS || 'sightings',
  dataDir: process.env.DATA_DIR || './data',

  // Tail-number sighting counts: only count a new "visit" after this gap, cap
  // stored tails per screen, prune single sightings older than N days, and
  // persist to durable storage at most this often.
  sightingDebounceMs: Number(process.env.SIGHTING_DEBOUNCE_MS) || 3600000,
  sightingFlushMs: Number(process.env.SIGHTING_FLUSH_MS) || 120000,
  sightingMax: Number(process.env.SIGHTING_MAX) || 1500,
  sightingPruneDays: Number(process.env.SIGHTING_PRUNE_DAYS) || 30,

  // Upstream data sources (all free, no API key required).
  adsbPrimary: process.env.ADSB_PRIMARY || 'https://api.adsb.lol',
  adsbFallback: process.env.ADSB_FALLBACK || 'https://opendata.adsb.fi',
  adsbdb: process.env.ADSBDB || 'https://api.adsbdb.com',
  userAgent:
    process.env.USER_AGENT ||
    'flight-wall/1.0 (+https://github.com/gmilhon/flight-wall)',

  // Cache windows (ms). Keep us fast and polite to the free upstreams.
  flightsCacheMs: Number(process.env.FLIGHTS_CACHE_MS) || 8000,
  routeCacheMs: Number(process.env.ROUTE_CACHE_MS) || 6 * 3600 * 1000,
  aircraftCacheMs: Number(process.env.AIRCRAFT_CACHE_MS) || 24 * 3600 * 1000,
  negativeCacheMs: Number(process.env.NEGATIVE_CACHE_MS) || 60 * 60 * 1000,

  // Upstream request timeout (ms).
  fetchTimeoutMs: Number(process.env.FETCH_TIMEOUT_MS) || 9000,

  onCloudRun,
};

export function isPinRequired() {
  return Boolean(config.controlPin);
}
