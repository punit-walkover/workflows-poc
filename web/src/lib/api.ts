export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001';

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: string[]) { super(message); }
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(API + path, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const m = data?.message;
    throw new ApiError(r.status, typeof m === 'string' ? m : m?.message ?? `Request failed (${r.status})`, m?.issues ?? data?.issues);
  }
  return data as T;
}

export const money = (minor?: number | string | null) => (minor == null ? '' : `$${(Number(minor) / 100).toFixed(2)}`);
