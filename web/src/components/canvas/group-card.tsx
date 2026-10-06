'use client';

import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2, X } from 'lucide-react';
import { useDrag } from '@use-gesture/react';
import {
  addCase, appendItem, GraphGroup, GraphItem, GROUP_WIDTH, moveGroup, moveItem, newConditionItem, newStepItem,
  removeCase, removeGroup, removeItem, renameGroup, setCaseCondition, setStepContent,
} from '@/lib/graph';
import { StepEditor } from '../step-editor';
import { useCanvas } from './context';

const KIND = { if: 'If', else_if: 'Else if', else: 'Else' } as const;

// An output dot on a card's right edge. Dragging from it draws an arrow.
function Source({ id, from }: { id: string; from: Parameters<ReturnType<typeof useCanvas>['startConnect']>[0] }) {
  const c = useCanvas();
  return (
    <span ref={c.register(id)} data-node title="Drag to connect"
          onPointerDown={(e) => { if (!c.readOnly) c.startConnect(from, e); }}
          className="absolute -right-[9px] top-1/2 z-10 flex size-[18px] -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border border-line bg-panel shadow-sm hover:border-brand">
      <span className="size-[9px] rounded-full border-[2.5px] border-brand/70" />
    </span>
  );
}

// Where an arrow lands: a card's top-left, or a step's left edge. Invisible until connecting.
function Target({ id, className }: { id: string; className: string }) {
  const c = useCanvas();
  return <span ref={c.register(id)} className={`pointer-events-none absolute size-3 rounded-full ${c.connecting ? 'bg-brand/40' : ''} ${className}`} />;
}

export function GroupCard({ group }: { group: GraphGroup }) {
  const c = useCanvas();
  const isStart = c.graph.start === group.id;
  // Drag the header to move the card; deltas are screen pixels, so divide by the zoom.
  // The first move saves an undo point; the rest of the drag doesn't.
  const bind = useDrag(({ delta: [dx, dy], first, event }) => {
    event.stopPropagation();
    if (c.readOnly) return;
    c.update((g) => {
      const grp = g.groups.find((x) => x.id === group.id)!;
      return moveGroup(g, group.id, Math.round(grp.x + dx / c.scale), Math.round(grp.y + dy / c.scale));
    }, { transient: !first });
  }, { filterTaps: true });

  return (
    <div data-node data-drop={`group:${group.id}`} id={`group-${group.id}`}
         className="absolute rounded-xl border border-line bg-panel shadow-sm"
         style={{ left: group.x, top: group.y, width: GROUP_WIDTH }}>
      <Target id={`tgt:${group.id}`} className="-left-1.5 top-[14px]" />
      <div {...bind()} className="group/h flex cursor-grab touch-none items-center gap-2 rounded-t-xl px-3 py-2 active:cursor-grabbing">
        {isStart && <span className="rounded bg-ok-soft px-1.5 text-[10px] font-semibold uppercase text-ok">Start</span>}
        <input value={group.title} disabled={c.readOnly} onPointerDown={(e) => e.stopPropagation()}
               onChange={(e) => c.update((g) => renameGroup(g, group.id, e.target.value))}
               className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
        {!isStart && !c.readOnly && (
          <button title="Delete group" onPointerDown={(e) => e.stopPropagation()} onClick={() => c.update((g) => removeGroup(g, group.id))}
                  className="rounded p-0.5 text-ink-3 opacity-0 hover:text-bad group-hover/h:opacity-100"><Trash2 size={14} /></button>
        )}
      </div>

      <div className="space-y-1.5 px-2 pb-2">
        {group.items.map((it, i) => <Item key={it.id} group={group} item={it} index={i} />)}
        {!c.readOnly && (
          <div className="flex gap-1 pt-0.5">
            <button onClick={() => c.update((g) => appendItem(g, group.id, newStepItem()))}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ink-3 hover:bg-hover hover:text-ink"><Plus size={12} /> Step</button>
            <button onClick={() => c.update((g) => appendItem(g, group.id, newConditionItem()))}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-ink-3 hover:bg-hover hover:text-ink"><GitBranch size={12} /> Condition</button>
          </div>
        )}
      </div>

      {/* The group's own output: where the run goes after its last step. */}
      <div className="relative flex items-center justify-end border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
        then
        <Source id={`src:${group.id}`} from={{ groupId: group.id }} />
      </div>
    </div>
  );
}

function Item({ group, item, index }: { group: GraphGroup; item: GraphItem; index: number }) {
  const c = useCanvas();
  const state = c.highlight?.current === item.id ? 'current' : c.highlight?.done?.has(item.id) ? 'done' : null;
  const box = state === 'current' ? 'border-warn bg-warn-soft/60' : state === 'done' ? 'border-ok/40 bg-ok-soft/40' : 'border-line bg-canvas/40';
  const tools = !c.readOnly && (
    <div className="absolute -top-2.5 right-1 hidden gap-0.5 rounded-md border border-line bg-panel px-0.5 shadow-sm group-hover/i:flex">
      <button title="Move up" onClick={() => c.update((g) => moveItem(g, group.id, item.id, -1))} className="p-0.5 text-ink-3 hover:text-ink"><ArrowUp size={12} /></button>
      <button title="Move down" onClick={() => c.update((g) => moveItem(g, group.id, item.id, 1))} className="p-0.5 text-ink-3 hover:text-ink"><ArrowDown size={12} /></button>
      <button title="Delete" onClick={() => c.update((g) => removeItem(g, group.id, item.id))} className="p-0.5 text-ink-3 hover:text-bad"><Trash2 size={12} /></button>
    </div>
  );

  if (item.type === 'step') return (
    <div data-node data-drop={`item:${group.id}:${item.id}`} className={`group/i relative rounded-lg border px-2.5 py-1.5 text-sm ${box}`}>
      <Target id={`tgt:${item.id}`} className="-left-[15px] top-1/2 -translate-y-1/2" />
      {tools}
      <StepEditor content={item.content} placeholder={index === 0 ? 'Tell the AI what to do…' : 'Next instruction…'}
                  onChange={(content) => c.update((g) => setStepContent(g, item.id, content))}
                  actions={c.actions} variables={c.variables} />
    </div>
  );

  const hasElse = item.cases.some((x) => x.kind === 'else');
  return (
    <div data-node data-drop={`item:${group.id}:${item.id}`} className={`group/i relative rounded-lg border px-2.5 py-1.5 text-sm ${box}`}>
      <Target id={`tgt:${item.id}`} className="-left-[15px] top-4" />
      {tools}
      <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand"><GitBranch size={12} /> Condition</div>
      <div className="space-y-1">
        {item.cases.map((cs) => (
          <div key={cs.id} className="group/c relative flex items-start gap-1.5 rounded-md border border-line bg-panel px-2 py-1">
            <span className="mt-0.5 shrink-0 rounded bg-brand-soft px-1.5 text-[10px] font-semibold text-brand">{KIND[cs.kind]}</span>
            <div className="min-w-0 flex-1">
              {cs.kind === 'else'
                ? <span className="text-ink-3">otherwise</span>
                : <StepEditor content={cs.condition} placeholder="When…" actions={c.actions} variables={c.variables}
                              onChange={(cond) => c.update((g) => setCaseCondition(g, item.id, cs.id, cond))} />}
            </div>
            {!c.readOnly && cs.kind !== 'if' && (
              <button title="Remove case" onClick={() => c.update((g) => removeCase(g, item.id, cs.id))}
                      className="mt-0.5 hidden text-ink-3 hover:text-bad group-hover/c:block"><X size={12} /></button>
            )}
            <Source id={`src:${item.id}:${cs.id}`} from={{ groupId: group.id, itemId: item.id, port: cs.id }} />
          </div>
        ))}
      </div>
      {!c.readOnly && (
        <div className="mt-1 flex gap-1">
          <button onClick={() => c.update((g) => addCase(g, item.id, 'else_if'))} className="rounded px-1.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink">+ Else if</button>
          {!hasElse && <button onClick={() => c.update((g) => addCase(g, item.id, 'else'))} className="rounded px-1.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink">+ Else</button>}
        </div>
      )}
    </div>
  );
}
