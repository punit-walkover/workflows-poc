'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { countSteps, MAX_STEPS, WorkflowNode } from '@/lib/tree';
import { Button, Toggle } from '@/components/ui';
import { WorkflowSteps } from '@/components/workflow-steps';

interface Wf {
  id: string; name: string; when_to_use: string; steps: WorkflowNode[]; enabled: boolean;
  row_version: number; published_version: number | null; has_unpublished_changes: boolean;
  validation: { issues: string[] };
}

export default function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [wf, setWf] = useState<Wf | null>(null);
  const [draft, setDraft] = useState<{ name: string; when_to_use: string; steps: WorkflowNode[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [actions, setActions] = useState<{ key: string; name: string; enabled: boolean }[]>([]);
  const [variables, setVariables] = useState<{ key: string; label: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string; issues?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (w: Wf) => { setWf(w); setDraft({ name: w.name, when_to_use: w.when_to_use, steps: w.steps }); setDirty(false); };
  useEffect(() => {
    api<Wf>(`/workflows/${id}`).then(apply);
    api('/actions').then(setActions);
    api('/variables').then(setVariables);
  }, [id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = useCallback((fn: (s: WorkflowNode[]) => WorkflowNode[]) => {
    setDraft((d) => (d ? { ...d, steps: fn(d.steps) } : d));
    setDirty(true);
  }, []);

  const run = async (fn: () => Promise<Wf>, ok: string) => {
    setBusy(true); setMsg(null);
    try { apply(await fn()); setMsg({ kind: 'ok', text: ok }); }
    catch (e: any) { setMsg({ kind: 'bad', text: e.message, issues: e instanceof ApiError ? e.issues : undefined }); }
    finally { setBusy(false); }
  };
  const save = () => run(() => api(`/workflows/${id}`, { method: 'PUT', body: { ...draft, row_version: wf!.row_version } }), 'Saved as draft. Live runs are unaffected until you publish.');
  const publish = () => run(async () => {
    if (dirty) apply(await api<Wf>(`/workflows/${id}`, { method: 'PUT', body: { ...draft, row_version: wf!.row_version } }));
    return api(`/workflows/${id}/publish`, { method: 'POST' });
  }, 'Published. New conversations use this version.');
  const patch = (body: object) => run(() => api(`/workflows/${id}`, { method: 'PATCH', body }), 'Updated.');
  const remove = async () => {
    if (!confirm(`Delete "${wf!.name}"? Conversations already running it will finish, new ones won't use it.`)) return;
    setDirty(false);
    await api(`/workflows/${id}`, { method: 'DELETE' });
    router.push('/workflows');
  };

  if (!wf || !draft || !actions.length) return <div className="p-8 text-ink-3">Loading…</div>;
  const used = countSteps(draft.steps);
  const issues = wf.validation.issues;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-6 py-3">
        <Link href="/workflows" className="rounded p-1 hover:bg-hover"><ChevronLeft size={18} /></Link>
        <input value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }}
               className="min-w-0 flex-1 rounded-md px-2 py-1 text-base font-semibold outline-none hover:bg-hover focus:bg-hover" />
        <span className="text-xs text-ink-3">
          {wf.published_version ? `Live v${wf.published_version}` : 'Never published'}
          {(dirty || (wf.has_unpublished_changes && wf.published_version)) ? ' · unpublished changes' : ''}
        </span>
        <label className="flex items-center gap-2 text-sm text-ink-2">Enabled <Toggle on={wf.enabled} disabled={!wf.published_version} onChange={(v) => patch({ enabled: v })} /></label>
        <Button onClick={save} disabled={busy || !dirty}>Save changes</Button>
        <Button variant="primary" onClick={publish} disabled={busy}>Publish</Button>
        <button title="Delete workflow" onClick={remove} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={16} /></button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          {msg && (
            <div className={`mb-4 rounded-lg px-4 py-3 ${msg.kind === 'ok' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
              {msg.text}
              {msg.issues && <ul className="mt-1 list-disc pl-5">{msg.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            </div>
          )}
          {!dirty && issues.length > 0 && (
            <div className="mb-5 flex gap-2 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-warn">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div><div className="font-medium">This workflow can't be published yet:</div>
                <ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul></div>
            </div>
          )}

          <label className="mb-1 block font-medium">When to use</label>
          <textarea value={draft.when_to_use} rows={2}
                    onChange={(e) => { setDraft({ ...draft, when_to_use: e.target.value }); setDirty(true); }}
                    placeholder="Describe the customer's request this workflow handles, e.g. 'the customer wants money back for a paid order'."
                    className="mb-6 w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-ink-3" />

          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-medium">Steps</span>
            <span className={`text-xs ${used > MAX_STEPS ? 'text-bad' : 'text-ink-3'}`}>{MAX_STEPS - used} of {MAX_STEPS} steps remaining</span>
          </div>
          <div className="rounded-xl border border-line bg-panel px-4 py-4">
            <WorkflowSteps steps={draft.steps} update={update} actions={actions} variables={variables} remaining={MAX_STEPS - used} />
          </div>
          <p className="mt-3 text-xs text-ink-3">
            Type <b>@</b> to reference actions, <b>{'{{'}</b> to insert a variable, <b>Enter</b> for a new step.
            Choose <b>Condition</b> from the @ menu to turn a step into If / Else. Use <b>Go to step</b> to repeat an earlier step.
          </p>
        </div>
      </div>
    </div>
  );
}
