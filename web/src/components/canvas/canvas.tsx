'use client';

// Workflow canvas on React Flow (@xyflow/react, MIT). React Flow gives pan/zoom, node dragging, handles,
// connecting, re-pointing arrows, box selection and the minimap; this file maps our WorkflowGraph onto it
// and adds the Typebot-style pieces: step drag between groups, palette, drop-on-card connecting, copy/paste.
import '@xyflow/react/dist/style.css';
import {
  Background, BackgroundVariant, Connection, ConnectionLineType, Edge, EdgeChange, FinalConnectionState, MarkerType, MiniMap,
  NodeChange, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges, useConnection, useNodesInitialized, useReactFlow, useViewport,
} from '@xyflow/react';
import { Maximize, Minus, Plus, StretchHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addGroup, addVariable, BLOCKS, Clip, connect, copyGroups, EdgeTo, fromHandle, GraphItem, insertItem, loopEdges, moveItemTo, newStepItem, removeVariable, toVarName,
  pasteGroups, reconnect, removeEdge, removeMany, sourceHandle, targetHandle, tidy, toHandle, WorkflowGraph,
} from '@/lib/graph';
import { CanvasContext, DropSlot } from './context';
import { EDGE_COLOR, WfEdge, WfEdgeType } from './edge';
import { BLOCK_ICON, GroupNode, GroupNodeType } from './group-card';

type Props = {
  graph: WorkflowGraph;
  onChange: (g: WorkflowGraph, opts?: { transient?: boolean }) => void;
  actions: { key: string; name: string; enabled: boolean }[];
  variables: { key: string; label: string }[];
  highlight?: { current?: string | null; done?: Set<string> };
  readOnly?: boolean;
};
type NodeUi = Pick<GroupNodeType, 'measured' | 'selected' | 'dragging'>;
type ItemDrag = ({ itemId: string } | { make: () => GraphItem; label: string }) & { x: number; y: number };

const nodeTypes = { card: GroupNode };
const edgeTypes = { wf: WfEdge };
const FIT = { padding: { top: '40px', right: '40px', bottom: '40px', left: '230px' }, maxZoom: 1 } as const;

export function Canvas(props: Props) {
  return <ReactFlowProvider><Flow {...props} /></ReactFlowProvider>;
}

// The element under a pointer: a step card ("item:<group>:<item>"), a group card ("group:<group>"), or the empty pane.
function hit(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const card = el?.closest<HTMLElement>('[data-drop^="group:"]');
  const item = el?.closest<HTMLElement>('[data-drop^="item:"]');
  return { el, card, item, pane: !card && !!el?.closest('.react-flow__pane') };
}
const point = (e: MouseEvent | TouchEvent) => ('changedTouches' in e ? e.changedTouches[0] : e);

function Flow({ graph, onChange, actions, variables, highlight, readOnly }: Props) {
  const rf = useReactFlow<GroupNodeType, WfEdgeType>();
  const { zoom } = useViewport();
  const connecting = useConnection((s) => s.inProgress);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const update = useCallback((fn: (g: WorkflowGraph) => WorkflowGraph, opts?: { transient?: boolean }) => onChange(fn(graphRef.current), opts), [onChange]);

  // Nodes come from the graph; React Flow's own per-node state (size, selection, dragging) is kept beside it.
  const [ui, setUi] = useState<Record<string, NodeUi>>({});
  const nodes = useMemo<GroupNodeType[]>(() => graph.groups.map((g) => ({
    id: g.id, type: 'card', position: { x: g.x, y: g.y }, data: { group: g }, dragHandle: '.wf-drag', deletable: g.id !== graph.start, ...ui[g.id],
  })), [graph, ui]);
  const onNodesChange = useCallback((changes: NodeChange<GroupNodeType>[]) => {
    const next = applyNodeChanges(changes, nodes);
    setUi(Object.fromEntries(next.map((n) => [n.id, { measured: n.measured, selected: n.selected, dragging: n.dragging }])));
    const moves = changes.filter((c) => c.type === 'position' && c.position);
    // The drag-start handler saved an undo point, so the moves themselves are transient.
    if (moves.length) update((g) => ({ ...g, groups: g.groups.map((grp) => {
      const m = moves.find((c) => c.type === 'position' && c.id === grp.id);
      return m && m.type === 'position' && m.position ? { ...grp, x: Math.round(m.position.x), y: Math.round(m.position.y) } : grp;
    }) }), { transient: true });
  }, [nodes, update]);

  // Arrows come from the graph too; only their selection is local.
  const loops = useMemo(() => loopEdges(graph), [graph]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const edges = useMemo<WfEdgeType[]>(() => graph.edges.map((e) => {
    const on = picked.has(e.id);
    return {
      id: e.id, type: 'wf', source: e.from.groupId, sourceHandle: sourceHandle(e.from), target: e.to.groupId, targetHandle: targetHandle(e.to),
      data: { edge: e }, selected: on, zIndex: on ? 1000 : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: on ? EDGE_COLOR.selected : loops.has(e.id) ? EDGE_COLOR.loop : EDGE_COLOR.idle },
    };
  }), [graph.edges, picked, loops]);
  const onEdgesChange = useCallback((changes: EdgeChange<WfEdgeType>[]) => setPicked((s) => {
    const next = new Set(s);
    for (const c of changes) if (c.type === 'select') (c.selected ? next.add(c.id) : next.delete(c.id));
    return next;
  }), []);
  const selectEdge = useCallback((id: string) => {
    setPicked(new Set([id]));
    setUi((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { ...v, selected: false }])));
  }, []);

  // Connecting. A drop on a handle is handled by onConnect; a drop anywhere on a card or step connects there too,
  // and a drop on empty canvas makes a new group with an empty step and connects to it (like Typebot).
  const onConnect = useCallback((c: Connection) =>
    update((g) => connect(g, fromHandle(c.source, c.sourceHandle), toHandle(c.target, c.targetHandle))), [update]);
  const dropTarget = (e: MouseEvent | TouchEvent): EdgeTo | 'pane' | null => {
    const { clientX, clientY } = point(e);
    const h = hit(clientX, clientY);
    if (h.item) { const [, groupId, itemId] = h.item.dataset.drop!.split(':'); return { groupId, itemId }; }
    if (h.card) return { groupId: h.card.dataset.drop!.slice(6) };
    return h.pane ? 'pane' : null;
  };
  const toNewGroup = (g: WorkflowGraph, e: MouseEvent | TouchEvent) => {
    const { clientX, clientY } = point(e);
    const at = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const next = addGroup(g, { x: at.x, y: at.y - 20 }, newStepItem());
    return { g: next, to: { groupId: next.groups.at(-1)!.id } };
  };
  const onConnectEnd = useCallback((e: MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (s.isValid || !s.fromHandle || s.fromHandle.type !== 'source') return;
    const from = fromHandle(s.fromHandle.nodeId, s.fromHandle.id);
    const to = dropTarget(e);
    if (to === 'pane') update((g) => { const n = toNewGroup(g, e); return connect(n.g, from, n.to); });
    else if (to) update((g) => connect(g, from, to));
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-pointing: drag either end of an arrow. Dropping its head on a card works too; dropping it on nothing deletes it.
  const repointed = useRef(true);
  const onReconnect = useCallback((old: Edge, c: Connection) => {
    repointed.current = true;
    update((g) => reconnect(g, old.id, fromHandle(c.source, c.sourceHandle), toHandle(c.target, c.targetHandle)));
  }, [update]);
  const onReconnectEnd = useCallback((e: MouseEvent | TouchEvent, edge: Edge, _t: unknown, s: FinalConnectionState) => {
    if (repointed.current) return;
    repointed.current = true;
    const old = graphRef.current.edges.find((x) => x.id === edge.id);
    const to = s.fromHandle?.type === 'source' ? dropTarget(e) : null; // the head moved
    if (old && to && to !== 'pane') update((g) => reconnect(g, old.id, old.from, to));
    else update((g) => removeEdge(g, edge.id));
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging a step (by its grip) or a palette item: a line shows where it will land.
  const [drag, setDrag] = useState<ItemDrag | null>(null);
  const [dropSlot, setDropSlot] = useState<DropSlot>(null);
  const startItemDrag = useCallback((e: React.PointerEvent, d: { itemId: string } | { make: () => GraphItem; label: string }) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({ ...d, x: e.clientX, y: e.clientY });
  }, []);
  const slotAt = (x: number, y: number): DropSlot => {
    const { card } = hit(x, y);
    if (!card) return null;
    const mids = [...card.querySelectorAll<HTMLElement>('[data-drop^="item:"]')].map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
    return { groupId: card.dataset.drop!.slice(6), index: mids.filter((m) => m < y).length };
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => { setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY }); setDropSlot(slotAt(e.clientX, e.clientY)); };
    const end = () => { setDrag(null); setDropSlot(null); };
    const up = (e: PointerEvent) => {
      const slot = slotAt(e.clientX, e.clientY);
      const { pane } = hit(e.clientX, e.clientY);
      const at = rf.screenToFlowPosition({ x: e.clientX - 30, y: e.clientY - 20 });
      if ('itemId' in drag) {
        if (slot) update((g) => moveItemTo(g, drag.itemId, slot));
        else if (pane) update((g) => moveItemTo(g, drag.itemId, { at }));
      } else if (slot) update((g) => insertItem(g, slot.groupId, drag.make(), slot.index));
      else if (pane) update((g) => addGroup(g, at, drag.make()));
      end();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') end(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key); };
  }, [drag, rf, update]); // eslint-disable-line react-hooks/exhaustive-deps

  // Copy (Ctrl+C), paste (Ctrl+V), duplicate (Ctrl+D) and select all (Ctrl+A) for groups. Pasted groups come in selected.
  const clip = useRef<Clip | null>(null);
  const pastes = useRef(0);
  useEffect(() => {
    if (readOnly) return;
    const paste = (c: Clip) => {
      pastes.current += 1;
      const { graph: g, ids } = pasteGroups(graphRef.current, c, 48 * pastes.current);
      onChange(g);
      setPicked(new Set());
      setUi((u) => ({ ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { ...v, selected: false }])), ...Object.fromEntries(ids.map((id) => [id, { selected: true }])) }));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]')) return;
      const selected = graphRef.current.groups.filter((g) => ui[g.id]?.selected).map((g) => g.id);
      const k = e.key.toLowerCase();
      if (k === 'c' && selected.length) { clip.current = copyGroups(graphRef.current, selected); pastes.current = 0; }
      else if (k === 'v' && clip.current) { e.preventDefault(); paste(clip.current); }
      else if (k === 'd' && selected.length) { e.preventDefault(); pastes.current = 0; paste(copyGroups(graphRef.current, selected)); }
      else if (k === 'a') { e.preventDefault(); setUi((u) => Object.fromEntries(graphRef.current.groups.map((g) => [g.id, { ...u[g.id], selected: true }]))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, onChange, readOnly]);

  // Fit once, after the cards have been measured.
  const measured = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => { if (measured && !fitted.current) { fitted.current = true; rf.fitView(FIT); } }, [measured, rf]);

  const tidyUp = () => {
    update((g) => tidy(g, (id) => rf.getInternalNode(id)?.measured.height));
    requestAnimationFrame(() => rf.fitView({ ...FIT, duration: 300 }));
  };
  // Built-in variables plus the workflow's own, for {{ }} pickers in every block.
  const allVars = useMemo(() => [...variables, ...(graph.variables ?? []).map((k) => ({ key: k, label: k }))], [variables, graph.variables]);
  const [newVar, setNewVar] = useState('');
  const btn = 'flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink';

  return (
    <CanvasContext.Provider value={{ graph, update, actions, variables: allVars, loops, selectEdge, startItemDrag, dropSlot, highlight, readOnly }}>
      <ReactFlow<GroupNodeType, WfEdgeType>
        className={`bg-canvas ${connecting ? 'wf-connecting' : ''}`}
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeDragStart={() => update((g) => g)}
        onConnect={onConnect} onConnectEnd={onConnectEnd}
        onReconnectStart={() => { repointed.current = false; }} onReconnect={onReconnect} onReconnectEnd={onReconnectEnd}
        onDelete={({ nodes: ns, edges: es }) => update((g) => removeMany(g, ns.map((n) => n.id), es.map((e) => e.id)))}
        nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        selectionKeyCode="Shift" multiSelectionKeyCode={['Control', 'Meta']}
        panOnScroll zoomActivationKeyCode={['Control', 'Meta']} minZoom={0.3} maxZoom={1.6}
        connectionLineType={ConnectionLineType.SmoothStep} connectionLineStyle={{ stroke: EDGE_COLOR.selected, strokeWidth: 2, strokeDasharray: '5 4' }}
        connectionRadius={28}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d6d6d0" />
        <MiniMap position="bottom-left" pannable zoomable nodeColor="#e6e6e2" nodeStrokeColor="#c9c9c3" maskColor="rgba(245,245,242,0.7)" />

        {!readOnly && (
          <Panel position="top-left" className="!m-3 flex max-h-[calc(100%-24px)] w-[200px] flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-panel p-2 shadow-sm">
            {BLOCKS.map((sec) => (
              <div key={sec.section}>
                <div className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{sec.section}</div>
                <div className="grid grid-cols-2 gap-1">
                  {sec.items.map((b) => {
                    const Icon = BLOCK_ICON[b.key];
                    return (
                      <button key={b.key} title={`Drag in: ${b.label}`} onPointerDown={(e) => startItemDrag(e, { make: b.make, label: b.label })}
                              className={`flex cursor-grab touch-none items-center gap-1.5 rounded-md border border-line px-1.5 py-1 text-xs hover:bg-hover ${sec.items.length === 1 ? 'col-span-2' : ''}`}>
                        <Icon size={13} className="shrink-0 text-ink-2" /> <span className="truncate">{b.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* The workflow's own variables: inputs fill them, rules compare them, any block can show them as {{name}}. */}
            <div>
              <div className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Variables</div>
              <div className="flex flex-wrap gap-1">
                {(graph.variables ?? []).map((v) => (
                  <span key={v} className="group/v flex items-center gap-0.5 rounded bg-var-soft px-1.5 py-0.5 font-mono text-[11px] text-var">
                    {v}
                    <button title="Remove variable" onClick={() => update((g) => removeVariable(g, v))} className="hidden hover:text-bad group-hover/v:block"><X size={10} /></button>
                  </span>
                ))}
              </div>
              <input value={newVar} placeholder="+ new variable" onChange={(e) => setNewVar(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && toVarName(newVar)) { update((g) => addVariable(g, toVarName(newVar))); setNewVar(''); } }}
                     className="mt-1 w-full rounded border border-line px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-brand" />
            </div>
            <div className="space-y-0.5 px-0.5 text-[10px] leading-snug text-ink-3">
              <div>Drag a dot to connect</div>
              <div>Shift + drag to select</div>
              <div>Ctrl + C / V / D to copy, paste, duplicate</div>
            </div>
          </Panel>
        )}
        <Panel position="top-right" className="!m-3 flex items-center gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-sm">
          <button title="Zoom out" className={btn} onClick={() => rf.zoomOut({ duration: 150 })}><Minus size={15} /></button>
          <span className="w-10 text-center text-xs text-ink-3">{Math.round(zoom * 100)}%</span>
          <button title="Zoom in" className={btn} onClick={() => rf.zoomIn({ duration: 150 })}><Plus size={15} /></button>
          <button title="Fit to screen" className={btn} onClick={() => rf.fitView({ ...FIT, duration: 300 })}><Maximize size={15} /></button>
          {!readOnly && <button title="Tidy up" className={btn} onClick={tidyUp}><StretchHorizontal size={15} /></button>}
        </Panel>
      </ReactFlow>
      {drag && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-brand bg-panel px-2.5 py-1.5 text-sm shadow-lg" style={{ left: drag.x + 10, top: drag.y + 10 }}>
          {'itemId' in drag ? 'Move step' : drag.label}
        </div>
      )}
    </CanvasContext.Provider>
  );
}
