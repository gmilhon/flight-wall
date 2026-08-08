// Control panel: edit a screen's settings and push them to the display.
import { getConfig, getScreens, getSettings, saveSettings, getSightings, resetSightings } from './api.js';

const el = (id) => document.getElementById(id);
const PIN_KEY = 'flightwall.pin';

let cfg = { pinRequired: false };
let screenId = new URLSearchParams(location.search).get('screen') || 'main';
let settings = null;

// --- Load ------------------------------------------------------------------
async function boot() {
  cfg = await getConfig();
  el('storageBadge').textContent = cfg.storage;
  el('pinRow').hidden = !cfg.pinRequired;
  if (cfg.pinRequired) el('pin').value = localStorage.getItem(PIN_KEY) || '';

  const { screens } = await getScreens();
  const sel = el('screenSelect');
  sel.innerHTML = screens.map((s) => `<option value="${s}">${s}</option>`).join('');
  if (!screens.includes(screenId)) {
    sel.innerHTML += `<option value="${screenId}">${screenId}</option>`;
  }
  sel.value = screenId;

  await loadScreen(screenId);
}

async function loadScreen(id) {
  screenId = id;
  settings = await getSettings(id);
  fillForm(settings);
  updateLinks();
  loadRegulars();
}

// --- Form <-> settings -----------------------------------------------------
function fillForm(s) {
  setMode(s.mode);
  el('lat').value = s.home?.lat ?? '';
  el('lon').value = s.home?.lon ?? '';
  el('homeLabel').value = s.home?.label ?? '';
  el('radius').value = s.radiusNm;
  el('radiusVal').textContent = `${s.radiusNm} NM`;
  el('sort').value = s.sort;
  el('maxFlights').value = s.maxFlights;
  el('units').value = s.units;
  el('theme').value = s.theme;
  el('titleMode').value = s.titleMode || 'flight';
  el('altUnit').value = s.altUnit || 'auto';
  el('spdUnit').value = s.spdUnit || 'auto';
  el('vertUnit').value = s.vertUnit || 'auto';
  el('distUnit').value = s.distUnit || 'auto';
  el('refresh').value = s.refreshSec;
  el('sidePanel').value = s.sidePanel || 'map';
  el('layout').value = s.layout || 'board';
  el('cycleSec').value = s.cycleSec || 5;
  el('showLogos').checked = s.showLogos !== false;
  el('showAircraftIcons').checked = s.showAircraftIcons !== false;
  el('alertOnAppear').checked = s.alertOnAppear !== false;
  el('showSightings').checked = s.showSightings !== false;
  fillFilters(s.filters || {});
  renderTrackList(s.trackedFlights || []);
  const audio = s.audio || { enabled: false, volume: 0.8, channels: [] };
  el('audioEnabled').checked = !!audio.enabled;
  el('audioVolume').value = audio.volume ?? 0.8;
  renderAudioChannels(audio.channels || []);
}

function gatherForm() {
  return {
    screenId,
    mode: currentMode(),
    home: {
      lat: el('lat').value === '' ? null : Number(el('lat').value),
      lon: el('lon').value === '' ? null : Number(el('lon').value),
      label: el('homeLabel').value.trim(),
    },
    radiusNm: Number(el('radius').value),
    sort: el('sort').value,
    maxFlights: Number(el('maxFlights').value),
    units: el('units').value,
    altUnit: el('altUnit').value,
    spdUnit: el('spdUnit').value,
    vertUnit: el('vertUnit').value,
    distUnit: el('distUnit').value,
    titleMode: el('titleMode').value,
    theme: el('theme').value,
    refreshSec: Number(el('refresh').value),
    sidePanel: el('sidePanel').value,
    layout: el('layout').value,
    cycleSec: Number(el('cycleSec').value),
    showLogos: el('showLogos').checked,
    showAircraftIcons: el('showAircraftIcons').checked,
    alertOnAppear: el('alertOnAppear').checked,
    showSightings: el('showSightings').checked,
    filters: gatherFilters(),
    trackedFlights: [...document.querySelectorAll('.track-input')]
      .map((i) => i.value.trim())
      .filter(Boolean),
    audio: gatherAudio(),
  };
}

// --- Mode toggle -----------------------------------------------------------
function currentMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || 'area';
}
function setMode(mode) {
  document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === mode));
  applyMode(mode);
}
function applyMode(mode) {
  el('areaSection').hidden = mode !== 'area';
  el('filtersSection').hidden = mode !== 'area';
  el('trackSection').hidden = mode !== 'flight';
}

// --- Tracked flights -------------------------------------------------------
function renderTrackList(list) {
  const box = el('trackList');
  box.innerHTML = '';
  const items = list.length ? list : [''];
  items.forEach((v) => addTrackRow(v));
  updateAddBtn();
}
function addTrackRow(value = '') {
  const box = el('trackList');
  if (box.children.length >= 5) return;
  const row = document.createElement('div');
  row.className = 'track-row';
  row.innerHTML = `
    <input class="track-input" type="text" maxlength="8" placeholder="e.g. UAL245 or AA100" value="${value.replace(/"/g, '')}" />
    <button type="button" class="ghost remove" title="Remove">✕</button>`;
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    if (!el('trackList').children.length) addTrackRow('');
    updateAddBtn();
  });
  box.appendChild(row);
  updateAddBtn();
}
function updateAddBtn() {
  el('addTrack').disabled = el('trackList').children.length >= 5;
}

// --- ATC audio channels ----------------------------------------------------
const esc = (s) => String(s || '').replace(/"/g, '&quot;');

function renderAudioChannels(list) {
  el('audioChannels').innerHTML = '';
  (list || []).forEach((c) => addAudioRow(c));
  updateAddAudioBtn();
}
function addAudioRow(c = {}) {
  const box = el('audioChannels');
  if (box.children.length >= 4) return;
  const pan = c.pan || 'center';
  const row = document.createElement('div');
  row.className = 'audio-row';
  row.innerHTML = `
    <input class="au-label" maxlength="40" placeholder="Label (e.g. DFW Tower)" value="${esc(c.label)}" />
    <input class="au-url" maxlength="300" placeholder="Stream URL (http:// or https://)" value="${esc(c.url)}" />
    <div class="au-controls">
      <select class="au-pan">
        <option value="left"${pan === 'left' ? ' selected' : ''}>◀ Left</option>
        <option value="center"${pan === 'center' ? ' selected' : ''}>• Center</option>
        <option value="right"${pan === 'right' ? ' selected' : ''}>Right ▶</option>
      </select>
      <input class="au-vol" type="range" min="0" max="1" step="0.05" value="${c.volume ?? 1}" title="Channel volume" />
      <label class="au-proxy"><input type="checkbox" class="au-proxy-cb"${c.proxy ? ' checked' : ''} /> Proxy</label>
      <button type="button" class="ghost au-remove" title="Remove">✕</button>
    </div>`;
  row.querySelector('.au-remove').addEventListener('click', () => { row.remove(); updateAddAudioBtn(); });
  box.appendChild(row);
  updateAddAudioBtn();
}
function updateAddAudioBtn() {
  el('addAudio').disabled = el('audioChannels').children.length >= 4;
}
function gatherAudio() {
  const channels = [...document.querySelectorAll('.audio-row')]
    .map((r) => ({
      label: r.querySelector('.au-label').value.trim(),
      url: r.querySelector('.au-url').value.trim(),
      pan: r.querySelector('.au-pan').value,
      volume: Number(r.querySelector('.au-vol').value),
      proxy: r.querySelector('.au-proxy-cb').checked,
    }))
    .filter((c) => c.url || c.label);
  return { enabled: el('audioEnabled').checked, volume: Number(el('audioVolume').value), channels };
}
function loadAudioExample() {
  renderAudioChannels([
    { label: 'DFW Tower', url: 'http://d.liveatc.net/kdfw2', pan: 'left', volume: 1, proxy: true },
    { label: 'Alliance Tower', url: 'http://d.liveatc.net/kafw1', pan: 'right', volume: 1, proxy: true },
  ]);
  el('audioEnabled').checked = true;
}

// --- Regulars (repeat tail numbers) ----------------------------------------
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 90) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function renderRegulars(tails) {
  const box = el('regularsList');
  const all = tails || [];
  const repeats = all.filter((t) => t.count > 1);
  if (!repeats.length) {
    box.innerHTML = `<span class="hint">No repeat visitors yet${all.length ? ` — ${all.length} unique tail(s) seen so far` : ''}. Counts build up while the display is running.</span>`;
    return;
  }
  box.innerHTML = repeats
    .slice(0, 20)
    .map((t) => `<div class="reg-row"><span class="reg-tail">${esc(t.reg)}</span><span class="reg-count">${t.count}×</span><span class="reg-ago">${timeAgo(t.lastSeen)}</span></div>`)
    .join('');
}
async function loadRegulars() {
  try {
    const { tails } = await getSightings(screenId);
    renderRegulars(tails);
  } catch {
    el('regularsList').innerHTML = '<span class="hint">Could not load counts.</span>';
  }
}
async function doResetRegulars() {
  if (!confirm('Reset all repeat-aircraft counts for this screen?')) return;
  const pin = cfg.pinRequired ? el('pin').value.trim() : '';
  try {
    await resetSightings(screenId, pin);
    loadRegulars();
    setStatus('Repeat counts reset.', 'ok');
  } catch (err) {
    if (err.code === 'invalid-pin') setStatus('Incorrect PIN.', 'err');
    else setStatus(`Reset failed: ${err.message}`, 'err');
  }
}

// --- Filters ---------------------------------------------------------------
let filterAirlines = [];
const ALL_FTYPES = ['commercial', 'smalljet', 'light', 'heli', 'other'];

function fillFilters(f) {
  const types = Array.isArray(f.types) && f.types.length ? f.types : ALL_FTYPES;
  document.querySelectorAll('.ftype').forEach((cb) => { cb.checked = types.includes(cb.value); });
  el('altMin').value = f.altMinFt ?? '';
  el('altMax').value = f.altMaxFt ?? '';
  filterAirlines = Array.isArray(f.airlines) ? [...f.airlines] : [];
  renderAirlineChips();
}
function gatherFilters() {
  const types = [...document.querySelectorAll('.ftype:checked')].map((cb) => cb.value);
  const nOrNull = (v) => (v === '' || v == null ? null : Number(v));
  return { types, altMinFt: nOrNull(el('altMin').value), altMaxFt: nOrNull(el('altMax').value), airlines: filterAirlines };
}
function renderAirlineChips() {
  const box = el('airlineList');
  box.innerHTML = filterAirlines
    .map((c) => `<span class="chip" data-code="${esc(c)}">${esc(c)} <button type="button" aria-label="Remove">✕</button></span>`)
    .join('');
  box.querySelectorAll('.chip button').forEach((b) => {
    b.addEventListener('click', () => {
      filterAirlines = filterAirlines.filter((c) => c !== b.parentElement.dataset.code);
      renderAirlineChips();
    });
  });
}
function addAirlineCode() {
  const code = el('airlineInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (code.length >= 2 && !filterAirlines.includes(code) && filterAirlines.length < 10) {
    filterAirlines.push(code);
    renderAirlineChips();
  }
  el('airlineInput').value = '';
}

// --- Save ------------------------------------------------------------------
async function save() {
  const pin = cfg.pinRequired ? el('pin').value.trim() : '';
  if (cfg.pinRequired) localStorage.setItem(PIN_KEY, pin);
  const payload = gatherForm();
  setStatus('Saving…', '');
  try {
    settings = await saveSettings(screenId, payload, pin);
    fillForm(settings);
    setStatus('Saved ✓ — display will update shortly.', 'ok');
    reloadPreview();
  } catch (err) {
    if (err.code === 'invalid-pin') setStatus('Incorrect PIN.', 'err');
    else setStatus(`Save failed: ${err.message}`, 'err');
  }
}

function setStatus(msg, kind) {
  const s = el('saveStatus');
  s.textContent = msg;
  s.className = `save-status ${kind}`;
  if (kind === 'ok') setTimeout(() => (s.textContent = ''), 4000);
}

// --- Links + preview -------------------------------------------------------
function displayUrl() {
  return `${location.origin}/display?screen=${encodeURIComponent(screenId)}`;
}
function updateLinks() {
  el('displayUrl').textContent = displayUrl();
  el('openDisplay').href = displayUrl();
  reloadPreview();
  sizePreview();
}
function reloadPreview() {
  el('preview').src = displayUrl();
}
function sizePreview() {
  const box = el('preview').parentElement;
  if (box.clientWidth) el('preview').style.transform = `scale(${box.clientWidth / 1280})`;
}

// --- Wire up ---------------------------------------------------------------
el('radius').addEventListener('input', (e) => {
  el('radiusVal').textContent = `${e.target.value} NM`;
});
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => applyMode(currentMode()))
);
el('geoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('Geolocation not available.', 'err');
  el('geoBtn').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el('lat').value = pos.coords.latitude.toFixed(5);
      el('lon').value = pos.coords.longitude.toFixed(5);
      el('geoBtn').textContent = '📍 Use my location';
    },
    (err) => {
      el('geoBtn').textContent = '📍 Use my location';
      setStatus(`Location failed: ${err.message}`, 'err');
    },
    { enableHighAccuracy: false, timeout: 10000 }
  );
});
el('addTrack').addEventListener('click', () => addTrackRow(''));
el('addAudio').addEventListener('click', () => addAudioRow({ pan: 'center', proxy: true }));
el('exampleAudio').addEventListener('click', loadAudioExample);
el('refreshRegulars').addEventListener('click', loadRegulars);
el('resetRegulars').addEventListener('click', doResetRegulars);
el('addAirline').addEventListener('click', addAirlineCode);
el('airlineInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addAirlineCode(); }
});
el('saveBtn').addEventListener('click', save);
el('screenSelect').addEventListener('change', (e) => {
  history.replaceState(null, '', `?screen=${encodeURIComponent(e.target.value)}`);
  loadScreen(e.target.value);
});
el('newScreen').addEventListener('click', () => {
  const id = prompt('New screen id (letters, numbers, dashes):', '');
  if (!id) return;
  const clean = id.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!clean) return;
  const sel = el('screenSelect');
  if (![...sel.options].some((o) => o.value === clean)) {
    sel.appendChild(new Option(clean, clean));
  }
  sel.value = clean;
  history.replaceState(null, '', `?screen=${encodeURIComponent(clean)}`);
  loadScreen(clean);
});
el('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(displayUrl());
    el('copyBtn').textContent = 'Copied!';
    setTimeout(() => (el('copyBtn').textContent = 'Copy'), 1500);
  } catch {
    setStatus('Copy failed — select the URL manually.', 'err');
  }
});

window.addEventListener('resize', sizePreview);
el('preview').addEventListener('load', sizePreview);

boot().catch((err) => setStatus(`Failed to load: ${err.message}`, 'err'));
