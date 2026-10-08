export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001';

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: string[]) { super(message); }
}

// The API sleeps on Render's free plan; the first requests after a nap get a 502/503/504 (or an HTML error page)
// while it boots. Requests wait for one shared wake-up check instead of each failing with "<!DOCTYPE … not valid JSON".
const WAKE_LIMIT_MS = 90_000;
const NOT_REACHED = new Set([502, 503]); // the proxy couldn't reach the API, so the request never ran
let wakeUp: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
export const serverWaking = { now: () => wakeUp !== null, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
const notify = () => listeners.forEach((fn) => fn());

// Polls a cheap endpoint until the API answers with JSON; every waiting request shares this one loop.
function waitForServer(): Promise<boolean> {
  if (wakeUp) return wakeUp;
  wakeUp = (async () => {
    const until = Date.now() + WAKE_LIMIT_MS;
    for (let delay = 1000; Date.now() < until; delay = Math.min(delay * 2, 8000)) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const r = await fetch(API + '/variables', { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return true;
      } catch { /* still starting */ }
    }
    return false;
  })().finally(() => { wakeUp = null; notify(); });
  notify();
  return wakeUp;
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET';
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(API + path, {
        method,
        headers: init?.body ? { 'content-type': 'application/json' } : undefined,
        body: init?.body ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
      });
    } catch {
      // Network error: nothing reached the API, so any request may be retried once it's up.
      if (attempt === 0 && (await waitForServer())) continue;
      throw new ApiError(503, "Can't reach the server. Check your connection and try again.");
    }
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = undefined; } // undefined = not JSON (an error page)
    const starting = NOT_REACHED.has(r.status) || r.status === 504 || data === undefined;
    if (starting) {
      // Reads are always safe to repeat; writes only when the request clearly never reached the API.
      const safe = method === 'GET' || NOT_REACHED.has(r.status);
      if (attempt === 0 && safe && (await waitForServer())) continue;
      throw new ApiError(r.status || 503, r.status === 504
        ? 'The server took too long to answer. Refresh to check whether it went through.'
        : 'The server is still starting. Please try again in a minute.');
    }
    if (!r.ok) {
      const m = data?.message;
      throw new ApiError(r.status, typeof m === 'string' ? m : m?.message ?? `Request failed (${r.status})`, m?.issues ?? data?.issues);
    }
    return data as T;
  }
}

export const money = (minor?: number | string | null) => (minor == null ? '' : `$${(Number(minor) / 100).toFixed(2)}`);
