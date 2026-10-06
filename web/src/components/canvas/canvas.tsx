'use client';

// Workflow canvas, built the way Typebot's builder is (apps/builder/src/features/graph in
// github.com/baptisteArno/typebot.io): one CSS-transformed layer for pan/zoom driven by @use-gesture,
// absolutely positioned group cards, endpoints that report their on-screen position, and orthogonal SVG edges.
import { useDrag } from '@use-gesture/react';
import { GitBranch, Maximize, Minus, Plus, StretchHorizontal, Trash2, Type, CornerUpLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addGroup, appendItem, connect, EdgeFrom, EdgeTo, GraphEdge, loopEdges, newConditionItem, newStepItem, removeEdge, setEdge,
  sourceKey, targetKey, tidy, WorkflowGraph,
} from '@/lib/graph';
import { MAX_VISITS } from '@/lib/tree';
import { CanvasContext } from './context';
import { drawingPath, edgeMidpoint, edgePath } from './edge-path';
import { GroupCard } from './group-card';

type View = { x: number; y: number; scale: number };
type Pt = { x: number; y: number };
const MIN = 0.3, MAX = 1.6;

export function Canvas({ graph, onChange, actions, variables, highlight, readOnly }: {
  graph: WorkflowGraph;
  onChange: (g: WorkflowGraph, opts?: { transient?: boolean }) => void;
  actions: { key: string; name: string; enabled: boolean }[];
  variables: { key: string; label: string }[];
  highlight?: { current?: string | null; done?: Set<string> };
  readOnly?: boolean;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 60, y: 60, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const update = useCallback((fn: (g: WorkflowGraph) => WorkflowGraph, opts?: { transient?: boolean }) => onChange(fn(graphRef.current), opts), [onChange]);

  // Screen point → canvas point.
  const toCanvas = useCallback((clientX: number, clientY: number): Pt => {
    const r = inner.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / viewRef.current.scale, y: (clientY - r.top) / viewRef.current.scale };
  }, []);

  // Endpoint registry: each dot hands over its element; arrows are measured from them after every change.
  const els = useRef(new Map<string, HTMLElement>());
  const register = useCallback((key: string) => (el: HTMLElement | null) => { if (el) els.current.set(key, el); else els.current.delete(key); }, []);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    inner.current?.querySelectorAll('[id^="group-"]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [graph.groups.length]);
  const [ys, setYs] = useState(new Map<string, number>());
  useLayoutEffect(() => {
    const m = new Map<string, number>();
    els.current.forEach((el, key) => { const r = el.getBoundingClientRect(); m.set(key, toCanvas(r.left + r.width / 2, r.top + r.height / 2).y); });
    setYs(m);
  }, [graph, tick, view.scale, toCanvas]);

  // Pan by dragging empty space; wheel pans, Ctrl/⌘ + wheel (or pinch) zooms around the pointer.
  const zoomAt = useCallback((next: number, clientX: number, clientY: number) => {
    const o = outer.current!.getBoundingClientRect();
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, next));
      const mx = clientX - o.left, my = clientY - o.top;
      return { scale, x: mx - ((mx - v.x) / v.scale) * scale, y: my - ((my - v.y) / v.scale) * scale };
    });
  }, []);
  useEffect(() => {
    const el = outer.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(viewRef.current.scale * (1 - e.deltaY * 0.002), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);
  const bindPan = useDrag(({ delta: [dx, dy], event }) => {
    if ((event.target as HTMLElement).closest('[data-node], [data-ui]')) return;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  });

  // Connecting: from an output dot to a card or a step, with a live arrow under the pointer.
  const [drawing, setDrawing] = useState<{ from: EdgeFrom; start: Pt; at: Pt } | null>(null);
  const startConnect = useCallback((from: EdgeFrom, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = els.current.get(sourceKey(from))!.getBoundingClientRect();
    const start = toCanvas(el.left + el.width / 2, el.top + el.height / 2);
    setDrawing({ from, start, at: start });
  }, [toCanvas]);
  useEffect(() => {
    if (!drawing) return;
    const move = (e: PointerEvent) => setDrawing((d) => d && { ...d, at: toCanvas(e.clientX, e.clientY) });
    const up = (e: PointerEvent) => {
      const drop = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
      if (drop) {
        const [kind, groupId, itemId] = drop.split(':');
        const to: EdgeTo = kind === 'item' ? { groupId, itemId } : { groupId };
        update((g) => connect(g, drawing.from, to));
      }
      setDrawing(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drawing, toCanvas, update]);

  // Palette: drag a Step or Condition onto a card to add it there, or onto empty canvas for a new group.
  const [dragItem, setDragItem] = useState<{ type: 'step' | 'condition'; at: Pt } | null>(null);
  useEffect(() => {
    if (!dragItem) return;
    const move = (e: PointerEvent) => setDragItem((d) => d && { ...d, at: { x: e.clientX, y: e.clientY } });
    const up = (e: PointerEvent) => {
      const make = dragItem.type === 'step' ? newStepItem : newConditionItem;
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const groupId = target?.closest<HTMLElement>('[id^="group-"]')?.id.slice(6);
      if (groupId) update((g) => appendItem(g, groupId, make()));
      else if (target && outer.current?.contains(target)) {
        const p = toCanvas(e.clientX, e.clientY);
        update((g) => addGroup(g, { x: p.x - 40, y: p.y - 20 }, make(), dragItem.type === 'step' ? 'Group' : 'Check'));
      }
      setDragItem(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragItem, toCanvas, update]);

  // Arrows, drawn from the measured endpoints.
  const loops = useMemo(() => loopEdges(graph), [graph]);
  const groups = useMemo(() => new Map(graph.groups.map((g) => [g.id, g])), [graph.groups]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const del = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]');
      if (selected && !typing && (e.key === 'Delete' || e.key === 'Backspace')) { update((g) => removeEdge(g, selected)); setSelected(null); }
    };
    window.addEventListener('keydown', del);
    return () => window.removeEventListener('keydown', del);
  }, [selected, update]);
  const geo = (e: GraphEdge) => {
    const s = groups.get(e.from.groupId), t = groups.get(e.to.groupId);
    const sy = ys.get(sourceKey(e.from));
    if (!s || !t || sy === undefined) return null;
    const ty = e.to.itemId ? ys.get(targetKey(e.to)) : undefined;
    return { d: edgePath(s, sy, t, ty), mid: edgeMidpoint(s, sy, t, ty) };
  };

  const fit = () => {
    if (!graph.groups.length || !outer.current) return;
    const xs = graph.groups.map((g) => g.x), yv = graph.groups.map((g) => g.y);
    const w = Math.max(...xs) + 340 - Math.min(...xs), h = Math.max(...yv) + 320 - Math.min(...yv);
    const o = outer.current.getBoundingClientRect();
    const left = readOnly ? 24 : 170; // keep clear of the palette
    const scale = Math.min(1, Math.max(MIN, Math.min((o.width - left - 24) / w, (o.height - 48) / h)));
    setView({ scale, x: left - Math.min(...xs) * scale, y: 24 - Math.min(...yv) * scale });
  };
  useEffect(() => { fit(); /* first open */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = graph.edges.find((e) => e.id === selected);
  const selGeo = sel && geo(sel);
  const btn = 'flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink';

  return (
    <CanvasContext.Provider value={{ graph, update, scale: view.scale, actions, variables, register, startConnect, connecting: !!drawing, highlight, readOnly }}>
      <div ref={outer} {...bindPan()} onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-node], [data-ui], path')) setSelected(null); }}
           className="relative h-full w-full touch-none overflow-hidden bg-canvas"
           style={{ backgroundImage: 'radial-gradient(var(--color-line) 1px, transparent 1px)', backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <div ref={inner} className="absolute left-0 top-0 origin-top-left will-change-transform"
             style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <defs>
              <marker id="cv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9a9a94" /></marker>
              <marker id="cv-arrow-on" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--color-brand)" /></marker>
            </defs>
            {graph.edges.map((e) => {
              const g = geo(e);
              if (!g) return null;
              const on = e.id === selected;
              return (
                <g key={e.id} className="pointer-events-auto">
                  <path d={g.d} stroke="transparent" strokeWidth={16} fill="none" style={{ cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }} />
                  <path d={g.d} fill="none" strokeWidth={2} stroke={on ? 'var(--color-brand)' : loops.has(e.id) ? 'var(--color-action)' : '#a3a39d'}
                        strokeDasharray={loops.has(e.id) ? '6 4' : undefined} markerEnd={on ? 'url(#cv-arrow-on)' : 'url(#cv-arrow)'} />
                </g>
              );
            })}
            {drawing && <path d={drawingPath(drawing.start, drawing.at)} fill="none" stroke="var(--color-brand)" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#cv-arrow-on)" />}
          </svg>
          {graph.groups.map((g) => <GroupCard key={g.id} group={g} />)}
          {/* Loop arrows say how often they may repeat. */}
          {graph.edges.filter((e) => loops.has(e.id)).map((e) => {
            const g = geo(e);
            return g && (
              <button key={e.id} data-ui onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-action/30 bg-action-soft px-1.5 py-0.5 text-[10px] font-medium text-action"
                      style={{ left: g.mid.x, top: g.mid.y }}>
                ↺ {e.maxVisits ? `max ${e.maxVisits}` : 'no limit'}
              </button>
            );
          })}
          {sel && selGeo && !readOnly && (
            <div data-ui className="absolute z-20 flex -translate-x-1/2 translate-y-3 items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs shadow-lg"
                 style={{ left: selGeo.mid.x, top: selGeo.mid.y }}>
              {loops.has(sel.id) && <>
                <label className="flex items-center gap-1">repeat at most
                  <input type="number" min={1} max={MAX_VISITS} value={sel.maxVisits ?? ''} placeholder="—"
                         onChange={(e) => update((g) => setEdge(g, sel.id, { maxVisits: e.target.value ? Math.min(MAX_VISITS, Math.max(1, Math.round(Number(e.target.value)))) : undefined }))}
                         className="w-14 rounded border border-line px-1 py-0.5" />×</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!sel.fresh} onChange={(e) => update((g) => setEdge(g, sel.id, { fresh: e.target.checked }))} /> ask again</label>
              </>}
              <button title="Delete arrow (Del)" onClick={() => { update((g) => removeEdge(g, sel.id)); setSelected(null); }} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-bad"><Trash2 size={13} /></button>
            </div>
          )}
        </div>

        {!readOnly && (
          <div data-ui className="absolute left-3 top-3 flex flex-col gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-sm">
            <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Drag in</div>
            {([['step', 'Step', Type], ['condition', 'Condition', GitBranch]] as const).map(([type, label, Icon]) => (
              <button key={type} onPointerDown={(e) => { e.preventDefault(); setDragItem({ type, at: { x: e.clientX, y: e.clientY } }); }}
                      className="flex cursor-grab items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-hover"><Icon size={14} /> {label}</button>
            ))}
            <div className="mt-1 flex items-center gap-1 px-1 text-[10px] text-ink-3"><CornerUpLeft size={10} /> drag a dot to connect</div>
          </div>
        )}
        <div data-ui className="absolute right-3 top-3 flex items-center gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-sm">
          <button title="Zoom out" className={btn} onClick={() => { const o = outer.current!.getBoundingClientRect(); zoomAt(view.scale - 0.15, o.left + o.width / 2, o.top + o.height / 2); }}><Minus size={15} /></button>
          <span className="w-10 text-center text-xs text-ink-3">{Math.round(view.scale * 100)}%</span>
          <button title="Zoom in" className={btn} onClick={() => { const o = outer.current!.getBoundingClientRect(); zoomAt(view.scale + 0.15, o.left + o.width / 2, o.top + o.height / 2); }}><Plus size={15} /></button>
          <button title="Fit to screen" className={btn} onClick={fit}><Maximize size={15} /></button>
          {!readOnly && <button title="Tidy up" className={btn} onClick={() => update((g) => tidy(g, (id) => (document.getElementById(`group-${id}`)?.offsetHeight)))}><StretchHorizontal size={15} /></button>}
        </div>
        {dragItem && (
          <div className="pointer-events-none fixed z-50 rounded-md border border-brand bg-panel px-2.5 py-1.5 text-sm shadow-lg" style={{ left: dragItem.at.x + 8, top: dragItem.at.y + 8 }}>
            {dragItem.type === 'step' ? 'Step' : 'Condition'}
          </div>
        )}
      </div>
    </CanvasContext.Provider>
  );
}
