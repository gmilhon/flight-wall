// Thin client for the Flight Wall JSON API.

export async function getConfig() {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

export async function getScreens() {
  const r = await fetch('/api/screens');
  if (!r.ok) throw new Error(`screens ${r.status}`);
  return r.json();
}

export async function getSettings(screen) {
  const r = await fetch(`/api/settings?screen=${encodeURIComponent(screen)}`);
  if (!r.ok) throw new Error(`settings ${r.status}`);
  return r.json();
}

export async function getState(screen) {
  const r = await fetch(`/api/state?screen=${encodeURIComponent(screen)}`);
  if (!r.ok) throw new Error(`state ${r.status}`);
  return r.json();
}

export async function saveSettings(screen, settings, pin) {
  const r = await fetch(`/api/settings?screen=${encodeURIComponent(screen)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(pin ? { 'x-control-pin': pin } : {}),
    },
    body: JSON.stringify(settings),
  });
  if (r.status === 401) {
    const e = new Error('invalid-pin');
    e.code = 'invalid-pin';
    throw e;
  }
  if (!r.ok) throw new Error(`save ${r.status}`);
  return r.json();
}
