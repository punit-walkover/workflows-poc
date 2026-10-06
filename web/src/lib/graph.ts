// Canvas workflow (same shape as the server's WorkflowGraph) and immutable edit helpers for the canvas editor.
import { Inline, rid } from './tree';

export type CaseKind = 'if' | 'else_if' | 'else';
export type GraphItem =
  | { id: string; type: 'step'; content: Inline[] }
  | { id: string; type: 'condition'; cases: { id: string; kind: CaseKind; condition: Inline[] }[] };
export interface GraphGroup { id: string; title: string; x: number; y: number; items: GraphItem[] }
export interface EdgeFrom { groupId: string; itemId?: string; port?: string }
export interface EdgeTo { groupId: string; itemId?: string }
export interface GraphEdge { id: string; from: EdgeFrom; to: EdgeTo; maxVisits?: number; fresh?: boolean }
export interface WorkflowGraph { start: string; groups: GraphGroup[]; edges: GraphEdge[] }

export const MAX_GRAPH_STEPS = 50;
export const GROUP_WIDTH = 300;

export const newStepItem = (): GraphItem => ({ id: rid(), type: 'step', content: [] });
export const newConditionItem = (): GraphItem => ({ id: rid(), type: 'condition', cases: [{ id: rid(), kind: 'if', condition: [] }, { id: rid(), kind: 'else', condition: [] }] });

// Endpoint ids (what the canvas measures on screen): a group's end, a condition case, a group's top, a step's left edge.
export const sourceKey = (f: EdgeFrom) => (f.itemId ? `src:${f.itemId}:${f.port}` : `src:${f.groupId}`);
export const targetKey = (t: EdgeTo) => (t.itemId ? `tgt:${t.itemId}` : `tgt:${t.groupId}`);
const sameSource = (a: EdgeFrom, b: EdgeFrom) => a.groupId === b.groupId && a.itemId === b.itemId && a.port === b.port;

const mapGroup = (g: WorkflowGraph, id: string, fn: (grp: GraphGroup) => GraphGroup): WorkflowGraph =>
  ({ ...g, groups: g.groups.map((grp) => (grp.id === id ? fn(grp) : grp)) });
const mapItem = (g: WorkflowGraph, itemId: string, fn: (it: GraphItem) => GraphItem): WorkflowGraph =>
  ({ ...g, groups: g.groups.map((grp) => ({ ...grp, items: grp.items.map((it) => (it.id === itemId ? fn(it) : it)) })) });

export const addGroup = (g: WorkflowGraph, at: { x: number; y: number }, item: GraphItem, title = 'Group'): WorkflowGraph =>
  ({ ...g, groups: [...g.groups, { id: rid(), title, x: Math.round(at.x), y: Math.round(at.y), items: [item] }] });

export const moveGroup = (g: WorkflowGraph, id: string, x: number, y: number) => mapGroup(g, id, (grp) => ({ ...grp, x, y }));
export const renameGroup = (g: WorkflowGraph, id: string, title: string) => mapGroup(g, id, (grp) => ({ ...grp, title }));

// Removing a group drops every arrow into or out of it; the start group can't be removed.
export const removeGroup = (g: WorkflowGraph, id: string): WorkflowGraph => (id === g.start ? g : {
  ...g, groups: g.groups.filter((grp) => grp.id !== id), edges: g.edges.filter((e) => e.from.groupId !== id && e.to.groupId !== id),
});

export const appendItem = (g: WorkflowGraph, groupId: string, item: GraphItem) => mapGroup(g, groupId, (grp) => ({ ...grp, items: [...grp.items, item] }));

export const moveItem = (g: WorkflowGraph, groupId: string, itemId: string, dir: -1 | 1) => mapGroup(g, groupId, (grp) => {
  const i = grp.items.findIndex((it) => it.id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= grp.items.length) return grp;
  const items = [...grp.items];
  [items[i], items[j]] = [items[j], items[i]];
  return { ...grp, items };
});

// Removing an item also drops arrows from its cases and arrows pointing at it.
export const removeItem = (g: WorkflowGraph, groupId: string, itemId: string): WorkflowGraph => ({
  ...mapGroup(g, groupId, (grp) => ({ ...grp, items: grp.items.filter((it) => it.id !== itemId) })),
  edges: g.edges.filter((e) => e.from.itemId !== itemId && e.to.itemId !== itemId),
});

export const setStepContent = (g: WorkflowGraph, itemId: string, content: Inline[]) =>
  mapItem(g, itemId, (it) => (it.type === 'step' ? { ...it, content } : it));
export const setCaseCondition = (g: WorkflowGraph, itemId: string, caseId: string, condition: Inline[]) =>
  mapItem(g, itemId, (it) => (it.type === 'condition' ? { ...it, cases: it.cases.map((c) => (c.id === caseId ? { ...c, condition } : c)) } : it));

// Else if goes before Else; only one Else.
export const addCase = (g: WorkflowGraph, itemId: string, kind: 'else_if' | 'else') => mapItem(g, itemId, (it) => {
  if (it.type !== 'condition') return it;
  const c = { id: rid(), kind, condition: [] as Inline[] };
  const e = it.cases.findIndex((x) => x.kind === 'else');
  if (kind === 'else') return e >= 0 ? it : { ...it, cases: [...it.cases, c] };
  return e >= 0 ? { ...it, cases: [...it.cases.slice(0, e), c, ...it.cases.slice(e)] } : { ...it, cases: [...it.cases, c] };
});
export const removeCase = (g: WorkflowGraph, itemId: string, caseId: string): WorkflowGraph => ({
  ...mapItem(g, itemId, (it) => (it.type === 'condition' ? { ...it, cases: it.cases.filter((c) => c.id !== caseId) } : it)),
  edges: g.edges.filter((e) => !(e.from.itemId === itemId && e.from.port === caseId)),
});

// One arrow per output: connecting again replaces the old arrow.
export const connect = (g: WorkflowGraph, from: EdgeFrom, to: EdgeTo): WorkflowGraph =>
  ({ ...g, edges: [...g.edges.filter((e) => !sameSource(e.from, from)), { id: rid(), from, to }] });
export const removeEdge = (g: WorkflowGraph, id: string) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) });
export const setEdge = (g: WorkflowGraph, id: string, patch: Partial<Pick<GraphEdge, 'maxVisits' | 'fresh'>>) =>
  ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

// Arrows that sit on a loop (their target can lead back to their source). Those need a repeat limit somewhere.
export function loopEdges(g: WorkflowGraph): Set<string> {
  const reach = (from: string, to: string) => {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const id = q.shift()!;
      if (id === to) return true;
      for (const e of g.edges) if (e.from.groupId === id && !seen.has(e.to.groupId)) { seen.add(e.to.groupId); q.push(e.to.groupId); }
    }
    return false;
  };
  return new Set(g.edges.filter((e) => reach(e.to.groupId, e.from.groupId)).map((e) => e.id));
}

export const graphStepCount = (g: WorkflowGraph) => g.groups.reduce((n, grp) => n + grp.items.filter((i) => i.type === 'step').length, 0);

// "Tidy up": columns by distance from the start group (same rule as the server's conversion layout).
export function tidy(g: WorkflowGraph, heightOf?: (groupId: string) => number | undefined): WorkflowGraph {
  const depth = new Map<string, number>([[g.start, 0]]);
  const q = [g.start];
  while (q.length) {
    const id = q.shift()!;
    for (const e of g.edges) if (e.from.groupId === id && !depth.has(e.to.groupId)) { depth.set(e.to.groupId, depth.get(id)! + 1); q.push(e.to.groupId); }
  }
  const tops = new Map<number, number>();
  const last = Math.max(0, ...depth.values()) + 1;
  return { ...g, groups: g.groups.map((grp) => {
    const d = depth.get(grp.id) ?? last;
    const y = tops.get(d) ?? 0;
    tops.set(d, y + (heightOf?.(grp.id) ?? cardHeight(grp)) + 48);
    return { ...grp, x: d * 400, y };
  }) };
}

// Rough card height when the real one isn't known (same estimate as the server's layout).
export const cardHeight = (grp: GraphGroup) =>
  76 + grp.items.reduce((h, it) => h + (it.type === 'step' ? 64 : 56 + it.cases.length * 48), 0);
