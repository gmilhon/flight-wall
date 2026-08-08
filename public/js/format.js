// Shared formatting helpers. Raw values are aviation-native (feet, knots,
// ft/min); each metric is converted to an explicit unit chosen by the user.

export function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(deg) {
  if (deg == null || !isFinite(deg)) return '';
  return COMPASS[Math.round((deg % 360) / 22.5) % 16];
}

// unit: 'aviation' (ft + flight levels) | 'ft' | 'm' | 'km'
export function fmtAltitude(altFt, unit, onGround) {
  if (onGround) return 'GND';
  if (altFt == null) return '—';
  if (unit === 'm') return `${Math.round(altFt * 0.3048).toLocaleString()} m`;
  if (unit === 'km') return `${(altFt * 0.0003048).toFixed(1)} km`;
  if (unit === 'aviation' && altFt >= 18000) {
    return `FL${String(Math.round(altFt / 100)).padStart(3, '0')}`;
  }
  return `${Math.round(altFt).toLocaleString()} ft`;
}

// unit: 'kt' | 'kmh' | 'mph' | 'ms'
export function fmtSpeed(gsKt, unit) {
  if (gsKt == null) return '—';
  if (unit === 'kmh') return `${Math.round(gsKt * 1.852)} km/h`;
  if (unit === 'mph') return `${Math.round(gsKt * 1.15078)} mph`;
  if (unit === 'ms') return `${Math.round(gsKt * 0.514444)} m/s`;
  return `${Math.round(gsKt)} kt`;
}

// unit: 'fpm' | 'ms'
export function fmtVert(fpm, unit) {
  if (fpm == null) return '—';
  if (fpm === 0) return unit === 'ms' ? '0 m/s' : '0';
  const sign = fpm > 0 ? '+' : '−';
  const mag = Math.abs(fpm);
  if (unit === 'ms') return `${sign}${(mag * 0.00508).toFixed(1)} m/s`;
  return `${sign}${Math.round(mag).toLocaleString()}`;
}

// unit: 'nm' | 'km' | 'mi'
export function fmtDistance(km, unit) {
  if (km == null) return '—';
  if (unit === 'km') return `${km.toFixed(1)} km`;
  if (unit === 'mi') return `${(km * 0.621371).toFixed(1)} mi`;
  return `${(km / 1.852).toFixed(1)} NM`;
}

export function fmtTrack(deg) {
  if (deg == null) return '—';
  return `${String(Math.round(deg) % 360).padStart(3, '0')}° ${compass(deg)}`;
}

export function distanceUnitLabel(unit) {
  return unit === 'km' ? 'km' : unit === 'mi' ? 'mi' : 'NM';
}

// Resolve a settings object into explicit per-metric units, honouring the
// preset (units) with optional per-metric overrides (altUnit/spdUnit/…).
export function resolveUnits(s) {
  const base = {
    aviation: { alt: 'aviation', spd: 'kt', vert: 'fpm', dist: 'nm' },
    metric: { alt: 'm', spd: 'kmh', vert: 'ms', dist: 'km' },
    imperial: { alt: 'ft', spd: 'mph', vert: 'fpm', dist: 'mi' },
  }[s?.units] || { alt: 'aviation', spd: 'kt', vert: 'fpm', dist: 'nm' };
  const pick = (v, d) => (v && v !== 'auto' ? v : d);
  return {
    alt: pick(s?.altUnit, base.alt),
    spd: pick(s?.spdUnit, base.spd),
    vert: pick(s?.vertUnit, base.vert),
    dist: pick(s?.distUnit, base.dist),
  };
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}
