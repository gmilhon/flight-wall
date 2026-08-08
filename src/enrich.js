// Flight enrichment via adsbdb.com (free, no key): maps a callsign to its
// airline + route (origin/destination) and a registration to aircraft details.
// Everything is cached in-process, including negative lookups, so we stay well
// within the free upstreams' limits.

import { config } from './config.js';
import { fetchJson } from './http.js';
import { AIRLINES } from './airlines.js';

const routeCache = new Map(); // callsign -> { value, at, ttl }
const aircraftCache = new Map(); // registration -> { value, at, ttl }

function cacheGet(map, key) {
  const e = map.get(key);
  if (e && Date.now() - e.at < e.ttl) return e.value;
  return undefined;
}
function cacheSet(map, key, value, ttl) {
  map.set(key, { value, at: Date.now(), ttl });
}

function mapAirport(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || null,
    icao: a.icao_code || null,
    name: a.name || null,
    city: a.municipality || null,
    country: a.country_iso_name || null,
    lat: a.latitude ?? null,
    lon: a.longitude ?? null,
  };
}

/** Airline + origin + destination for an ATC callsign, or null if unknown. */
export async function routeForCallsign(callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  if (!cs) return null;
  const cached = cacheGet(routeCache, cs);
  if (cached !== undefined) return cached;

  let value = null;
  try {
    const data = await fetchJson(
      `${config.adsbdb}/v0/callsign/${encodeURIComponent(cs)}`
    );
    const fr = data?.response?.flightroute;
    if (fr) {
      value = {
        airline: fr.airline
          ? { name: fr.airline.name, icao: fr.airline.icao, iata: fr.airline.iata }
          : null,
        origin: mapAirport(fr.origin),
        destination: mapAirport(fr.destination),
      };
    }
  } catch (err) {
    if (err.status && err.status !== 404) {
      cacheSet(routeCache, cs, null, 60 * 1000); // transient: retry soon
      return null;
    }
  }
  cacheSet(routeCache, cs, value, value ? config.routeCacheMs : config.negativeCacheMs);
  return value;
}

/** Aircraft type/manufacturer/owner for a registration, or null. */
export async function aircraftForReg(reg) {
  const r = String(reg || '').trim().toUpperCase();
  if (!r) return null;
  const cached = cacheGet(aircraftCache, r);
  if (cached !== undefined) return cached;

  let value = null;
  try {
    const data = await fetchJson(
      `${config.adsbdb}/v0/aircraft/${encodeURIComponent(r)}`
    );
    const ac = data?.response?.aircraft;
    if (ac) {
      value = {
        type: ac.type || null,
        icaoType: ac.icao_type || null,
        manufacturer: ac.manufacturer || null,
        owner: ac.registered_owner || null,
      };
    }
  } catch (err) {
    if (err.status && err.status !== 404) {
      cacheSet(aircraftCache, r, null, 60 * 1000);
      return null;
    }
  }
  cacheSet(aircraftCache, r, value, value ? config.aircraftCacheMs : config.negativeCacheMs);
  return value;
}

/** Best-effort airline name from an ICAO callsign prefix (offline fallback). */
export function airlineFromCallsign(callsign) {
  const m = /^([A-Z]{3})\d/.exec(String(callsign || '').trim().toUpperCase());
  if (!m) return null;
  return { name: AIRLINES[m[1]] || null, icao: m[1], iata: null };
}
