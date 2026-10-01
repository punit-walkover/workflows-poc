'use client';

import { ArrowDown, ArrowUp, ChevronDown, CircleDot, CornerUpLeft, GitBranch, Plus, Trash2 } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import {
  addCase, appendToCase, BranchNode, GotoNode, gotoTargets, Inline, insertAfter, MAX_DEPTH, moveNode, newBranch, newGoto, newStep, removeCase, removeNode,
  setCondition, setGoto, setStep, toBranch, WorkflowNode,
} from '@/lib/tree';
import { StepEditor } from './step-editor';

interface Ctx {
  update: (fn: (s: WorkflowNode[]) => WorkflowNode[]) => void;
  actions: { key: string; name: string; enabled: boolean }[];
  variables: { key: string; label: string }[];
  remaining: number;
  steps: WorkflowNode[];
  focusId: string | null;
  setFocusId: (id: string | null) => void;
}
const EditorCtx = createContext<Ctx>(null as unknown as Ctx);

export function WorkflowSteps(props: Omit<Ctx, 'focusId' | 'setFocusId'>) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const { steps } = props;
  const ctx = props;
  const add = () => { const s = newStep(); ctx.update((st) => [...st, s]); setFocusId(s.id); };
  const addBranch = () => { const b = newBranch(); ctx.update((st) => [...st, b]); setFocusId(b.cases[0].id); };
  return (
    <EditorCtx.Provider value={{ ...ctx, focusId, setFocusId }}>
      <NodeList list={steps} depth={0} />
      <AddButtons disabled={ctx.remaining <= 0} onStep={add} onBranch={addBranch} className="mt-3"
                  onGoto={steps.some((n) => n.type === 'step') ? () => ctx.update((st) => [...st, newGoto()]) : undefined} />
    </EditorCtx.Provider>
  );
}

function NodeList({ list, depth }: { list: WorkflowNode[]; depth: number }) {
  return (
    <div className="space-y-1">
      {list.map((n, i) => n.type === 'step'
        ? <StepRow key={n.id} node={n} list={list} index={i} depth={depth} />
        : n.type === 'goto'
          ? <GotoRow key={n.id} node={n} index={i} />
          : <BranchBlock key={n.id} node={n} number={i + 1} depth={depth} />)}
    </div>
  );
}

function StepRow({ node, list, index, depth }: { node: Extract<WorkflowNode, { type: 'step' }>; list: WorkflowNode[]; index: number; depth: number }) {
  const c = useContext(EditorCtx);
  const onEnter = () => {
    if (c.remaining <= 0) return;
    const s = newStep();
    c.update((st) => insertAfter(st, node.id, s));
    c.setFocusId(s.id);
  };
  const onBackspaceEmpty = () => {
    if (list.length <= 1) return;
    const prev = list[index - 1];
    c.update((st) => removeNode(st, node.id));
    c.setFocusId(prev?.type === 'step' ? prev.id : null);
  };
  return (
    <div className="group flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-hover/60">
      <span className="w-6 shrink-0 pt-px text-right text-ink-3">{index + 1}.</span>
      <StepEditor
        content={node.content}
        onChange={(content: Inline[]) => c.update((st) => setStep(st, node.id, content))}
        actions={c.actions} variables={c.variables}
        autoFocus={c.focusId === node.id}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
        onCondition={depth < MAX_DEPTH ? () => c.update((st) => toBranch(st, node.id)) : undefined}
      />
      <RowTools id={node.id} canDelete={list.length > 1}
                onCondition={depth < MAX_DEPTH ? () => c.update((st) => toBranch(st, node.id)) : undefined} />
    </div>
  );
}

function RowTools({ id, canDelete, onCondition }: { id: string; canDelete: boolean; onCondition?: () => void }) {
  const c = useContext(EditorCtx);
  const btn = 'rounded p-1 text-ink-3 hover:bg-panel hover:text-ink';
  return (
    <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100">
      {onCondition && <button type="button" title="Turn into a condition (If / Else)" className={btn} onClick={onCondition}><GitBranch size={14} /></button>}
      <button type="button" title="Move up" className={btn} onClick={() => c.update((s) => moveNode(s, id, -1))}><ArrowUp size={14} /></button>
      <button type="button" title="Move down" className={btn} onClick={() => c.update((s) => moveNode(s, id, 1))}><ArrowDown size={14} /></button>
      {canDelete && <button type="button" title="Delete" className={btn} onClick={() => c.update((s) => removeNode(s, id))}><Trash2 size={14} /></button>}
    </div>
  );
}

const KIND_LABEL = { if: 'If', else_if: 'Else if', else: 'Else' } as const;

function BranchBlock({ node, number, depth }: { node: BranchNode; number: number; depth: number }) {
  const c = useContext(EditorCtx);
  const [open, setOpen] = useState(false);
  const hasElse = node.cases.some((x) => x.kind === 'else');
  const addStepAfter = () => { const s = newStep(); c.update((st) => insertAfter(st, node.id, s)); c.setFocusId(s.id); };
  return (
    <div className="py-1">
      {node.cases.map((cs, ci) => (
        <div key={cs.id} className="mb-2">
          <div className="group flex items-center gap-2 px-1">
            <span className="w-8 shrink-0 text-right text-ink-3">{number}.{ci + 1}.</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
              <CircleDot size={12} /> {KIND_LABEL[cs.kind]}
            </span>
            <div className="flex-1" />
            <button type="button" title={cs.kind === 'if' ? 'Remove this condition block' : 'Remove case'}
                    className="rounded p-1 text-ink-3 opacity-0 hover:bg-panel hover:text-bad group-hover:opacity-100"
                    onClick={() => c.update((s) => removeCase(s, cs.id))}><Trash2 size={14} /></button>
          </div>
          <div className="ml-6 border-l-2 border-line pl-4">
            {cs.kind !== 'else' && (
              <div className="my-2 rounded-lg border border-line bg-panel px-3 py-2 shadow-sm">
                <StepEditor content={cs.condition} placeholder="Describe when this case applies…"
                            onChange={(cond) => c.update((s) => setCondition(s, cs.id, cond))}
                            actions={c.actions} variables={c.variables} autoFocus={c.focusId === cs.id} />
              </div>
            )}
            <div className="pl-4">
              <NodeList list={cs.steps} depth={depth + 1} />
              <AddButtons small disabled={c.remaining <= 0}
                          onStep={() => { const s = newStep(); c.update((st) => appendToCase(st, cs.id, s)); c.setFocusId(s.id); }}
                          onBranch={depth + 1 < MAX_DEPTH ? () => { const b = newBranch(); c.update((st) => appendToCase(st, cs.id, b)); c.setFocusId(b.cases[0].id); } : undefined}
                          onGoto={() => c.update((st) => appendToCase(st, cs.id, newGoto()))} />
            </div>
          </div>
        </div>
      ))}
      <div className="relative ml-14 flex gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-hover">
          <Plus size={14} /> Add case <ChevronDown size={14} />
        </button>
        <button type="button" disabled={c.remaining <= 0} onClick={addStepAfter}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-hover disabled:opacity-40">
          <Plus size={14} /> Step after this block
        </button>
        {open && (
          <div className="absolute left-0 top-8 z-20 w-40 rounded-lg border border-line bg-panel py-1 shadow-lg">
            <button type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-hover"
                    onClick={() => { c.update((s) => addCase(s, node.id, 'else_if')); setOpen(false); }}>Else if</button>
            <button type="button" disabled={hasElse} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-40"
                    onClick={() => { c.update((s) => addCase(s, node.id, 'else')); setOpen(false); }}>Else</button>
          </div>
        )}
      </div>
    </div>
  );
}

// "Go to step": jump back to an earlier step; the run hands over to a person after the repeat limit.
function GotoRow({ node, index }: { node: GotoNode; index: number }) {
  const c = useContext(EditorCtx);
  const targets = gotoTargets(c.steps, node.id);
  const sel = 'rounded-md border border-line bg-panel px-2 py-1 text-sm';
  return (
    <div className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-hover/60">
      <span className="w-6 shrink-0 text-right text-ink-3">{index + 1}.</span>
      <span className="inline-flex items-center gap-1 rounded-md bg-action-soft px-2 py-0.5 text-xs font-medium text-action"><CornerUpLeft size={12} /> Go to step</span>
      <select value={node.target} onChange={(e) => c.update((s) => setGoto(s, node.id, { target: e.target.value }))} className={`${sel} min-w-0 flex-1`}>
        <option value="">Pick an earlier step…</option>
        {targets.map((t) => <option key={t.id} value={t.id}>Step {t.label} · {t.text.slice(0, 60) || '(empty)'}</option>)}
      </select>
      <label className="flex shrink-0 items-center gap-1 text-xs text-ink-2" title="After this many visits the conversation goes to a person">
        at most
        <select value={node.max_visits} onChange={(e) => c.update((s) => setGoto(s, node.id, { max_visits: Number(e.target.value) }))} className={sel}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}×</option>)}
        </select>
      </label>
      <RowTools id={node.id} canDelete />
    </div>
  );
}

// "Add step", "Add condition" (a new If block) and "Go to step" at the end of a list.
function AddButtons({ onStep, onBranch, onGoto, disabled, small, className = '' }: { onStep: () => void; onBranch?: () => void; onGoto?: () => void; disabled: boolean; small?: boolean; className?: string }) {
  const cls = `flex items-center gap-1.5 rounded-md px-2 py-1 text-ink-2 hover:bg-hover disabled:opacity-40 ${small ? 'text-xs' : 'text-sm'}`;
  return (
    <div className={`flex gap-1 ${className}`}>
      <button type="button" disabled={disabled} onClick={onStep} className={cls}><Plus size={small ? 13 : 15} /> Add step</button>
      {onBranch && <button type="button" disabled={disabled} onClick={onBranch} className={cls}><GitBranch size={small ? 13 : 15} /> Add condition</button>}
      {onGoto && <button type="button" onClick={onGoto} className={cls}><CornerUpLeft size={small ? 13 : 15} /> Go to step</button>}
    </div>
  );
}
