// Small fetch wrapper: timeout, JSON, shared User-Agent, and status-aware errors.
import { config } from './config.js';

export async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timeout = opts.timeoutMs || config.fetchTimeoutMs;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      body: opts.body,
      signal: ctrl.signal,
      headers: {
        'User-Agent': config.userAgent,
        Accept: 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
