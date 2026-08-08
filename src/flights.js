// Core flight processing: fetch live aircraft from the ADS-B upstreams,
// normalize them into a stable shape, compute distance/bearing from home,
// sort + limit, and enrich the shown aircraft with route/airline/type data.

import { config } from './config.js';
import { fetchJson } from './http.js';
import { haversineKm, bearingDeg, clamp } from './geo.js';
import { routeForCallsign, aircraftForReg, airlineFromCallsign } from './enrich.js';
import { IATA2ICAO } from './airlines.js';

const rawCache = new Map(); // key -> { data, at }

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cachedRaw(key) {
  const hit = rawCache.get(key);
  if (hit && Date.now() - hit.at < config.flightsCacheMs) return hit.data;
  return undefined;
}

// ---- Upstream fetchers -----------------------------------------------------

async function fetchArea(lat, lon, radiusNm) {
  const r = clamp(Math.round(radiusNm), 1, 250);
  const key = `area:${lat.toFixed(3)}:${lon.toFixed(3)}:${r}`;
  const c = cachedRaw(key);
  if (c) return c;

  let ac;
  try {
    const d = await fetchJson(`${config.adsbPrimary}/v2/point/${lat}/${lon}/${r}`);
    ac = d.ac || d.aircraft || [];
  } catch (primaryErr) {
    try {
      const d = await fetchJson(
        `${config.adsbFallback}/api/v2/lat/${lat}/lon/${lon}/dist/${r}`
      );
      ac = d.ac || d.aircraft || [];
    } catch (fallbackErr) {
      const e = new Error(
        `ADS-B upstreams unavailable (${primaryErr.message}; ${fallbackErr.message})`
      );
      e.upstream = true;
      throw e;
    }
  }
  rawCache.set(key, { data: ac, at: Date.now() });
  return ac;
}

async function fetchByCallsign(callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  if (!cs) return [];
  const key = `cs:${cs}`;
  const c = cachedRaw(key);
  if (c) return c;

  let ac = [];
  try {
    const d = await fetchJson(
      `${config.adsbPrimary}/v2/callsign/${encodeURIComponent(cs)}`
    );
    ac = d.ac || d.aircraft || [];
  } catch {
    ac = [];
  }
  rawCache.set(key, { data: ac, at: Date.now() });
  return ac;
}

// ---- Normalization ---------------------------------------------------------

function normalizeBase(a) {
  const altBaro = a.alt_baro;
  const onGround = altBaro === 'ground';
  return {
    hex: a.hex || null,
    callsign: String(a.flight || '').trim(),
    registration: String(a.r || '').trim(),
    lat: numOrNull(a.lat),
    lon: numOrNull(a.lon),
    altFt: onGround ? null : numOrNull(altBaro),
    onGround,
    gsKt: numOrNull(a.gs),
    trackDeg: numOrNull(a.track ?? a.true_heading),
    vertFpm: numOrNull(a.baro_rate ?? a.geom_rate),
    squawk: a.squawk || null,
    category: a.category || null,
    typeCode: String(a.t || '').trim() || null,
    typeDesc: a.desc || null, // some upstreams include a description
    emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
    seen: numOrNull(a.seen),
    // filled by enrichment:
    airline: null,
    origin: null,
    destination: null,
    aircraft: null,
    status: 'live',
  };
}

function withGeo(f, home) {
  if (home && home.lat != null && home.lon != null && f.lat != null && f.lon != null) {
    f.distanceKm = haversineKm(home.lat, home.lon, f.lat, f.lon);
    f.bearingDeg = bearingDeg(home.lat, home.lon, f.lat, f.lon);
  } else {
    f.distanceKm = null;
    f.bearingDeg = null;
  }
  return f;
}

async function enrich(f) {
  const [route, acDetail] = await Promise.all([
    routeForCallsign(f.callsign),
    aircraftForReg(f.registration),
  ]);
  f.airline = route?.airline || airlineFromCallsign(f.callsign);
  f.origin = route?.origin || null;
  f.destination = route?.destination || null;
  f.aircraft = {
    code: f.typeCode || acDetail?.icaoType || null,
    name: f.typeDesc || acDetail?.type || null,
    manufacturer: acDetail?.manufacturer || null,
    owner: acDetail?.owner || null,
  };
  return f;
}

function sortFlights(list, sort) {
  const ground = (f) => (f.onGround ? 1 : 0);
  const byDistance = (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
  const byAltitude = (a, b) => (b.altFt ?? -Infinity) - (a.altFt ?? -Infinity);
  const bySpeed = (a, b) => (b.gsKt ?? -Infinity) - (a.gsKt ?? -Infinity);
  const secondary = sort === 'altitude' ? byAltitude : sort === 'speed' ? bySpeed : byDistance;
  // Airborne traffic always outranks aircraft on the ground.
  list.sort((a, b) => ground(a) - ground(b) || secondary(a, b));
  return list;
}

// ---- Public entry points ---------------------------------------------------

/** Area mode: aircraft within the configured radius of home. */
export async function getAreaFlights(settings) {
  const { home } = settings;
  if (!home || home.lat == null || home.lon == null) {
    return { flights: [], note: 'no-home' };
  }
  const ac = await fetchArea(home.lat, home.lon, settings.radiusNm);
  let list = ac.map((a) => withGeo(normalizeBase(a), home));
  sortFlights(list, settings.sort);
  list = list.slice(0, settings.maxFlights);
  await Promise.all(list.map(enrich));
  return { flights: list };
}

/** Candidate ATC callsigns to search for a user-entered flight/callsign. */
function candidateCallsigns(entered) {
  const s = String(entered || '').trim().toUpperCase().replace(/\s+/g, '');
  const out = new Set([s]);
  const m = /^([A-Z]{2})(\d+)$/.exec(s); // IATA flight number, e.g. AA100
  if (m && IATA2ICAO[m[1]]) out.add(IATA2ICAO[m[1]] + m[2]);
  return [...out];
}

/** Flight mode: track specific callsigns/flight numbers (up to 5). */
export async function getTrackedFlights(settings) {
  const { home } = settings;
  const wanted = (settings.trackedFlights || []).slice(0, 5);

  const results = await Promise.all(
    wanted.map(async (entry) => {
      const candidates = candidateCallsigns(entry);
      const batches = await Promise.all(candidates.map(fetchByCallsign));
      const all = batches.flat();
      if (!all.length) {
        return { query: entry, status: 'not-found', flights: [] };
      }
      // Freshest position wins if multiple aircraft share a callsign.
      all.sort((a, b) => (a.seen ?? 999) - (b.seen ?? 999));
      const f = withGeo(normalizeBase(all[0]), home);
      f.query = entry;
      await enrich(f);
      return { query: entry, status: 'live', flights: [f] };
    })
  );

  // Flatten to a single ordered list, keeping placeholders for not-found ones.
  const flights = [];
  for (const r of results) {
    if (r.status === 'live') flights.push(r.flights[0]);
    else flights.push({ query: r.query, status: 'not-found', callsign: r.query });
  }
  return { flights };
}

/** Dispatch based on the screen's mode. */
export async function getFlightsForScreen(settings) {
  if (settings.mode === 'flight') return getTrackedFlights(settings);
  return getAreaFlights(settings);
}
