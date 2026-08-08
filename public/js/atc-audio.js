// Live ATC audio: plays configured channels through the Web Audio API so each
// can be panned left / center / right (e.g. two airports in stereo). Non-CORS /
// http feeds are routed via the server proxy; CORS-enabled feeds can play direct.

const PAN = { left: -1, center: 0, right: 1 };

export class AtcAudio {
  constructor(screenId) {
    this.screenId = screenId;
    this.ctx = null;
    this.masterGain = null;
    this.channels = new Map(); // key -> channel node bundle
    this.enabled = false;
    this.muted = false;
    this.volume = 0.8;
    this.onState = null;
    this._configKey = '';
  }

  _ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.ctx.destination);
  }

  get suspended() {
    return this.ctx?.state === 'suspended';
  }

  async resume() {
    if (this.ctx?.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    // A user gesture also unblocks the media elements.
    for (const ch of this.channels.values()) ch.audio.play().catch(() => {});
    this._emit();
  }

  _key(c) { return `${c.pan}|${c.proxy ? 1 : 0}|${c.url}`; }
  _src(c) {
    return c.proxy
      ? `/api/audio-proxy?screen=${encodeURIComponent(this.screenId)}&url=${encodeURIComponent(c.url)}`
      : c.url;
  }

  /** Reconcile the live graph with a settings.audio object. */
  apply(audio) {
    const cfg = audio || { enabled: false, volume: 0.8, channels: [] };
    const key = JSON.stringify({ e: !!cfg.enabled, v: cfg.volume, c: cfg.channels });
    if (key === this._configKey) return;
    this._configKey = key;

    this.enabled = !!cfg.enabled;
    this.volume = typeof cfg.volume === 'number' ? cfg.volume : 0.8;
    const chans = (cfg.channels || []).filter((c) => c.url);

    if (!this.enabled || !chans.length) {
      this.stopAll();
      this._emit();
      return;
    }
    this._ensureCtx();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;

    const wanted = new Map();
    for (const c of chans) wanted.set(this._key(c), c);

    for (const [k, ch] of this.channels) {
      if (!wanted.has(k)) { this._destroy(ch); this.channels.delete(k); }
    }
    for (const [k, c] of wanted) {
      let ch = this.channels.get(k);
      if (!ch) { ch = this._create(c); this.channels.set(k, ch); }
      ch.gain.gain.value = typeof c.volume === 'number' ? c.volume : 1;
      ch.panner.pan.value = PAN[c.pan] ?? 0;
      ch.label = c.label || c.url;
    }
    this._emit();
  }

  _create(c) {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'none';
    audio.src = this._src(c);
    const source = this.ctx.createMediaElementSource(audio);
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    source.connect(gain).connect(panner).connect(this.masterGain);

    const ch = { audio, source, gain, panner, cfg: c, label: c.label || c.url, status: 'connecting', retry: null };
    const set = (s) => { ch.status = s; this._emit(); };
    audio.addEventListener('playing', () => { ch.fails = 0; set('live'); });
    audio.addEventListener('waiting', () => set('buffering'));
    audio.addEventListener('stalled', () => this._reconnect(ch));
    audio.addEventListener('error', () => this._reconnect(ch));
    audio.addEventListener('ended', () => this._reconnect(ch));
    audio.play().catch(() => {}); // may be blocked until a gesture
    return ch;
  }

  _reconnect(ch) {
    if (ch.retry) return;
    ch.status = 'reconnecting';
    this._emit();
    // Exponential backoff (3s → 60s max) so a blocked/down feed isn't hammered.
    ch.fails = (ch.fails || 0) + 1;
    const delay = Math.min(3000 * 1.7 ** Math.min(ch.fails - 1, 6), 60000);
    ch.retry = setTimeout(() => {
      ch.retry = null;
      try {
        ch.audio.src = this._src(ch.cfg);
        ch.audio.load();
        ch.audio.play().catch(() => {});
      } catch { /* ignore */ }
    }, delay);
  }

  _destroy(ch) {
    if (ch.retry) clearTimeout(ch.retry);
    try { ch.audio.pause(); ch.audio.removeAttribute('src'); ch.audio.load(); } catch { /* ignore */ }
    try { ch.source.disconnect(); ch.gain.disconnect(); ch.panner.disconnect(); } catch { /* ignore */ }
  }

  stopAll() {
    for (const ch of this.channels.values()) this._destroy(ch);
    this.channels.clear();
  }

  setMuted(m) {
    this.muted = m;
    if (this.masterGain) this.masterGain.gain.value = m ? 0 : this.volume;
    this._emit();
  }
  toggleMute() { this.setMuted(!this.muted); }

  state() {
    return {
      enabled: this.enabled,
      active: this.channels.size > 0,
      suspended: this.suspended,
      muted: this.muted,
      channels: [...this.channels.values()].map((ch) => ({
        label: ch.label, pan: ch.panner.pan.value, status: ch.status,
      })),
    };
  }
  _emit() { if (this.onState) this.onState(this.state()); }
}
