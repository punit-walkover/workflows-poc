'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Plug, Sheet } from 'lucide-react';
import { connect, ViaSocketConnectError } from 'viasocket-apps/browser';
import { api } from '@/lib/api';
import { Button, Card } from './ui';

export interface App { service_id: string; name: string; connected: boolean }
interface Demo { url: string; orders: { order_id: string; customer_email: string; item: string; price_minor: number }[] }

const CONNECT_ERRORS: Record<string, string> = {
  closed: '',
  rejected: 'The app declined the connection. Try again and grant access.',
  script: 'The connect window could not be loaded.',
  unavailable: 'The connect window could not be opened. Allow pop-ups for this site.',
};

// viaSocket connect popup → authId → backend enables the app and stores the script id (encrypted).
export async function connectApp(app: { service_id: string; name: string }) {
  const { token } = await api<{ token: string }>('/integrations/token');
  const { authId } = await connect({ embedToken: token, serviceId: app.service_id });
  return api('/integrations/connections', { method: 'POST', body: { service_id: app.service_id, auth_id: authId, app_name: app.name } });
}

export function ConnectedApps({ onChange }: { onChange?: () => void }) {
  const [apps, setApps] = useState<App[]>([]);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [custom, setCustom] = useState('');

  const load = async () => { const r = await api('/integrations/apps'); setApps(r.apps); setDemo(r.sheets_demo); };
  useEffect(() => { load(); }, []);

  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(id); setMsg(null);
    try { await fn(); await load(); onChange?.(); if (ok) setMsg({ ok: true, text: ok }); }
    catch (e: any) {
      const text = e instanceof ViaSocketConnectError ? CONNECT_ERRORS[e.code] : e.message;
      if (text) setMsg({ ok: false, text });
    } finally { setBusy(null); }
  };
  const sheets = apps.find((a) => a.service_id === 'rowqm5xi2');

  return (
    <Card className="mb-6 px-5 py-4">
      <div className="mb-3 flex items-center gap-2 font-medium"><Plug size={16} /> Connected apps <span className="text-xs font-normal text-ink-3">via viaSocket</span></div>
      <div className="space-y-2">
        {apps.map((a) => (
          <div key={a.service_id} className="flex items-center gap-3">
            <span className="w-40">{a.name}</span>
            <span className={`text-xs ${a.connected ? 'text-ok' : 'text-ink-3'}`}>{a.connected ? 'Connected' : 'Not connected'}</span>
            <div className="flex-1" />
            {a.connected
              ? <Button variant="ghost" disabled={!!busy} onClick={() => run(a.service_id, () => api(`/integrations/connections/${a.service_id}`, { method: 'DELETE' }))}>Disconnect</Button>
              : <Button disabled={!!busy} onClick={() => run(a.service_id, () => connectApp(a), `${a.name} connected.`)}>{busy === a.service_id ? 'Connecting…' : 'Connect'}</Button>}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other viaSocket app: service id (e.g. rowxxxxxx)"
                 className="w-80 rounded-md border border-line px-2 py-1 text-sm" />
          <Button variant="ghost" disabled={!custom.trim() || !!busy}
                  onClick={() => run('custom', () => connectApp({ service_id: custom.trim(), name: custom.trim() }), 'App connected.')}>Connect</Button>
        </div>
      </div>

      {sheets?.connected && (
        <div className="mt-4 rounded-lg border border-line bg-canvas px-4 py-3">
          <div className="mb-1 flex items-center gap-2 font-medium"><Sheet size={15} /> Google Sheets demo</div>
          {demo ? (
            <div className="text-ink-2">
              Orders sheet: <a href={demo.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link underline">open <ExternalLink size={12} /></a>
              {' · '}orders {demo.orders.map((o) => `${o.order_id} (${o.customer_email.split('@')[0]}, ${o.item})`).join(', ')}.
              <div className="text-xs text-ink-3">Workflow “Order refund (Google Sheets)” uses @sheet_lookup_order and @sheet_refund_order.</div>
            </div>
          ) : <div className="text-ink-2">Creates an Orders spreadsheet in your Google Drive, two actions that read and update it, and a refund workflow that uses them.</div>}
          <Button className="mt-2" variant={demo ? 'ghost' : 'primary'} disabled={!!busy}
                  onClick={() => run('demo', () => api('/integrations/sheets-demo', { method: 'POST' }), 'Demo sheet, actions and workflow are ready.')}>
            {busy === 'demo' ? 'Setting up…' : demo ? 'Recreate demo sheet' : 'Set up demo sheet'}
          </Button>
        </div>
      )}
      {msg && <div className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</div>}
    </Card>
  );
}
