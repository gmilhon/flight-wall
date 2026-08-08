// Core flight processing: fetch live aircraft from the ADS-B upstreams,
// normalize them into a stable shape, compute distance/bearing from home,
// sort + limit, and enrich the shown aircraft with route/airline/type data.

import { config } from './config.js';
import { fetchJson } from './http.js';
import { haversineKm, bearingDeg, clamp, kmToNm, pointInPolygon, polygonCenter } from './geo.js';
import { routeForCallsign, aircraftForReg, airlineFromCallsign } from './enrich.js';
import { IATA2ICAO } from './airlines.js';
import { recordSightings, getSeenCount } from './sightings.js';
import { aircraftCategory, uiCategory } from './aircraft-category.js';

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
    acCategory: aircraftCategory(a.t, a.category),
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

// Display filters (type / altitude / airline allow-list). Applied to the full
// in-range list before sorting and limiting.
function passesFilters(f, filters) {
  if (!filters) return true;
  const types = filters.types;
  if (Array.isArray(types) && types.length && types.length < 5 &&
      !types.includes(uiCategory(f.acCategory))) {
    return false;
  }
  if (filters.altMinFt != null && (f.altFt == null || f.altFt < filters.altMinFt)) return false;
  if (filters.altMaxFt != null && f.altFt != null && f.altFt > filters.altMaxFt) return false;
  const airlines = filters.airlines;
  if (Array.isArray(airlines) && airlines.length) {
    const icao = airlineFromCallsign(f.callsign)?.icao;
    if (!icao) return false;
    const allowed = airlines.map((a) => (a.length === 2 ? IATA2ICAO[a] : a));
    if (!allowed.includes(icao)) return false;
  }
  return true;
}

// ---- Public entry points ---------------------------------------------------

/** Area mode: aircraft within the configured radius of home. */
function centerOf(area) {
  return area.type === 'polygon' ? polygonCenter(area.points) : { lat: area.lat, lon: area.lon };
}

// Distance/bearing from the NEAREST area center, so far-away areas aren't sorted
// out by a single home reference.
function withNearest(f, centers) {
  if (f.lat != null && f.lon != null && centers.length) {
    let best = Infinity, bc = centers[0];
    for (const c of centers) {
      const d = haversineKm(c.lat, c.lon, f.lat, f.lon);
      if (d < best) { best = d; bc = c; }
    }
    f.distanceKm = best;
    f.bearingDeg = bearingDeg(bc.lat, bc.lon, f.lat, f.lon);
  } else {
    f.distanceKm = null;
    f.bearingDeg = null;
  }
  return f;
}

// Fetch raw aircraft for one area (radius, or a polygon via bounding circle + filter).
async function fetchAreaRaw(area) {
  if (area.type === 'polygon') {
    if (!Array.isArray(area.points) || area.points.length < 3) return [];
    const c = polygonCenter(area.points);
    const rKm = Math.max(...area.points.map((p) => haversineKm(c.lat, c.lon, p.lat, p.lon)));
    const rNm = clamp(Math.ceil(kmToNm(rKm)) + 1, 1, 250);
    const ac = await fetchArea(c.lat, c.lon, rNm);
    return ac.filter((a) => a.lat != null && a.lon != null && pointInPolygon(a.lat, a.lon, area.points));
  }
  if (area.lat == null || area.lon == null) return [];
  return fetchArea(area.lat, area.lon, clamp(area.radiusNm || 15, 1, 250));
}

export async function getAreaFlights(settings) {
  const { home } = settings;
  const areas = [];
  if (home && home.lat != null && home.lon != null) {
    areas.push({ type: 'radius', lat: home.lat, lon: home.lon, radiusNm: settings.radiusNm });
  }
  for (const a of settings.areas || []) areas.push(a);
  if (!areas.length) return { flights: [], note: 'no-home' };

  const centers = areas.map(centerOf);
  const batches = await Promise.all(areas.map((a) => fetchAreaRaw(a).catch(() => [])));
  // Merge overlapping areas, deduping by aircraft.
  const byKey = new Map();
  for (const ac of batches) {
    for (const a of ac) {
      const k = a.hex || `${a.flight || ''}|${a.r || ''}`;
      if (!byKey.has(k)) byKey.set(k, a);
    }
  }
  let list = [...byKey.values()].map((a) => withNearest(normalizeBase(a), centers));
  if (settings.showSightings !== false) await recordSightings(settings.screenId, list);
  if (settings.filters) list = list.filter((f) => passesFilters(f, settings.filters));
  sortFlights(list, settings.sort);
  list = list.slice(0, settings.maxFlights);
  await Promise.all(list.map(enrich));
  if (settings.showSightings !== false) {
    for (const f of list) f.seenCount = getSeenCount(settings.screenId, f.registration);
  }
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
  if (settings.showSightings !== false) {
    const live = flights.filter((f) => f.status !== 'not-found');
    await recordSightings(settings.screenId, live);
    for (const f of live) f.seenCount = getSeenCount(settings.screenId, f.registration);
  }
  return { flights };
}

/** Dispatch based on the screen's mode. */
export async function getFlightsForScreen(settings) {
  if (settings.mode === 'flight') return getTrackedFlights(settings);
  return getAreaFlights(settings);
}
