// Airline branding: a deterministic brand colour and a logo URL per airline.
// Brand colours for major carriers, with a stable hashed colour for the rest.
// Logos come from the free avs.io CDN (by IATA code); a monogram SVG is the
// fallback when no IATA code is known.

// ICAO -> { c: brand colour, i: IATA code }
const BRAND = {
  AAL: { c: '#0078d2', i: 'AA' }, DAL: { c: '#e01933', i: 'DL' },
  UAL: { c: '#1414c8', i: 'UA' }, SWA: { c: '#304cb2', i: 'WN' },
  ASA: { c: '#01426a', i: 'AS' }, JBU: { c: '#0033a0', i: 'B6' },
  NKS: { c: '#ffec00', i: 'NK' }, FFT: { c: '#00854a', i: 'F9' },
  HAL: { c: '#5b2b82', i: 'HA' }, SKW: { c: '#1f6fb2', i: 'OO' },
  ACA: { c: '#d22630', i: 'AC' }, WJA: { c: '#00a7e1', i: 'WS' },
  DLH: { c: '#0a1d3f', i: 'LH' }, BAW: { c: '#21469b', i: 'BA' },
  AFR: { c: '#002157', i: 'AF' }, KLM: { c: '#00a1de', i: 'KL' },
  UAE: { c: '#d71921', i: 'EK' }, QTR: { c: '#5c0632', i: 'QR' },
  ETD: { c: '#bd8b13', i: 'EY' }, SIA: { c: '#1a3668', i: 'SQ' },
  CPA: { c: '#006564', i: 'CX' }, ANA: { c: '#13448f', i: 'NH' },
  JAL: { c: '#c30d24', i: 'JL' }, KAL: { c: '#0f4c99', i: 'KE' },
  THY: { c: '#e81932', i: 'TK' }, SAS: { c: '#003d87', i: 'SK' },
  QFA: { c: '#e40000', i: 'QF' }, RYR: { c: '#073590', i: 'FR' },
  EZY: { c: '#ff6600', i: 'U2' }, VIR: { c: '#e10a0a', i: 'VS' },
  IBE: { c: '#d80031', i: 'IB' }, SWR: { c: '#e30614', i: 'LX' },
  AUA: { c: '#e30614', i: 'OS' }, EIN: { c: '#00a04b', i: 'EI' },
  FIN: { c: '#0b1560', i: 'AY' }, ICE: { c: '#00205b', i: 'FI' },
  AMX: { c: '#0b2265', i: 'AM' }, AVA: { c: '#d3222a', i: 'AV' },
  LAN: { c: '#1b0088', i: 'LA' }, GLO: { c: '#ff6a13', i: 'G3' },
  AZU: { c: '#00a1e0', i: 'AD' }, CES: { c: '#1c57a5', i: 'MU' },
  CCA: { c: '#e2231a', i: 'CA' }, CSN: { c: '#1c57a5', i: 'CZ' },
  FDX: { c: '#4d148c', i: 'FX' }, UPS: { c: '#644117', i: '5X' },
};

// Extra ICAO -> IATA (no distinct brand colour needed) for logo lookups.
const ICAO2IATA = {
  QXE: 'QX', CMP: 'CM', VOI: 'Y4', VOZ: 'VA', JST: 'JQ', TAM: 'JJ',
  MAS: 'MH', THA: 'TG', GIA: 'GA', SVA: 'SV', MSR: 'MS', RJA: 'RJ',
  ELY: 'LY', AEE: 'A3', TAP: 'TP', BEL: 'SN', LOT: 'LO', CTN: 'OU',
  WZZ: 'W6', NAX: 'DY', VLG: 'VY', ROU: 'RV', EVA: 'BR', CAL: 'CI',
  PAL: 'PR', GTI: '5Y', CLX: 'CV', BOX: 'BCS',
};

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Brand colour for an airline object {icao, iata, name}. */
export function airlineColor(airline) {
  if (!airline) return null;
  const icao = (airline.icao || '').toUpperCase();
  if (BRAND[icao]) return BRAND[icao].c;
  const seed = icao || airline.iata || airline.name || '';
  if (!seed) return null;
  return `hsl(${hashHue(seed)} 62% 55%)`;
}

/** Best-effort IATA code for logo lookups. */
export function airlineIata(airline) {
  if (!airline) return null;
  if (airline.iata) return airline.iata.toUpperCase();
  const icao = (airline.icao || '').toUpperCase();
  return BRAND[icao]?.i || ICAO2IATA[icao] || null;
}

/** Shorten an airline name for a compact pill: "SkyWest Airlines" -> "SkyWest". */
export function shortAirlineName(name) {
  if (!name) return name;
  return name.replace(/\s+(air\s?lines?|airways|air)$/i, '').trim() || name;
}

/** A readable text colour (#111 or #fff) for text placed on `color`. */
export function textOn(color) {
  if (!color) return '#fff';
  if (color.startsWith('hsl')) {
    const m = /hsl\(\s*[\d.]+[,\s]+[\d.]+%[,\s]+([\d.]+)%/.exec(color);
    return m && parseFloat(m[1]) > 62 ? '#111827' : '#fff';
  }
  let h = color.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#111827' : '#fff';
}

/** avs.io logo URL for an IATA code, or null. */
export function airlineLogoUrl(iata, w = 120, h = 120) {
  if (!iata) return null;
  return `https://pics.avs.io/${w}/${h}/${encodeURIComponent(iata)}.png`;
}

/** Inline monogram SVG (1-2 letters on the brand colour) as a fallback. */
export function airlineMonogram(airline, color) {
  const icao = (airline?.icao || '').toUpperCase();
  const iata = (airline?.iata || '').toUpperCase();
  const letters = (iata || icao || '?').slice(0, 3);
  const c = color || airlineColor(airline) || '#888';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="100" height="100" rx="18" fill="${c}"/>
    <text x="50" y="50" dy="0.35em" text-anchor="middle"
      font-family="system-ui, sans-serif" font-weight="700"
      font-size="${letters.length > 2 ? 34 : 44}" fill="#fff">${letters}</text>
  </svg>`;
}
