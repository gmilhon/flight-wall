// Shared formatting helpers. Raw values are aviation-native (feet, knots,
// ft/min); we convert for display based on the chosen unit system.

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

export function fmtAltitude(altFt, units, onGround) {
  if (onGround) return 'GND';
  if (altFt == null) return '—';
  if (units === 'metric') return `${Math.round(altFt * 0.3048).toLocaleString()} m`;
  if (units === 'aviation' && altFt >= 18000) {
    return `FL${String(Math.round(altFt / 100)).padStart(3, '0')}`;
  }
  return `${Math.round(altFt).toLocaleString()} ft`;
}

export function fmtSpeed(gsKt, units) {
  if (gsKt == null) return '—';
  if (units === 'metric') return `${Math.round(gsKt * 1.852)} km/h`;
  if (units === 'imperial') return `${Math.round(gsKt * 1.15078)} mph`;
  return `${Math.round(gsKt)} kt`;
}

export function fmtVert(fpm, units) {
  if (fpm == null) return '—';
  if (fpm === 0) return units === 'metric' ? '0 m/s' : '0';
  const sign = fpm > 0 ? '+' : '−';
  const mag = Math.abs(fpm);
  if (units === 'metric') return `${sign}${(mag * 0.00508).toFixed(1)} m/s`;
  return `${sign}${Math.round(mag).toLocaleString()}`;
}

export function fmtDistance(km, units) {
  if (km == null) return '—';
  if (units === 'metric') return `${km.toFixed(1)} km`;
  if (units === 'imperial') return `${(km * 0.621371).toFixed(1)} mi`;
  return `${(km / 1.852).toFixed(1)} NM`;
}

export function fmtTrack(deg) {
  if (deg == null) return '—';
  return `${String(Math.round(deg) % 360).padStart(3, '0')}° ${compass(deg)}`;
}

export function distanceUnitLabel(units) {
  return units === 'metric' ? 'km' : units === 'imperial' ? 'mi' : 'NM';
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}
