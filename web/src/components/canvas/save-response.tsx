'use client';

import { ChevronRight, ListTree, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { addVariable, GraphItem, SaveField, setStepSave, toVarName, WorkflowGraph } from '@/lib/graph';
import { useCanvas } from './context';
import { VarSelect } from './var-select';

type Step = Extract<GraphItem, { type: 'step' }>;

// The newest real response of an action (from past runs), fetched once per action per page.
const samples = new Map<string, Promise<unknown>>();
function useSample(key?: string) {
  const [state, setState] = useState<{ key?: string; result?: unknown; loading: boolean }>({ loading: false });
  useEffect(() => {
    if (!key) return;
    if (!samples.has(key)) samples.set(key, api<{ result: unknown }>(`/actions/${key}/sample`).then((r) => r.result).catch(() => null));
    setState({ key, loading: true });
    samples.get(key)!.then((result) => setState({ key, result, loading: false }));
  }, [key]);
  return state;
}

// "Save response" on an AI step: map fields of its action's response to workflow variables (like Typebot's
// "Save in variables" on an HTTP request). The picker shows the action's last real response as a tree.
export function SaveResponse({ item }: { item: Step }) {
  const c = useCanvas();
  const action = item.content.find((p) => p.t === 'action');
  const save = item.save ?? [];
  const [open, setOpen] = useState(save.length > 0);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const sample = useSample(pickFor !== null && action?.t === 'action' ? action.key : undefined);
  if (!action || action.t !== 'action') return null;

  const put = (g: WorkflowGraph, list: SaveField[]) => setStepSave(g, item.id, list);
  const row = (i: number, patch: Partial<SaveField>) => save.map((m, j) => (j === i ? { ...m, ...patch } : m));
  // Picking a field fills its path; an empty variable gets one named after the field.
  const pick = (i: number, path: string) => {
    const leaf = toVarName(path.replace(/\[(\d+)\]/g, '_$1').split('.').filter((k) => k !== 'length').pop() ?? '') || 'value';
    c.update((g) => (save[i].var ? put(g, row(i, { path })) : put(addVariable(g, leaf), row(i, { path, var: leaf }))));
    setPickFor(null);
  };

  return (
    <div className="mt-1 border-t border-line/70 pt-1 pl-2 text-xs">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
        <ChevronRight size={11} className={open ? 'rotate-90' : ''} /> Save response{save.length ? ` (${save.length})` : ''}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {save.map((m, i) => (
            <div key={i} className="relative">
              <div className="group/s flex items-center gap-1">
                <input value={m.path} disabled={c.readOnly} placeholder="field, e.g. items[0].name"
                       onChange={(e) => c.update((g) => put(g, row(i, { path: e.target.value })))}
                       className="w-0 min-w-0 flex-[1.2] rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-brand" />
                {!c.readOnly && (
                  <button title="Pick from the last response" onClick={() => setPickFor(pickFor === i ? null : i)}
                          className={`rounded p-0.5 ${pickFor === i ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:text-ink'}`}><ListTree size={12} /></button>
                )}
                <span className="text-ink-3">→</span>
                <VarSelect value={m.var} set={(g, v) => put(g, row(i, { var: v }))} />
                {!c.readOnly && (
                  <button title="Remove" onClick={() => c.update((g) => put(g, save.filter((_, j) => j !== i)))}
                          className="hidden text-ink-3 hover:text-bad group-hover/s:block"><X size={11} /></button>
                )}
              </div>
              {pickFor === i && (
                <div className="nowheel absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-line bg-panel p-1.5 shadow-lg">
                  <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Last response of @{action.key}</div>
                  {sample.loading ? <div className="px-1 text-ink-3">Loading…</div>
                    : sample.result === null || sample.result === undefined
                      ? <div className="px-1 text-ink-3">No response yet. Run the workflow once, or type the field path.</div>
                      : <Tree value={sample.result} path="" onPick={(p) => pick(i, p)} />}
                </div>
              )}
            </div>
          ))}
          {!c.readOnly && (
            <button onClick={() => { c.update((g) => put(g, [...save, { path: '', var: '' }])); setPickFor(save.length); }}
                    className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink"><Plus size={11} /> field</button>
          )}
        </div>
      )}
    </div>
  );
}

// A response as a clickable tree. Any key can be picked (an object or list is saved as JSON); lists also offer "length".
function Tree({ value, path, onPick, depth = 0 }: { value: unknown; path: string; onPick: (p: string) => void; depth?: number }) {
  if (value === null || typeof value !== 'object') return null;
  const list = Array.isArray(value);
  const entries: [string, unknown][] = list ? (value as unknown[]).slice(0, 5).map((v, i) => [`[${i}]`, v]) : Object.entries(value as object);
  return (
    <div className={depth ? 'ml-2.5 border-l border-line pl-1.5' : ''}>
      {entries.map(([k, v]) => {
        const p = list ? `${path}${k}` : path ? `${path}.${k}` : k;
        const leaf = v === null || typeof v !== 'object';
        return (
          <div key={k}>
            <button onClick={() => onPick(p)} className="flex w-full min-w-0 items-baseline gap-2 rounded px-1 py-px text-left hover:bg-hover">
              <span className="shrink-0 font-mono text-[11px] text-var">{k}</span>
              <span className="truncate text-[11px] text-ink-3">{leaf ? String(v) : Array.isArray(v) ? `${v.length} items` : '{…}'}</span>
            </button>
            {!leaf && <Tree value={v} path={p} onPick={onPick} depth={depth + 1} />}
          </div>
        );
      })}
      {list && (
        <button onClick={() => onPick(`${path}.length`)} className="flex w-full gap-2 rounded px-1 py-px text-left hover:bg-hover">
          <span className="font-mono text-[11px] text-var">length</span><span className="text-[11px] text-ink-3">{(value as unknown[]).length}</span>
        </button>
      )}
    </div>
  );
}
