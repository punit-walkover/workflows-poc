'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Toggle } from '@/components/ui';
import { ToolDialog, type Tool } from '@/components/viasocket-panel';

interface Action {
  key: string; name: string; description: string; kind: string; source: 'builtin' | 'viasocket' | 'viasocket_flow';
  requires_approval: boolean; enabled: boolean; via_flow_id: string | null;
}

const SOURCE: Record<string, string> = { builtin: 'built-in', viasocket: 'viaSocket app action', viasocket_flow: 'viaSocket' };

// Tools are created in the tool dialog: viaSocket's builder plus our details. Each published tool becomes an @action here.
export default function ActionsPage() {
  const [rows, setRows] = useState<Action[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(() => api<Action[]>('/actions').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  const [dialog, setDialog] = useState<{ tool: Tool | null } | null>(null);

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
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Actions</h1>
          <p className="text-ink-2">Tools workflows can mention with <span className="chip chip-action">@key</span>. Build them in viaSocket: pick apps, wire the steps, go live.</p>
        </div>
        <Button variant="primary" onClick={() => setDialog({ tool: null })}><Plus size={15} /> New tool</Button>
      </div>
      {error && <div className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-bad">{error}</div>}
      <div className="space-y-3">
        {rows.map((a) => (
          <Card key={a.key} className="px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-action">@{a.key}</span>
                  <span className="font-medium">{a.name}</span>
                  <span className="rounded bg-hover px-1.5 text-xs text-ink-2">{SOURCE[a.source]}</span>
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
                {a.source === 'viasocket_flow' && <button title="Edit tool" onClick={() => setDialog({ tool: a })} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"><Pencil size={15} /></button>}
                {(a.source === 'viasocket' || a.source === 'viasocket_flow') &&
                  <button title="Delete" onClick={() => remove(a.key)} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={15} /></button>}
                <Toggle on={a.enabled} onChange={(v) => patch(a.key, { enabled: v })} />
              </div>
            </div>
          </Card>
        ))}
      </div>
      {dialog && <ToolDialog tool={dialog.tool} onClose={() => setDialog(null)} onChanged={load} />}
    </div>
  );
}
