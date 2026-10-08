'use client';

import { AtSign, Filter, GitBranch, GripVertical, Hash, MessageSquare, Phone, Plus, Sparkles, TextCursorInput, Trash2, X } from 'lucide-react';
import { Handle, NodeProps, Node, Position, useConnection, useUpdateNodeInternals } from '@xyflow/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  addCase, appendItem, BLOCKS, GraphCase, GraphGroup, GraphItem, GROUP_WIDTH, INPUT_FORMATS, InputFormat,
  removeCase, removeGroup, removeItem, renameGroup, Rule, RULE_OPS, RuleOp, setCase, setCaseCondition, setInput,
  setStepContent, WorkflowGraph,
} from '@/lib/graph';
import { StepEditor } from '../step-editor';
import { useCanvas } from './context';
import { SaveResponse } from './save-response';
import { VarSelect } from './var-select';

const KIND = { if: 'If', else_if: 'Else if', else: 'Else' } as const;
export type GroupNodeType = Node<{ group: GraphGroup }, 'card'>;
export const BLOCK_ICON: Record<string, typeof Plus> = {
  step: Sparkles, bubble: MessageSquare, 'input-text': TextCursorInput, 'input-email': AtSign, 'input-number': Hash, 'input-phone': Phone,
  rules: Filter, 'ai-condition': GitBranch,
};
const iconOf = (it: GraphItem) => BLOCK_ICON[it.type === 'input' ? `input-${it.format}` : it.type === 'condition' ? (it.mode === 'rules' ? 'rules' : 'ai-condition') : it.type];

// An output dot. Its offset puts it on the card's right edge from inside a case row.
const Out = ({ id, right = 0 }: { id: string; right?: number }) => (
  <Handle type="source" position={Position.Right} id={id} isConnectableEnd={false} className="wf-out" style={{ right }} />
);
// Where an arrow can land: the card's top-left, or a block's left edge. Shown while connecting.
const In = ({ id, style }: { id: string; style?: React.CSSProperties }) => (
  <Handle type="target" position={Position.Left} id={id} isConnectableStart={false} className="wf-in" style={style} />
);

// A group card as a React Flow node. Drag it by the header; blocks inside are dragged by their grip.
export function GroupNode({ id, data: { group }, selected }: NodeProps<GroupNodeType>) {
  const c = useCanvas();
  const isStart = c.graph.start === id;
  const connecting = useConnection((s) => s.inProgress);
  // Handles are measured when the card resizes; reordering blocks doesn't resize it, so re-measure on any structure change.
  const updateInternals = useUpdateNodeInternals();
  const shape = group.items.map((it) => it.id + (it.type === 'condition' ? it.cases.map((x) => x.id).join() : '')).join('|');
  useEffect(() => updateInternals(id), [shape, id, updateInternals]);
  const slot = c.dropSlot?.groupId === id ? c.dropSlot.index : -1;
  const line = <div className="mx-1 h-0.5 rounded bg-brand" />;

  return (
    <div data-drop={`group:${id}`}
         className={`rounded-xl border bg-panel shadow-sm transition-shadow ${selected ? 'border-brand ring-2 ring-brand/20' : 'border-line'} ${connecting ? 'hover:ring-2 hover:ring-brand/40' : ''}`}
         style={{ width: GROUP_WIDTH }}>
      <In id="group" style={{ top: 18 }} />
      <div className="wf-drag group/h flex cursor-grab items-center gap-2 rounded-t-xl px-3 py-2 active:cursor-grabbing">
        {isStart && <span className="rounded bg-ok-soft px-1.5 text-[10px] font-semibold uppercase text-ok">Start</span>}
        <input value={group.title} disabled={c.readOnly}
               onChange={(e) => c.update((g) => renameGroup(g, id, e.target.value))}
               className="nodrag min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
        {!isStart && !c.readOnly && (
          <button title="Delete group" onClick={() => c.update((g) => removeGroup(g, id))}
                  className="nodrag rounded p-0.5 text-ink-3 opacity-0 hover:text-bad group-hover/h:opacity-100"><Trash2 size={14} /></button>
        )}
      </div>

      <div className="nodrag cursor-default space-y-1.5 px-2 pb-2">
        {group.items.map((it, i) => (
          <Fragment key={it.id}>{slot === i && line}<Item group={group} item={it} index={i} /></Fragment>
        ))}
        {slot === group.items.length && line}
        {!c.readOnly && <AddBlock groupId={id} />}
      </div>

      {/* The group's own output: where the run goes after its last block. */}
      <div className="relative flex items-center justify-end border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
        then
        <Out id="then" />
      </div>
    </div>
  );
}

// "+ Add block": the same menu as the palette, appending to this card.
function AddBlock({ groupId }: { groupId: string }) {
  const c = useCanvas();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as HTMLElement)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative pt-0.5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ink-3 hover:bg-hover hover:text-ink">
        <Plus size={12} /> Add block
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-line bg-panel p-1.5 shadow-lg">
          {BLOCKS.map((s) => (
            <div key={s.section} className="mb-1 last:mb-0">
              <div className="px-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{s.section}</div>
              <div className={`grid gap-1 ${s.section === 'Logic' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {s.items.map((b) => {
                  const Icon = BLOCK_ICON[b.key];
                  return (
                    <button key={b.key} onClick={() => { c.update((g) => appendItem(g, groupId, b.make())); setOpen(false); }}
                            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-left text-xs hover:bg-hover">
                      <Icon size={13} className="shrink-0 text-ink-2" /> {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ group, item, index }: { group: GraphGroup; item: GraphItem; index: number }) {
  const c = useCanvas();
  const state = c.highlight?.current === item.id ? 'current' : c.highlight?.done?.has(item.id) ? 'done' : null;
  const box = state === 'current' ? 'border-warn bg-warn-soft/60' : state === 'done' ? 'border-ok/40 bg-ok-soft/40' : 'border-line bg-canvas/40';
  const Icon = iconOf(item);
  const tools = !c.readOnly && (
    <div className="absolute -top-2.5 right-1 z-10 hidden gap-0.5 rounded-md border border-line bg-panel px-0.5 shadow-sm group-hover/i:flex">
      <button title="Delete" onClick={() => c.update((g) => removeItem(g, group.id, item.id))} className="p-0.5 text-ink-3 hover:text-bad"><Trash2 size={12} /></button>
    </div>
  );
  // Drag a block by its grip: to another spot in this group, into another group, or onto empty canvas for a new group.
  const grip = !c.readOnly && (
    <button title="Drag to move" onPointerDown={(e) => c.startItemDrag(e, { itemId: item.id })}
            className="absolute -left-0.5 top-1.5 hidden cursor-grab touch-none text-ink-3 hover:text-ink group-hover/i:block"><GripVertical size={13} /></button>
  );
  const cls = `group/i relative rounded-lg border px-2.5 py-1.5 text-sm ${box}`;
  const head = (label: string, color: string, extra?: React.ReactNode) => (
    <div className={`mb-1 flex items-center gap-1 pl-2 text-[11px] font-semibold uppercase tracking-wide ${color}`}>
      <Icon size={12} /> {label}{extra}
    </div>
  );

  if (item.type === 'step' || item.type === 'bubble') return (
    <div data-drop={`item:${group.id}:${item.id}`} className={cls}>
      <In id={item.id} style={{ left: -10 }} />
      {grip}{tools}
      <div className="flex items-start gap-2 pl-2">
        <Icon size={14} className={`mt-1 shrink-0 ${item.type === 'bubble' ? 'text-ink-2' : 'text-action'}`} />
        <div className="nowheel min-w-0 flex-1">
          <StepEditor content={item.content}
                      placeholder={item.type === 'bubble' ? 'Message to send, word for word…' : index === 0 ? 'Tell the AI what to do…' : 'Next instruction for the AI…'}
                      onChange={(content) => c.update((g) => setStepContent(g, item.id, content))}
                      actions={item.type === 'bubble' ? [] : c.actions} variables={c.variables} />
        </div>
      </div>
      {item.type === 'step' && <SaveResponse item={item} />}
    </div>
  );

  if (item.type === 'input') return (
    <div data-drop={`item:${group.id}:${item.id}`} className={cls}>
      <In id={item.id} style={{ left: -10, top: 16 }} />
      {grip}{tools}
      {head('Input', 'text-brand', (
        <select value={item.format} disabled={c.readOnly} onChange={(e) => c.update((g) => setInput(g, item.id, { format: e.target.value as InputFormat }))}
                className="ml-auto rounded border border-line bg-panel px-1 text-[11px] font-medium normal-case tracking-normal text-ink-2">
          {INPUT_FORMATS.map((f) => <option key={f.format} value={f.format}>{f.label}</option>)}
        </select>
      ))}
      <div className="nowheel rounded-md border border-line bg-panel px-2 py-1">
        <StepEditor content={item.prompt} placeholder="Question to ask (optional)…" actions={[]} variables={c.variables}
                    onChange={(prompt) => c.update((g) => setInput(g, item.id, { prompt }))} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
        Save answer in
        <VarSelect value={item.saveAs} set={(g, v) => setInput(g, item.id, { saveAs: v })} />
      </div>
      {item.format !== 'text' && (
        <input value={item.retry ?? ''} disabled={c.readOnly} placeholder="If the answer doesn't fit, say… (optional)"
               onChange={(e) => c.update((g) => setInput(g, item.id, { retry: e.target.value || undefined }))}
               className="mt-1 w-full rounded border border-line bg-panel px-1.5 py-0.5 text-xs outline-none placeholder:text-ink-3" />
      )}
    </div>
  );

  const rules = item.mode === 'rules';
  const hasElse = item.cases.some((x) => x.kind === 'else');
  return (
    <div data-drop={`item:${group.id}:${item.id}`} className={cls}>
      <In id={item.id} style={{ left: -10, top: 16 }} />
      {grip}{tools}
      {head(rules ? 'Condition' : 'AI condition', 'text-brand')}
      <div className="space-y-1">
        {item.cases.map((cs) => (
          <div key={cs.id} className="group/c relative flex items-start gap-1.5 rounded-md border border-line bg-panel px-2 py-1">
            <span className="mt-0.5 shrink-0 rounded bg-brand-soft px-1.5 text-[10px] font-semibold text-brand">{KIND[cs.kind]}</span>
            <div className="nowheel min-w-0 flex-1">
              {cs.kind === 'else'
                ? <span className="text-ink-3">otherwise</span>
                : rules
                  ? <Rules itemId={item.id} cs={cs} />
                  : <StepEditor content={cs.condition} placeholder="When…" actions={c.actions} variables={c.variables}
                                onChange={(cond) => c.update((g) => setCaseCondition(g, item.id, cs.id, cond))} />}
            </div>
            {!c.readOnly && cs.kind !== 'if' && (
              <button title="Remove case" onClick={() => c.update((g) => removeCase(g, item.id, cs.id))}
                      className="mt-0.5 hidden text-ink-3 hover:text-bad group-hover/c:block"><X size={12} /></button>
            )}
            <Out id={`${item.id}:${cs.id}`} right={-20} />
          </div>
        ))}
      </div>
      {!c.readOnly && (
        <div className="mt-1 flex gap-1">
          <button onClick={() => c.update((g) => {
            const next = addCase(g, item.id, 'else_if');
            if (!rules) return next;
            const it = next.groups.flatMap((x) => x.items).find((x) => x.id === item.id);
            const added = it?.type === 'condition' ? it.cases.find((x) => x.kind === 'else_if' && !x.rules) : undefined;
            return added ? setCase(next, item.id, added.id, { rules: [{ var: '', op: '=', value: '' }], join: 'and' }) : next;
          })} className="rounded px-1.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink">+ Else if</button>
          {!hasElse && <button onClick={() => c.update((g) => addCase(g, item.id, 'else'))} className="rounded px-1.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink">+ Else</button>}
        </div>
      )}
    </div>
  );
}

// One case's rules: variable · comparison · value, joined by AND or OR (like Typebot's condition block).
function Rules({ itemId, cs }: { itemId: string; cs: GraphCase }) {
  const c = useCanvas();
  const list = cs.rules ?? [];
  const join = cs.join ?? 'and';
  const put = (g: WorkflowGraph, i: number, patch: Partial<Rule>) => setCase(g, itemId, cs.id, { rules: list.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-1 text-xs">
      {list.map((r, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <button disabled={c.readOnly} onClick={() => c.update((g) => setCase(g, itemId, cs.id, { join: join === 'and' ? 'or' : 'and' }))}
                    className="rounded bg-hover px-1.5 text-[10px] font-semibold uppercase text-ink-2" title="Switch AND / OR">{join}</button>
          )}
          <div className="group/r flex flex-wrap items-center gap-1">
            <VarSelect value={r.var} builtins set={(g, v) => put(g, i, { var: v })} />
            <select value={r.op} disabled={c.readOnly} onChange={(e) => c.update((g) => put(g, i, { op: e.target.value as RuleOp }))}
                    className="rounded border border-line bg-panel px-1 py-0.5">
              {RULE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {r.op !== 'empty' && r.op !== 'not_empty' && (
              <div className="flex w-full min-w-0 items-center gap-1">
                {r.ref !== undefined
                  ? <VarSelect value={r.ref} builtins set={(g, v) => put(g, i, { ref: v })} />
                  : <input value={r.value} disabled={c.readOnly} placeholder="value" onChange={(e) => c.update((g) => put(g, i, { value: e.target.value }))}
                           className="w-full min-w-0 rounded border border-line bg-panel px-1.5 py-0.5 outline-none" />}
                {!c.readOnly && (
                  <button title={r.ref !== undefined ? 'Compare with typed text' : 'Compare with another variable'}
                          onClick={() => c.update((g) => put(g, i, r.ref !== undefined ? { ref: undefined } : { ref: '' }))}
                          className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[10px] ${r.ref !== undefined ? 'border-var/40 bg-var-soft text-var' : 'border-line text-ink-3 hover:text-ink'}`}>
                    {r.ref !== undefined ? '{x}' : 'abc'}
                  </button>
                )}
              </div>
            )}
            {!c.readOnly && list.length > 1 && (
              <button title="Remove rule" onClick={() => c.update((g) => setCase(g, itemId, cs.id, { rules: list.filter((_, j) => j !== i) }))}
                      className="hidden text-ink-3 hover:text-bad group-hover/r:block"><X size={11} /></button>
            )}
          </div>
        </Fragment>
      ))}
      {!c.readOnly && (
        <button onClick={() => c.update((g) => setCase(g, itemId, cs.id, { rules: [...list, { var: '', op: '=', value: '' }] }))}
                className="text-[11px] text-ink-3 hover:text-ink">+ rule</button>
      )}
    </div>
  );
}
