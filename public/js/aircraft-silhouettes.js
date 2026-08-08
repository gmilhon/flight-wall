// Aircraft type silhouettes (top-view, nose-up). The category string is computed
// server-side (src/aircraft-category.js) and sent as f.acCategory; this module
// just renders the matching shape for the card icon and the rotated map marker.

// Swept-wing jet (nose up, centred on 32,32). Engines added separately.
const JET = 'M32 5c-1.6 0-2.7 1.4-2.9 3.6l-.4 13.5-20 11.5 0 3.6 20.4-7.2-.2 12.8-5.6 4.4 0 3 5.4-2 0 5.2c.2 2 1.2 3.4 3.3 3.4s3.1-1.4 3.3-3.4l0-5.2 5.4 2 0-3-5.6-4.4-.2-12.8 20.4 7.2 0-3.6-20-11.5-.4-13.5c-.2-2.2-1.3-3.6-2.9-3.6z';
// Straight-wing prop aircraft (nose up).
const PROP = 'M32 8c-1.3 0-2.2 1-2.3 2.6l-.3 15-21 3.4 0 3.4 21-1.4-.2 16-6 2.4 0 2.8 6-1 0 4.4c.1 1.4 1 2.4 2.3 2.4s2.2-1 2.3-2.4l0-4.4 6 1 0-2.8-6-2.4-.2-16 21 1.4 0-3.4-21-3.4-.3-15c-.1-1.6-1-2.6-2.3-2.6z';

function engines(cx, positions, r = 2.1) {
  return positions.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
}

function shapeFor(category) {
  switch (category) {
    case 'widebody':
      return `<g><path d="${JET}" transform="translate(32 32) scale(1.12) translate(-32 -32)"/>${engines(32, [[22, 27], [17, 30], [42, 27], [47, 30]])}</g>`;
    case 'regional':
      return `<g><path d="${JET}" transform="translate(32 32) scale(0.86) translate(-32 -32)"/>${engines(32, [[28.5, 43], [35.5, 43]], 1.9)}</g>`;
    case 'bizjet':
      return `<g><path d="${JET}" transform="translate(32 32) scale(0.78) translate(-32 -32)"/>${engines(32, [[29, 42], [35, 42]], 1.7)}</g>`;
    case 'turboprop':
      return `<g><path d="${PROP}"/>` +
        `<ellipse cx="12" cy="26" rx="2" ry="6"/><ellipse cx="52" cy="26" rx="2" ry="6"/></g>`;
    case 'piston':
      return `<g><path d="${PROP}" transform="translate(32 32) scale(0.82) translate(-32 -32)"/>` +
        `<ellipse cx="32" cy="9" rx="8.5" ry="1.9"/></g>`;
    case 'heli':
      return `<g><ellipse cx="32" cy="32" rx="6.5" ry="11"/>` +
        `<rect x="30.5" y="40" width="3" height="17" rx="1.5"/>` +
        `<rect x="30" y="53" width="10" height="2.6" rx="1.3"/>` +
        `<rect x="7" y="30.5" width="50" height="2.4" rx="1.2" transform="rotate(32 32 26)"/>` +
        `<rect x="7" y="30.5" width="50" height="2.4" rx="1.2" transform="rotate(-32 32 26)"/>` +
        `<circle cx="32" cy="26" r="2.4"/></g>`;
    case 'narrowbody':
    default:
      return `<g><path d="${JET}"/>${engines(32, [[22.5, 26], [41.5, 26]])}</g>`;
  }
}

/** Full inline <svg> for a category. Fill inherits `currentColor`. */
export function aircraftIconSvg(category, className = '') {
  return `<svg class="${className}" viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${shapeFor(category)}</svg>`;
}
