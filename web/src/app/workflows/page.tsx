'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, Toggle } from '@/components/ui';

interface Row { id: string; name: string; when_to_use: string; enabled: boolean; step_count: number; published_version: number | null; has_unpublished_changes: boolean }

export default function WorkflowsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const load = () => api<Row[]>('/workflows').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); api('/workflows/templates').then(setTemplates); }, []);

  const create = async (template?: string) => {
    const w = await api('/workflows', { method: 'POST', body: { template } });
    router.push(`/workflows/${w.id}`);
  };
  // Deleting archives it: running conversations finish on their pinned version.
  const remove = async (r: Row) => {
    if (!confirm(`Delete "${r.name}"? Conversations already running it will finish, new ones won't use it.`)) return;
    try { await api(`/workflows/${r.id}`, { method: 'DELETE' }); load(); } catch (e: any) { setError(e.message); }
  };
  const toggle = async (r: Row, enabled: boolean) => {
    try { await api(`/workflows/${r.id}`, { method: 'PATCH', body: { enabled } }); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Workflows</h1>
          <p className="text-ink-2">Step-by-step playbooks the agent follows for one kind of request.</p>
        </div>
        <div className="relative">
          <Button variant="primary" onClick={() => setOpen((o) => !o)}><Plus size={15} /> New workflow</Button>
          {open && (
            <div className="absolute right-0 top-10 z-10 w-56 rounded-lg border border-line bg-panel py-1 shadow-lg">
              <button className="block w-full px-3 py-1.5 text-left hover:bg-hover" onClick={() => create()}>Blank workflow</button>
              <div className="my-1 border-t border-line" />
              <div className="px-3 py-1 text-xs text-ink-3">Templates</div>
              {templates.map((t) => <button key={t.key} className="block w-full px-3 py-1.5 text-left hover:bg-hover" onClick={() => create(t.key)}>{t.name}</button>)}
            </div>
          )}
        </div>
      </div>
      {error && <div className="mb-4 rounded-lg bg-bad-soft px-3 py-2 text-bad">{error}</div>}
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.id} className="flex items-center gap-4 px-5 py-4">
            <Link href={`/workflows/${r.id}`} className="min-w-0 flex-1">
              <div className="font-medium">{r.name}</div>
              <div className="truncate text-ink-2">{r.when_to_use || 'No "when to use" yet'}</div>
              <div className="mt-1 text-xs text-ink-3">
                {r.step_count} steps · {r.published_version ? `live v${r.published_version}` : 'never published'}
                {r.has_unpublished_changes && r.published_version ? ' · unpublished changes' : ''}
              </div>
            </Link>
            <Toggle on={r.enabled} onChange={(v) => toggle(r, v)} disabled={!r.published_version} />
            <button title="Delete workflow" onClick={() => remove(r)} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={16} /></button>
          </Card>
        ))}
      </div>
    </div>
  );
}
