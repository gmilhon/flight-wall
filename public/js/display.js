// Display app: full-screen, auto-refreshing view of overhead / tracked flights.
import { getState } from './api.js';
import {
  escapeHtml,
  fmtAltitude,
  fmtSpeed,
  fmtVert,
  fmtDistance,
  fmtTrack,
  distanceUnitLabel,
  pad2,
} from './format.js';

const screenId = new URLSearchParams(location.search).get('screen') || 'main';

const el = (id) => document.getElementById(id);
const app = el('app');
const board = el('board');
const radarWrap = el('radarWrap');
const canvas = el('radar');
const ctx = canvas.getContext('2d');

let settings = null;
let flights = [];
let lastGoodAt = 0;
let failCount = 0;
let refreshSec = 10;
let pollTimer = null;

// --- Clock -----------------------------------------------------------------
function tickClock() {
  const d = new Date();
  el('clock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// --- Rendering -------------------------------------------------------------
function routeHtml(f, units) {
  const o = f.origin, d = f.destination;
  if (o?.iata || d?.iata) {
    const cities = [o?.city, d?.city].filter(Boolean).join(' – ');
    return `<div class="route">
      <span class="ap">${escapeHtml(o?.iata || '???')}</span>
      <span class="arrow">→</span>
      <span class="ap">${escapeHtml(d?.iata || '???')}</span>
      ${cities ? `<span class="cities">${escapeHtml(cities)}</span>` : ''}
    </div>`;
  }
  // No route (often general aviation): show distance/bearing context instead.
  const dist = f.distanceKm != null ? `${fmtDistance(f.distanceKm, units)} away` : '';
  return `<div class="route muted">${escapeHtml(dist || 'Local traffic')}</div>`;
}

function metric(label, value) {
  return `<div class="metric"><label>${label}</label><span>${escapeHtml(value)}</span></div>`;
}

function flightCard(f, units) {
  if (f.status === 'not-found') {
    return `<article class="flight not-found">
      <div class="ident"><div class="flightno">${escapeHtml(f.callsign || f.query || '—')}</div>
      <div class="route muted">Awaiting signal…</div></div>
      <div class="await">NO SIGNAL</div>
    </article>`;
  }
  const callsign = f.callsign || f.hex || '—';
  const airline = f.airline?.name ? `<span class="airline">${escapeHtml(f.airline.name)}</span>` : '';
  const type = f.aircraft?.name || f.aircraft?.code || '';
  const emerg = f.emergency ? `<span class="emerg">${escapeHtml(f.emergency)}</span>` : '';
  return `<article class="flight">
    <div class="ident">
      <div class="flightno"><span class="cs">${escapeHtml(callsign)}</span>${airline}${emerg}</div>
      ${routeHtml(f, units)}
    </div>
    <div class="metrics">
      ${metric('ALT', fmtAltitude(f.altFt, units, f.onGround))}
      ${metric('SPD', fmtSpeed(f.gsKt, units))}
      ${metric('TRK', fmtTrack(f.trackDeg))}
      ${metric('V/S', fmtVert(f.vertFpm, units))}
      ${metric('DIST', fmtDistance(f.distanceKm, units))}
    </div>
    <div class="actype">${escapeHtml(type)}</div>
  </article>`;
}

function render() {
  if (!settings) return;
  app.dataset.theme = settings.theme || 'departure';
  app.dataset.mode = settings.mode || 'area';

  const homeLabel = settings.home?.label || (settings.home?.lat != null
    ? `${settings.home.lat.toFixed(2)}, ${settings.home.lon.toFixed(2)}`
    : '');
  el('homeLabel').textContent = homeLabel;
  el('modeLabel').textContent = settings.mode === 'flight' ? 'TRACKING' : 'OVERHEAD';

  const units = settings.units || 'aviation';
  const noHome = settings.mode === 'area' && (settings.home?.lat == null);
  const showRadar =
    settings.showRadar && settings.mode === 'area' && !noHome &&
    flights.some((f) => f.bearingDeg != null);

  app.classList.toggle('no-radar', !showRadar);
  radarWrap.hidden = !showRadar;

  if (noHome) {
    board.innerHTML = `<div class="empty"><div class="big">Set your location</div>
      <div class="sub">Open the control panel and set your home location to begin.</div>
      <div class="url">${escapeHtml(location.origin)}/</div></div>`;
  } else if (!flights.length) {
    const r = settings.radiusNm;
    board.innerHTML = `<div class="empty"><div class="big">No aircraft overhead</div>
      <div class="sub">Watching a ${r} NM radius. Standing by…</div></div>`;
  } else {
    board.innerHTML = flights.map((f) => flightCard(f, units)).join('');
  }

  el('count').textContent = flights.length
    ? `${flights.filter((f) => f.status !== 'not-found').length} aircraft`
    : '';

  if (showRadar) drawRadar(units);
  updateStatus();
}

function updateStatus() {
  const stale = lastGoodAt && Date.now() - lastGoodAt > refreshSec * 3000;
  el('status').innerHTML = stale
    ? '<span class="dot warn"></span> reconnecting'
    : '<span class="dot ok"></span> live';
  if (lastGoodAt) {
    const d = new Date(lastGoodAt);
    el('stamp').textContent = `updated ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

// --- Radar -----------------------------------------------------------------
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const size = Math.max(80, Math.min(rect.width, rect.height));
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return size;
}

function drawRadar(units) {
  if (radarWrap.hidden) return;
  const size = sizeCanvas();
  const cx = size / 2, cy = size / 2;
  const pad = 10;
  const R = Math.min(cx, cy) - pad;
  const maxRangeKm = Math.max(1, settings.radiusNm) * 1.852;
  const css = getComputedStyle(app);
  const line = css.getPropertyValue('--radar-line').trim() || 'rgba(255,255,255,0.18)';
  const accent = css.getPropertyValue('--accent').trim() || '#ffb000';

  ctx.clearRect(0, 0, size, size);

  // Range rings + labels
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, monospace';
  for (let i = 1; i <= 3; i++) {
    const rr = (R * i) / 3;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Crosshair
  ctx.beginPath();
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.stroke();
  ctx.fillText('N', cx - 3, cy - R + 12);

  const rangeLabel = distanceUnitLabel(units) === 'NM'
    ? `${settings.radiusNm} NM`
    : distanceUnitLabel(units) === 'km'
      ? `${Math.round(maxRangeKm)} km`
      : `${Math.round(maxRangeKm * 0.621371)} mi`;
  el('rangeLabel').textContent = `RANGE ${rangeLabel}`;

  // Home
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Aircraft
  for (const f of flights) {
    if (f.bearingDeg == null || f.distanceKm == null) continue;
    const frac = Math.min(1, f.distanceKm / maxRangeKm);
    const ang = (f.bearingDeg - 90) * (Math.PI / 180); // 0deg = up (north)
    const x = cx + Math.cos(ang) * R * frac;
    const y = cy + Math.sin(ang) * R * frac;
    const heading = (f.trackDeg ?? 0) * (Math.PI / 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const tag = (f.callsign || '').slice(0, 7);
    if (tag) {
      ctx.fillStyle = accent;
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(tag, x + 6, y + 3);
    }
  }
}

// --- Polling ---------------------------------------------------------------
async function poll() {
  try {
    const data = await getState(screenId);
    settings = data.settings;
    flights = Array.isArray(data.flights) ? data.flights : [];
    lastGoodAt = Date.now();
    failCount = 0;
    if (settings.refreshSec && settings.refreshSec !== refreshSec) {
      refreshSec = settings.refreshSec;
      schedule();
    }
    render();
  } catch (err) {
    failCount++;
    updateStatus();
    if (!settings) {
      board.innerHTML = `<div class="empty"><div class="big">Connecting…</div>
        <div class="sub">${escapeHtml(String(err.message || err))}</div></div>`;
    }
  }
}

function schedule() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, Math.max(5, refreshSec) * 1000);
}

// --- Kiosk niceties --------------------------------------------------------
el('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

let idleTimer = null;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 4000);
}
['mousemove', 'touchstart', 'keydown'].forEach((e) => window.addEventListener(e, wake));
wake();

window.addEventListener('resize', () => settings && render());

// --- Boot ------------------------------------------------------------------
poll();
schedule();
