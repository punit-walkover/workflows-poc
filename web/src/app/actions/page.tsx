'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Toggle } from '@/components/ui';
import { ActionsTabs } from '@/components/actions-tabs';
import { useViaSocketBuilder } from '@/components/viasocket-panel';

interface Action {
  key: string; name: string; description: string; kind: string; source: 'builtin' | 'mock' | 'viasocket' | 'viasocket_flow';
  requires_approval: boolean; enabled: boolean;
  via_app_name: string | null; via_action_name: string | null; via_flow_id: string | null;
}

const SOURCE: Record<string, string> = { builtin: 'built-in', mock: 'mock shop', viasocket: 'viaSocket app action', viasocket_flow: 'viaSocket flow' };

export default function ActionsPage() {
  const [rows, setRows] = useState<Action[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => api<Action[]>('/actions').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  const onSaved = useCallback((msg: string) => { setNotice(msg); load(); }, [load]);
  const builder = useViaSocketBuilder(onSaved);

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
      <ActionsTabs />
      <div className="mb-4 flex items-center gap-2">
        <span className="flex-1 text-ink-2">{rows.length} actions</span>
        <Link href="/actions/new"><Button><Plus size={15} /> Map an app action</Button></Link>
        <Button variant="primary" disabled={!builder.ready} onClick={() => builder.open()}><Workflow size={15} /> Build in viaSocket</Button>
      </div>
      {notice && <div className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-ok">{notice}</div>}
      {(error || builder.error) && <div className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-bad">{error || builder.error}</div>}
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
                {a.source === 'viasocket' && <Link href={`/actions/${a.key}`} title="Edit" className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"><Pencil size={15} /></Link>}
                {a.source === 'viasocket_flow' && <button title="Edit in viaSocket" onClick={() => builder.open(a.via_flow_id ?? undefined)} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"><Pencil size={15} /></button>}
                {(a.source === 'viasocket' || a.source === 'viasocket_flow') &&
                  <button title="Delete" onClick={() => remove(a.key)} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={15} /></button>}
                <Toggle on={a.enabled} onChange={(v) => patch(a.key, { enabled: v })} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
