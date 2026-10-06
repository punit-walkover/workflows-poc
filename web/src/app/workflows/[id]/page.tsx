'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, Redo2, Trash2, Undo2, Workflow } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { countSteps, MAX_STEPS, WorkflowNode } from '@/lib/tree';
import { graphStepCount, MAX_GRAPH_STEPS, WorkflowGraph } from '@/lib/graph';
import { Canvas } from '@/components/canvas/canvas';
import { Button, Toggle } from '@/components/ui';
import { WorkflowSteps } from '@/components/workflow-steps';

interface Wf {
  id: string; name: string; when_to_use: string; steps: WorkflowNode[]; graph: WorkflowGraph | null; enabled: boolean;
  row_version: number; published_version: number | null; has_unpublished_changes: boolean;
  validation: { issues: string[] };
}

export default function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [wf, setWf] = useState<Wf | null>(null);
  const [draft, setDraft] = useState<{ name: string; when_to_use: string; steps: WorkflowNode[]; graph: WorkflowGraph | null } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [actions, setActions] = useState<{ key: string; name: string; enabled: boolean }[]>([]);
  const [variables, setVariables] = useState<{ key: string; label: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string; issues?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (w: Wf) => { setWf(w); setDraft({ name: w.name, when_to_use: w.when_to_use, steps: w.steps, graph: w.graph }); setDirty(false); };
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

  // Canvas edits with undo/redo. A transient change (the rest of a drag) doesn't add an undo point.
  const undo = useRef<WorkflowGraph[]>([]);
  const redo = useRef<WorkflowGraph[]>([]);
  const [, bump] = useState(0);
  const changeGraph = useCallback((g: WorkflowGraph, opts?: { transient?: boolean }) => {
    setDraft((d) => {
      if (!d?.graph) return d;
      if (!opts?.transient) { undo.current.push(d.graph); redo.current = []; bump((n) => n + 1); }
      return { ...d, graph: g };
    });
    setDirty(true);
  }, []);
  const step = (from: typeof undo, to: typeof undo) => setDraft((d) => {
    const g = from.current.pop();
    if (!d?.graph || !g) return d;
    to.current.push(d.graph);
    bump((n) => n + 1);
    setDirty(true);
    return { ...d, graph: g };
  });
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]')) return; // text keeps its own undo
      e.preventDefault();
      if (e.shiftKey) step(redo, undo); else step(undo, redo);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  const openCanvas = () => run(() => api(`/workflows/${id}/canvas`, { method: 'POST' }), 'Opened in the canvas. Save to keep it; the live version changes only when you publish.');

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
  const notices = (
    <>
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
    </>
  );

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
        {draft.graph && <>
          <button title="Undo (Ctrl+Z)" disabled={!undo.current.length} onClick={() => step(undo, redo)} className="rounded p-1.5 text-ink-2 hover:bg-hover disabled:opacity-30"><Undo2 size={16} /></button>
          <button title="Redo (Ctrl+Shift+Z)" disabled={!redo.current.length} onClick={() => step(redo, undo)} className="rounded p-1.5 text-ink-2 hover:bg-hover disabled:opacity-30"><Redo2 size={16} /></button>
        </>}
        {!draft.graph && <Button onClick={openCanvas} disabled={busy || dirty} title={dirty ? 'Save first' : undefined}><Workflow size={15} /> Open in canvas</Button>}
        <Button onClick={save} disabled={busy || !dirty}>Save changes</Button>
        <Button variant="primary" onClick={publish} disabled={busy}>Publish</Button>
        <button title="Delete workflow" onClick={remove} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={16} /></button>
      </header>

      {draft.graph ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start gap-4 border-b border-line bg-panel px-6 py-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm"><span className="shrink-0 font-medium">When to use</span>
              <input value={draft.when_to_use} onChange={(e) => { setDraft({ ...draft, when_to_use: e.target.value }); setDirty(true); }}
                     placeholder="the customer's request this workflow handles" className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 outline-none focus:border-ink-3" /></label>
            <span className={`pt-1.5 text-xs ${graphStepCount(draft.graph) > MAX_GRAPH_STEPS ? 'text-bad' : 'text-ink-3'}`}>{graphStepCount(draft.graph)} of {MAX_GRAPH_STEPS} steps</span>
          </div>
          {(msg || (!dirty && issues.length > 0)) && <div className="max-h-48 overflow-auto px-6 pt-3">{notices}</div>}
          <div className="min-h-0 flex-1">
            <Canvas graph={draft.graph} onChange={changeGraph} actions={actions} variables={variables} />
          </div>
        </div>
      ) : (
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          {notices}

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
      )}
    </div>
  );
}
