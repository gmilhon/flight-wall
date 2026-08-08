// Geospatial helpers and unit conversions.
// Raw aircraft values are kept in aviation-native units (feet, knots, ft/min)
// and converted for display on the client. The server only computes distance
// and bearing from the configured home location.

const R_KM = 6371.0088; // mean Earth radius

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in kilometres between two lat/lon points. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (degrees, 0=N, clockwise) from point 1 toward point 2. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Nautical miles <-> kilometres.
export const nmToKm = (nm) => nm * 1.852;
export const kmToNm = (km) => km / 1.852;

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
