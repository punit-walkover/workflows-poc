'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Toggle } from '@/components/ui';
import { ConnectedApps } from '@/components/connected-apps';

interface Action {
  key: string; name: string; description: string; kind: string; source: 'builtin' | 'mock' | 'viasocket';
  requires_approval: boolean; enabled: boolean;
  via_app_name: string | null; via_action_name: string | null;
}

const SOURCE: Record<string, string> = { builtin: 'built-in', mock: 'mock shop', viasocket: 'viaSocket' };

export default function ActionsPage() {
  const [rows, setRows] = useState<Action[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(() => api<Action[]>('/actions').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  const patch = async (key: string, body: object) => {
    const updated = await api<Action>(`/actions/${key}`, { method: 'PATCH', body });
    setRows((rs) => rs.map((r) => (r.key === key ? updated : r)));
  };
  const remove = async (key: string) => {
    setError('');
    try { await api(`/actions/${key}`, { method: 'DELETE' }); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Actions</h1>
          <p className="text-ink-2">Tools workflows can mention with <span className="chip chip-action">@key</span>. Custom actions run an app action through viaSocket.</p>
        </div>
        <Link href="/actions/new"><Button variant="primary"><Plus size={15} /> New action</Button></Link>
      </div>
      <ConnectedApps onChange={load} />
      {error && <div className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-bad">{error}</div>}
      <div className="space-y-3">
        {rows.map((a) => (
          <Card key={a.key} className="px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-action">@{a.key}</span>
                  <span className="font-medium">{a.name}</span>
                  <span className="rounded bg-hover px-1.5 text-xs text-ink-2">{a.kind} · {SOURCE[a.source]}</span>
                  {a.source === 'viasocket' && <span className="text-xs text-ink-3">{a.via_app_name} → {a.via_action_name}</span>}
                </div>
                <div className="mt-1 text-ink-2">{a.description}</div>
                {a.source !== 'builtin' && (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <Toggle on={a.requires_approval} onChange={(v) => patch(a.key, { requires_approval: v })} />
                    Needs approval <span className="text-ink-3">· a teammate must approve before it runs</span>
                  </label>
                )}
              </div>
              <div className="flex items-center gap-1">
                {a.source === 'viasocket' && <>
                  <Link href={`/actions/${a.key}`} title="Edit" className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"><Pencil size={15} /></Link>
                  <button title="Delete" onClick={() => remove(a.key)} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={15} /></button>
                </>}
                <Toggle on={a.enabled} onChange={(v) => patch(a.key, { enabled: v })} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
