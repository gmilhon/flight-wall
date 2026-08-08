// Interactive editor for additional tracking areas on a Leaflet map.
// Circles: click to place, drag the centre, slider for radius. Polygons: click
// to add points, Finish to close (delete + redraw to change). The home area is
// shown dashed for reference (edited via the Home/Area fields, not here).

const nmToM = (nm) => nm * 1852;
const COLORS = ['#4ea1ff', '#2ecc71', '#f1c40f', '#e67e22', '#e84393', '#9b59b6'];

export class AreaEditor {
  constructor(mapEl, listEl, hintEl) {
    this.mapEl = mapEl;
    this.listEl = listEl;
    this.hintEl = hintEl;
    this.map = null;
    this.areas = [];
    this.layers = [];
    this.homeLayer = null;
    this.home = null;
    this.mode = null; // null | 'circle' | 'polygon'
    this.draft = [];
    this.draftLayer = null;
  }

  ensureMap() {
    if (this.map || typeof L === 'undefined') return;
    this.map = L.map(this.mapEl, { center: [39, -98], zoom: 4 });
    L.tileLayer('/api/map/{z}/{x}/{y}', { maxZoom: 18, attribution: '&copy; OSM, &copy; CARTO' }).addTo(this.map);
    this.map.on('click', (e) => this._onClick(e));
  }
  invalidate() { if (this.map) setTimeout(() => this.map.invalidateSize(), 60); }

  setHome(lat, lon, radiusNm) {
    this.home = lat != null && lon != null ? { lat, lon, radiusNm: radiusNm || 15 } : null;
    this.ensureMap();
    if (this.homeLayer) { this.map.removeLayer(this.homeLayer); this.homeLayer = null; }
    if (this.home && this.map) {
      this.homeLayer = L.layerGroup([
        L.circle([this.home.lat, this.home.lon], { radius: nmToM(this.home.radiusNm), color: '#fff', weight: 1, dashArray: '4 4', fill: false }),
        L.circleMarker([this.home.lat, this.home.lon], { radius: 4, color: '#fff', fillColor: '#fff', fillOpacity: 1 }),
      ]).addTo(this.map);
    }
  }

  setAreas(areas) {
    this.ensureMap();
    this.areas = (areas || []).map((a) => JSON.parse(JSON.stringify(a)));
    this._redraw();
    this._fit();
  }
  getAreas() { return this.areas; }

  startCircle() { this._setMode(this.mode === 'circle' ? null : 'circle'); }
  startPolygon() {
    if (this.mode === 'polygon') { this._cancelDraft(); return; }
    this._setMode('polygon');
  }
  finishPolygon() {
    if (this.draft.length >= 3) this.areas.push({ type: 'polygon', label: '', points: this.draft.slice() });
    this._cancelDraft();
    this._redraw();
  }

  // --- internals ---
  _dot(color) {
    return L.divIcon({ className: 'area-dot', html: `<span style="background:${color}"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  }
  _setMode(m) {
    this.mode = m;
    if (m !== 'polygon') this._clearDraftLayer();
    if (this.mapEl) this.mapEl.style.cursor = m ? 'crosshair' : '';
    this._hint(m === 'circle' ? 'Click the map to place a circle.'
      : m === 'polygon' ? 'Click to add points; press Finish when done (min 3).' : '');
    if (this.hintEl) this.hintEl.dataset.mode = m || '';
  }
  _onClick(e) {
    if (this.mode === 'circle') {
      this.areas.push({ type: 'radius', label: '', lat: e.latlng.lat, lon: e.latlng.lng, radiusNm: 8 });
      this._setMode(null);
      this._redraw();
    } else if (this.mode === 'polygon') {
      this.draft.push({ lat: e.latlng.lat, lon: e.latlng.lng });
      this._drawDraft();
    }
  }
  _drawDraft() {
    this._clearDraftLayer();
    if (this.draft.length) {
      this.draftLayer = L.polygon(this.draft.map((p) => [p.lat, p.lon]), { color: '#fff', weight: 2, dashArray: '4 4', fillOpacity: 0.05 }).addTo(this.map);
    }
    this._hint(`Polygon: ${this.draft.length} point(s). Finish when done (min 3).`);
  }
  _clearDraftLayer() { if (this.draftLayer) { this.map.removeLayer(this.draftLayer); this.draftLayer = null; } }
  _cancelDraft() { this.draft = []; this._clearDraftLayer(); this._setMode(null); }

  _clearLayers() {
    for (const l of this.layers) { if (l.shape) this.map.removeLayer(l.shape); if (l.marker) this.map.removeLayer(l.marker); }
    this.layers = [];
  }
  _redraw() {
    this.ensureMap();
    this._clearLayers();
    this.areas.forEach((a, i) => this._drawArea(a, i));
    this._renderList();
  }
  _drawArea(a, i) {
    const color = COLORS[i % COLORS.length];
    const entry = {};
    if (a.type === 'polygon') {
      entry.shape = L.polygon(a.points.map((p) => [p.lat, p.lon]), { color, weight: 2, fillOpacity: 0.08 }).addTo(this.map);
    } else {
      entry.shape = L.circle([a.lat, a.lon], { radius: nmToM(a.radiusNm), color, weight: 2, fillOpacity: 0.08 }).addTo(this.map);
      entry.marker = L.marker([a.lat, a.lon], { draggable: true, icon: this._dot(color) }).addTo(this.map);
      entry.marker.on('drag', (ev) => { const ll = ev.target.getLatLng(); a.lat = ll.lat; a.lon = ll.lng; entry.shape.setLatLng(ll); });
    }
    this.layers[i] = entry;
  }
  _fit() {
    if (!this.map) return;
    const shapes = [];
    if (this.homeLayer) this.homeLayer.eachLayer((l) => l.getBounds && shapes.push(l));
    for (const l of this.layers) if (l.shape?.getBounds) shapes.push(l.shape);
    if (shapes.length) { try { this.map.fitBounds(L.featureGroup(shapes).getBounds().pad(0.2)); } catch { /* ignore */ } }
    else if (this.home) this.map.setView([this.home.lat, this.home.lon], 9);
  }
  _hint(t) { if (this.hintEl) this.hintEl.textContent = t || ''; }
  _renderList() {
    this.listEl.innerHTML = '';
    this.areas.forEach((a, i) => {
      const color = COLORS[i % COLORS.length];
      const row = document.createElement('div');
      row.className = 'area-row';
      const meta = a.type === 'polygon' ? `${a.points.length} pts` : `${a.radiusNm} NM`;
      row.innerHTML = `
        <span class="area-swatch" style="background:${color}"></span>
        <input class="area-label" maxlength="40" placeholder="${a.type === 'polygon' ? 'Polygon' : 'Circle'} ${i + 1}" value="${(a.label || '').replace(/"/g, '&quot;')}" />
        ${a.type === 'radius'
          ? `<input class="area-radius" type="range" min="1" max="150" value="${a.radiusNm}" title="Radius (NM)" />`
          : `<span class="area-meta">${meta}</span>`}
        <button type="button" class="ghost area-del" title="Remove">✕</button>`;
      row.querySelector('.area-label').addEventListener('input', (e) => { a.label = e.target.value; });
      const rad = row.querySelector('.area-radius');
      if (rad) rad.addEventListener('input', (e) => {
        a.radiusNm = Number(e.target.value);
        if (this.layers[i]?.shape) this.layers[i].shape.setRadius(nmToM(a.radiusNm));
      });
      row.querySelector('.area-del').addEventListener('click', () => { this.areas.splice(i, 1); this._redraw(); });
      this.listEl.appendChild(row);
    });
  }
}
