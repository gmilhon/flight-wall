// Display app: full-screen, auto-refreshing view of overhead / tracked flights.
import { getState } from './api.js';
import {
  escapeHtml, fmtAltitude, fmtSpeed, fmtVert, fmtDistance, fmtTrack,
  distanceUnitLabel, resolveUnits, pad2,
} from './format.js';
import { airlineColor, airlineIata, airlineLogoUrl, airlineMonogram, textOn, shortAirlineName } from './airline-brand.js';
import { aircraftIconSvg } from './aircraft-silhouettes.js';
import { AtcAudio } from './atc-audio.js';

const screenId = new URLSearchParams(location.search).get('screen') || 'main';
const hasLeaflet = typeof window.L !== 'undefined';

const el = (id) => document.getElementById(id);
const app = el('app');
const board = el('board');
const sideWrap = el('sideWrap');
const canvas = el('radar');
const ctx = canvas.getContext('2d');

// ATC audio is skipped inside the control-panel preview iframe.
const inIframe = window.self !== window.top;
const atc = inIframe ? null : new AtcAudio(screenId);

let settings = null;
let flights = [];
let lastGoodAt = 0;
let refreshSec = 10;
let pollTimer = null;
let firstLoad = true;
let liveTracked = new Set(); // callsigns/queries currently live (flight mode)
let cycleIndex = 0;
let cycleTimer = null;
let cycleKey = '';

const cssVar = (name) => getComputedStyle(app).getPropertyValue(name).trim();

// --- Clock -----------------------------------------------------------------
function tickClock() {
  const d = new Date();
  el('clock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// --- Card rendering --------------------------------------------------------
function routeHtml(f, u) {
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
  const dist = f.distanceKm != null ? `${fmtDistance(f.distanceKm, u.dist)} away` : '';
  return `<div class="route muted">${escapeHtml(dist || 'Local traffic')}</div>`;
}

function metric(label, value) {
  return `<div class="metric"><label>${label}</label><span>${escapeHtml(value)}</span></div>`;
}

function logoHtml(f, color) {
  if (!settings.showLogos) return '';
  const iata = airlineIata(f.airline);
  const url = airlineLogoUrl(iata, 120, 120);
  if (url) {
    const mono = airlineMonogram(f.airline, color).replace(/"/g, '&quot;');
    return `<div class="logo-box"><img class="logo-img" src="${url}" alt=""
      onerror="this.outerHTML='${mono.replace(/'/g, "\\'")}'"/></div>`;
  }
  if (f.airline) return `<div class="logo-box">${airlineMonogram(f.airline, color)}</div>`;
  return '';
}

function iconHtml(f, color) {
  if (!settings.showAircraftIcons) return '';
  const cat = f.acCategory || 'narrowbody';
  return `<div class="ac-icon" style="color:${color}">${aircraftIconSvg(cat)}</div>`;
}

const PRIVATE_COLOR = '#8b98a8';

function ownerHtml(f) {
  const owner = f.aircraft?.owner;
  return owner
    ? `<div class="route owner">${escapeHtml(owner)}</div>`
    : `<div class="route muted">Private aircraft</div>`;
}

function isPrivateFlight(f) {
  return !(f.airline && f.airline.name);
}

function flightCard(f, u) {
  if (f.status === 'not-found') {
    return `<article class="flight not-found">
      <div class="ident"><div class="flightno"><span class="cs">${escapeHtml(f.callsign || f.query || '—')}</span></div>
      <div class="subline"><span class="airline-pill private">Tracking</span><span class="route muted">Awaiting signal…</span></div></div>
      <div class="await">NO SIGNAL</div>
    </article>`;
  }
  const priv = isPrivateFlight(f);
  const color = priv ? PRIVATE_COLOR : (airlineColor(f.airline) || cssVar('--accent'));
  const callsign = f.callsign || f.hex || '—';
  const emerg = f.emergency ? `<span class="emerg">${escapeHtml(f.emergency)}</span>` : '';
  const seen = f.seenCount > 1
    ? `<span class="seen-badge" title="Seen ${f.seenCount} times here">★ ${f.seenCount}</span>`
    : '';
  const model = f.aircraft?.name || f.aircraft?.code || '';
  // Title mode: 'airline' puts the airline name in the big title and the
  // callsign in the pill; 'flight' (default) does the reverse.
  const airlineTitle = settings.titleMode === 'airline' && !priv;
  const title = airlineTitle ? shortAirlineName(f.airline.name) : callsign;
  const pill = priv
    ? `<span class="airline-pill private">Private</span>`
    : `<span class="airline-pill" style="background:${color};color:${textOn(color)}">${escapeHtml(airlineTitle ? callsign : shortAirlineName(f.airline.name))}</span>`;
  const icon = iconHtml(f, color);
  const acCol = (icon || model)
    ? `<div class="ac-col">${icon}${model ? `<div class="ac-model">${escapeHtml(model)}</div>` : ''}</div>`
    : '';
  const logo = priv ? '' : logoHtml(f, color);
  return `<article class="flight" style="--fc:${color}">
    ${acCol}
    <div class="ident">
      <div class="flightno"><span class="cs${airlineTitle ? ' cs-name' : ''}">${escapeHtml(title)}</span>${seen}${emerg}</div>
      <div class="subline">${pill}${priv ? ownerHtml(f) : routeHtml(f, u)}</div>
    </div>
    <div class="metrics">
      ${metric('ALT', fmtAltitude(f.altFt, u.alt, f.onGround))}
      ${metric('SPD', fmtSpeed(f.gsKt, u.spd))}
      ${metric('TRK', fmtTrack(f.trackDeg))}
      ${metric('V/S', fmtVert(f.vertFpm, u.vert))}
      ${metric('DIST', fmtDistance(f.distanceKm, u.dist))}
    </div>
    ${logo ? `<div class="tail">${logo}</div>` : ''}
  </article>`;
}

// --- Cycle mode (single flight, auto-cycling) ------------------------------
function cycMetric(label, value) {
  return `<div class="cyc-metric"><label>${label}</label><span>${escapeHtml(value)}</span></div>`;
}
function cycleCard(f, u, idx, total) {
  const priv = isPrivateFlight(f);
  const color = priv ? PRIVATE_COLOR : (airlineColor(f.airline) || cssVar('--accent'));
  const callsign = f.callsign || f.hex || '—';
  const airlineTitle = settings.titleMode === 'airline' && !priv;
  const title = airlineTitle ? shortAirlineName(f.airline.name) : callsign;
  const pill = priv
    ? `<span class="airline-pill private">Private</span>`
    : `<span class="airline-pill" style="background:${color};color:${textOn(color)}">${escapeHtml(airlineTitle ? callsign : shortAirlineName(f.airline.name))}</span>`;
  const model = f.aircraft?.name || f.aircraft?.code || '';
  const seen = f.seenCount > 1 ? `<span class="seen-badge">★ ${f.seenCount}</span>` : '';
  const logo = priv ? '' : logoHtml(f, color);
  const dots = Array.from({ length: total }, (_, i) => `<span class="cyc-dot${i === idx ? ' on' : ''}"></span>`).join('');
  return `<div class="cycle" style="--fc:${color}">
    <div class="cyc-head">
      <div class="cyc-icon" style="color:${color}">${aircraftIconSvg(f.acCategory || 'narrowbody')}</div>
      <div class="cyc-title">
        <div class="cyc-name">${escapeHtml(title)}${seen}</div>
        <div class="cyc-sub">${pill}${priv ? ownerHtml(f) : routeHtml(f, u)}</div>
        ${model ? `<div class="cyc-model">${escapeHtml(model)}</div>` : ''}
      </div>
      ${logo ? `<div class="cyc-logo">${logo}</div>` : ''}
    </div>
    <div class="cyc-metrics">
      ${cycMetric('ALTITUDE', fmtAltitude(f.altFt, u.alt, f.onGround))}
      ${cycMetric('SPEED', fmtSpeed(f.gsKt, u.spd))}
      ${cycMetric('TRACK', fmtTrack(f.trackDeg))}
      ${cycMetric('VERT RATE', fmtVert(f.vertFpm, u.vert))}
      ${cycMetric('DISTANCE', fmtDistance(f.distanceKm, u.dist))}
    </div>
    <div class="cyc-progress">${dots}</div>
  </div>`;
}
function renderCycle() {
  const list = flights.filter((f) => f.status !== 'not-found');
  if (!list.length) {
    board.innerHTML = `<div class="empty"><div class="big">No aircraft in range</div></div>`;
    return;
  }
  if (cycleIndex >= list.length) cycleIndex = 0;
  board.innerHTML = cycleCard(list[cycleIndex], resolveUnits(settings), cycleIndex, list.length);
}
function scheduleCycle() {
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
  if (settings?.layout === 'cycle') {
    cycleTimer = setInterval(() => {
      const list = flights.filter((f) => f.status !== 'not-found');
      if (list.length) { cycleIndex = (cycleIndex + 1) % list.length; renderCycle(); }
    }, Math.max(2, settings.cycleSec || 5) * 1000);
  }
}

// --- Main render -----------------------------------------------------------
function render() {
  if (!settings) return;
  app.dataset.theme = settings.theme || 'departure';
  app.dataset.mode = settings.mode || 'area';
  app.dataset.layout = settings.layout || 'board';

  const homeLabel = settings.home?.label || (settings.home?.lat != null
    ? `${settings.home.lat.toFixed(2)}, ${settings.home.lon.toFixed(2)}` : '');
  el('homeLabel').textContent = homeLabel;
  el('modeLabel').textContent = settings.mode === 'flight' ? 'TRACKING' : 'OVERHEAD';

  const u = resolveUnits(settings);
  const noHome = settings.mode === 'area' && settings.home?.lat == null && !(settings.areas?.length);
  const positioned = flights.filter((f) => f.lat != null && f.lon != null);
  const cycle = settings.layout === 'cycle';
  const wantSide = !cycle && settings.sidePanel && settings.sidePanel !== 'off' && !noHome && positioned.length > 0;
  const useMap = wantSide && settings.sidePanel === 'map' && hasLeaflet;
  const useRadar = wantSide && !useMap; // radar, or map fallback if Leaflet missing

  app.classList.toggle('no-side', !wantSide);
  sideWrap.hidden = !wantSide;
  el('mapEl').hidden = !useMap;
  canvas.hidden = !useRadar;
  el('rangeLabel').hidden = !useRadar;

  if (noHome) {
    board.innerHTML = `<div class="empty"><div class="big">Set your location</div>
      <div class="sub">Open the control panel and set your home location to begin.</div>
      <div class="url">${escapeHtml(location.origin)}/</div></div>`;
  } else if (!flights.length) {
    board.innerHTML = `<div class="empty"><div class="big">${settings.mode === 'flight' ? 'No tracked flights' : 'No aircraft overhead'}</div>
      <div class="sub">${settings.mode === 'flight' ? 'Add flights in the control panel.' : `Watching a ${settings.radiusNm} NM radius. Standing by…`}</div></div>`;
  } else if (cycle) {
    renderCycle();
  } else {
    board.innerHTML = flights.map((f) => flightCard(f, u)).join('');
  }

  el('count').textContent = flights.length
    ? `${flights.filter((f) => f.status !== 'not-found').length} aircraft` : '';

  if (useMap) {
    try {
      updateMap();
    } catch (e) {
      console.warn('map failed, falling back to radar', e);
      el('mapEl').hidden = true;
      canvas.hidden = false;
      el('rangeLabel').hidden = false;
      drawRadar(u);
    }
  } else if (useRadar) drawRadar(u);
  updateStatus();
}

function updateStatus() {
  const stale = lastGoodAt && Date.now() - lastGoodAt > refreshSec * 3000;
  el('status').innerHTML = stale ? '<span class="dot warn"></span> reconnecting' : '<span class="dot ok"></span> live';
  if (lastGoodAt) {
    const d = new Date(lastGoodAt);
    el('stamp').textContent = `updated ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

// --- Map (Leaflet) ---------------------------------------------------------
let map, homeMarker, rangeCircle, areasLayer, lastFitKey = '';
const planeMarkers = new Map();

function ensureMap() {
  if (map) return;
  map = L.map('mapEl', {
    center: [0, 0], zoom: 2, // initial view so the map is "loaded" before we add layers
    zoomControl: false, attributionControl: true, dragging: false,
    scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
    keyboard: false, touchZoom: false, tap: false,
  });
  L.tileLayer('/api/map/{z}/{x}/{y}', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap, &copy; CARTO',
  }).addTo(map);
}

function planeDivIcon(f, color) {
  const cat = f.acCategory || 'narrowbody';
  const html = `<div class="pm">
    <div class="pm-ico" style="color:${color}; transform:rotate(${Math.round(f.trackDeg || 0)}deg)">${aircraftIconSvg(cat)}</div>
    <div class="pm-lbl">${escapeHtml((f.callsign || '').slice(0, 8))}</div>
  </div>`;
  return L.divIcon({ className: 'plane-div', html, iconSize: [42, 42], iconAnchor: [21, 21] });
}

function updateMap() {
  ensureMap();
  map.invalidateSize();
  const home = settings.home;
  const areaMode = settings.mode === 'area';

  if (areaMode) {
    const extraAreas = settings.areas || [];
    if (home?.lat != null) {
      const rM = settings.radiusNm * 1852;
      if (!homeMarker) homeMarker = L.circleMarker([home.lat, home.lon], { radius: 4, color: '#fff', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
      else homeMarker.setLatLng([home.lat, home.lon]);
      if (!rangeCircle) rangeCircle = L.circle([home.lat, home.lon], { radius: rM, color: 'rgba(255,255,255,0.3)', weight: 1, fill: false }).addTo(map);
      else { rangeCircle.setLatLng([home.lat, home.lon]); rangeCircle.setRadius(rM); }
    } else if (rangeCircle) {
      map.removeLayer(rangeCircle); rangeCircle = null;
      if (homeMarker) { map.removeLayer(homeMarker); homeMarker = null; }
    }
    // additional radius / polygon areas
    if (areasLayer) { map.removeLayer(areasLayer); areasLayer = null; }
    if (extraAreas.length) {
      areasLayer = L.layerGroup();
      for (const a of extraAreas) {
        if (a.type === 'polygon' && a.points?.length >= 3) {
          L.polygon(a.points.map((p) => [p.lat, p.lon]), { color: 'rgba(255,255,255,0.4)', weight: 1, fillOpacity: 0.04 }).addTo(areasLayer);
        } else if (a.lat != null) {
          L.circle([a.lat, a.lon], { radius: (a.radiusNm || 15) * 1852, color: 'rgba(255,255,255,0.3)', weight: 1, fill: false }).addTo(areasLayer);
        }
      }
      areasLayer.addTo(map);
    }
    const fitKey = `${home?.lat},${home?.lon},${settings.radiusNm}|${JSON.stringify(extraAreas)}`;
    if (fitKey !== lastFitKey) {
      const layers = [];
      if (rangeCircle) layers.push(rangeCircle);
      if (areasLayer) layers.push(...areasLayer.getLayers());
      if (layers.length) {
        try { map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [12, 12] }); } catch { /* ignore */ }
      }
      lastFitKey = fitKey;
    }
  }

  const seen = new Set();
  const pts = [];
  for (const f of flights) {
    if (f.lat == null || f.lon == null) continue;
    seen.add(f.hex || f.callsign);
    pts.push([f.lat, f.lon]);
    const color = airlineColor(f.airline) || cssVar('--accent') || '#ffb000';
    const key = f.hex || f.callsign;
    let m = planeMarkers.get(key);
    if (!m) { m = L.marker([f.lat, f.lon], { icon: planeDivIcon(f, color), keyboard: false }).addTo(map); planeMarkers.set(key, m); }
    else { m.setLatLng([f.lat, f.lon]); m.setIcon(planeDivIcon(f, color)); }
  }
  for (const [key, m] of planeMarkers) if (!seen.has(key)) { map.removeLayer(m); planeMarkers.delete(key); }

  if (!areaMode && pts.length) {
    const key = pts.map((p) => p.join()).join('|');
    if (key !== lastFitKey) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 9 }); lastFitKey = key; }
  }
}

// --- Radar (canvas fallback / retro option) --------------------------------
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const size = Math.max(80, Math.min(rect.width, rect.height));
  canvas.width = size * dpr; canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return size;
}
function drawRadar(u) {
  const size = sizeCanvas();
  const cx = size / 2, cy = size / 2, R = Math.min(cx, cy) - 10;
  const maxRangeKm = Math.max(1, settings.radiusNm) * 1.852;
  const line = cssVar('--radar-line') || 'rgba(255,255,255,0.18)';
  const accent = cssVar('--accent') || '#ffb000';
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = line; ctx.fillStyle = line; ctx.lineWidth = 1; ctx.font = '10px ui-monospace, monospace';
  for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  ctx.fillText('N', cx - 3, cy - R + 12);
  const ul = distanceUnitLabel(u.dist);
  el('rangeLabel').textContent = `RANGE ${ul === 'NM' ? settings.radiusNm + ' NM' : ul === 'km' ? Math.round(maxRangeKm) + ' km' : Math.round(maxRangeKm * 0.621371) + ' mi'}`;
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  for (const f of flights) {
    if (f.bearingDeg == null || f.distanceKm == null) continue;
    const frac = Math.min(1, f.distanceKm / maxRangeKm);
    const ang = (f.bearingDeg - 90) * (Math.PI / 180);
    const x = cx + Math.cos(ang) * R * frac, y = cy + Math.sin(ang) * R * frac;
    ctx.save(); ctx.translate(x, y); ctx.rotate((f.trackDeg ?? 0) * (Math.PI / 180));
    ctx.fillStyle = airlineColor(f.airline) || accent;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    const tag = (f.callsign || '').slice(0, 7);
    if (tag) { ctx.fillStyle = accent; ctx.font = '9px ui-monospace, monospace'; ctx.fillText(tag, x + 6, y + 3); }
  }
}

// --- Tracked-flight appearance alert ---------------------------------------
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      osc.connect(gain); gain.connect(audioCtx.destination);
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.start(t); osc.stop(t + 0.16);
    });
  } catch { /* audio blocked; visual alert still shows */ }
}
let alertTimer = null;
function showAlert(names) {
  const box = el('alert');
  box.innerHTML = `<span class="alert-ico">✈</span> ${escapeHtml(names.join(', '))} ${names.length > 1 ? 'are' : 'is'} now in range`;
  box.hidden = false;
  box.classList.add('show');
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { box.classList.remove('show'); setTimeout(() => (box.hidden = true), 500); }, 8000);
  beep();
}

function detectAppearances() {
  if (settings.mode !== 'flight' || !settings.alertOnAppear) { liveTracked = new Set(); return; }
  const nowLive = new Map(); // label -> display name
  for (const f of flights) {
    if (f.status === 'not-found') continue;
    const label = f.query || f.callsign;
    nowLive.set(label, f.callsign || label);
  }
  if (!firstLoad) {
    const fresh = [];
    for (const [label, name] of nowLive) if (!liveTracked.has(label)) fresh.push(name);
    if (fresh.length) showAlert(fresh);
  }
  liveTracked = new Set(nowLive.keys());
}

// --- Polling ---------------------------------------------------------------
async function poll() {
  try {
    const data = await getState(screenId);
    settings = data.settings;
    flights = Array.isArray(data.flights) ? data.flights : [];
    lastGoodAt = Date.now();
    detectAppearances();
    firstLoad = false;
    if (atc) atc.apply(settings.audio);
    if (settings.refreshSec && settings.refreshSec !== refreshSec) { refreshSec = settings.refreshSec; schedule(); }
    const ck = `${settings.layout}|${settings.cycleSec}`;
    if (ck !== cycleKey) { cycleKey = ck; scheduleCycle(); }
    render();
  } catch (err) {
    updateStatus();
    if (!settings) board.innerHTML = `<div class="empty"><div class="big">Connecting…</div><div class="sub">${escapeHtml(String(err.message || err))}</div></div>`;
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
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  if (atc && atc.suspended) atc.resume();
}
['mousemove', 'touchstart', 'keydown', 'click'].forEach((e) => window.addEventListener(e, wake));
wake();
window.addEventListener('resize', () => settings && render());

// --- ATC audio UI ----------------------------------------------------------
function panArrow(pan) {
  return pan < -0.05 ? '◀' : pan > 0.05 ? '▶' : '•';
}
function renderAudioUI(state) {
  const muteBtn = el('muteBtn'), audioBar = el('audioBar'), gate = el('audioGate');
  if (!state || !state.enabled || !state.channels.length) {
    muteBtn.hidden = true; audioBar.hidden = true; gate.hidden = true;
    return;
  }
  muteBtn.hidden = false;
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
  audioBar.hidden = false;
  audioBar.innerHTML = state.channels
    .map((c) => {
      const cls = c.status === 'live' ? 'ok' : c.status === 'reconnecting' ? 'warn' : 'buf';
      return `<span class="ach"><span class="dot ${cls}"></span>${panArrow(c.pan)} ${escapeHtml(c.label)}</span>`;
    })
    .join('');
  gate.hidden = !(state.suspended && !state.muted);
}
if (atc) {
  atc.onState = renderAudioUI;
  el('muteBtn').addEventListener('click', () => atc.toggleMute());
  el('audioGate').addEventListener('click', () => atc.resume());
}

// --- Boot ------------------------------------------------------------------
poll();
schedule();
