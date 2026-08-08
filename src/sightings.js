// Per-screen "frequent flyer" tracking: counts how many separate times each
// tail number (registration) has come into view. A new visit is only counted
// when more than `sightingDebounceMs` (default 1 hour) has passed since the tail
// was last seen — so a lingering aircraft counts once, not once per poll.
//
// Counts live in memory (authoritative for the running instance) and are flushed
// to durable storage on a debounce so display polling doesn't hammer Firestore.

import { config } from './config.js';
import { loadSightings, storeSightings } from './storage.js';

const state = new Map(); // screenId -> { tails: Map<reg,{c,f,l}>, dirty, lastFlush, loaded, loading }

function get(screenId) {
  let s = state.get(screenId);
  if (!s) {
    s = { tails: new Map(), dirty: false, lastFlush: 0, loaded: false, loading: null };
    state.set(screenId, s);
  }
  return s;
}

async function ensureLoaded(screenId) {
  const s = get(screenId);
  if (s.loaded) return s;
  if (!s.loading) {
    s.loading = (async () => {
      try {
        const doc = await loadSightings(screenId);
        for (const [reg, e] of Object.entries(doc?.tails || {})) {
          if (e && typeof e.c === 'number') s.tails.set(reg, { c: e.c, f: e.f || 0, l: e.l || 0 });
        }
      } catch (err) {
        console.error('[sightings] load failed:', err.message);
      }
      s.loaded = true;
    })();
  }
  await s.loading;
  return s;
}

const cleanReg = (r) => String(r || '').trim().toUpperCase().slice(0, 12);

/** Record the tails currently in view for a screen (call getSeenCount after). */
export async function recordSightings(screenId, flights) {
  const s = await ensureLoaded(screenId);
  const now = Date.now();
  const seen = new Set();
  let counted = false;
  for (const f of flights) {
    const reg = cleanReg(f && f.registration);
    if (!reg || seen.has(reg)) continue;
    seen.add(reg);
    const e = s.tails.get(reg);
    if (!e) {
      s.tails.set(reg, { c: 1, f: now, l: now });
      counted = true;
    } else {
      if (now - e.l > config.sightingDebounceMs) { e.c += 1; counted = true; }
      e.l = now;
    }
    s.dirty = true;
  }
  maybeFlush(screenId, s, counted);
}

/** In-memory count for a tail (0 if unknown / not yet loaded). */
export function getSeenCount(screenId, reg) {
  const s = state.get(screenId);
  if (!s || !s.loaded) return 0;
  const e = s.tails.get(cleanReg(reg));
  return e ? e.c : 0;
}

function prune(s) {
  const cutoff = Date.now() - config.sightingPruneDays * 86400000;
  for (const [reg, e] of s.tails) {
    if (e.c <= 1 && e.l < cutoff) s.tails.delete(reg);
  }
  if (s.tails.size > config.sightingMax) {
    const kept = [...s.tails.entries()]
      .sort((a, b) => b[1].c - a[1].c || b[1].l - a[1].l)
      .slice(0, config.sightingMax);
    s.tails = new Map(kept);
  }
}

async function flush(screenId, s) {
  s.lastFlush = Date.now();
  s.dirty = false;
  prune(s);
  const tails = {}; // snapshot taken synchronously (no race with recordSightings)
  for (const [reg, e] of s.tails) tails[reg] = { c: e.c, f: e.f, l: e.l };
  try {
    await storeSightings(screenId, { tails, updatedAt: Date.now() });
  } catch (err) {
    console.error('[sightings] flush failed:', err.message);
    s.dirty = true;
  }
}

function maybeFlush(screenId, s, urgent) {
  if (!s.dirty) return;
  if (urgent || Date.now() - s.lastFlush > config.sightingFlushMs) {
    flush(screenId, s).catch(() => {});
  }
}

/** Full list for a screen, sorted by count desc (for the control panel). */
export async function listSightings(screenId) {
  const s = await ensureLoaded(screenId);
  return [...s.tails.entries()]
    .map(([reg, e]) => ({ reg, count: e.c, firstSeen: e.f, lastSeen: e.l }))
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

export async function resetSightings(screenId) {
  const s = get(screenId);
  s.tails = new Map();
  s.loaded = true;
  s.dirty = false;
  s.lastFlush = Date.now();
  try {
    await storeSightings(screenId, { tails: {}, updatedAt: Date.now() });
  } catch { /* ignore */ }
}
