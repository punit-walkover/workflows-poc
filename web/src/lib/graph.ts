// Canvas workflow (same shape as the server's WorkflowGraph) and immutable edit helpers for the canvas editor.
import { Inline, rid } from './tree';

export type CaseKind = 'if' | 'else_if' | 'else';
export const RULE_OPS = [
  { op: '=', label: 'is' }, { op: '!=', label: 'is not' }, { op: 'contains', label: 'contains' },
  { op: '>', label: '>' }, { op: '<', label: '<' }, { op: 'empty', label: 'is empty' }, { op: 'not_empty', label: 'is set' },
] as const;
export type RuleOp = (typeof RULE_OPS)[number]['op'];
export interface Rule { var: string; op: RuleOp; value: string }
export const INPUT_FORMATS = [
  { format: 'text', label: 'Text' }, { format: 'email', label: 'Email' }, { format: 'number', label: 'Number' }, { format: 'phone', label: 'Phone' },
] as const;
export type InputFormat = (typeof INPUT_FORMATS)[number]['format'];
export interface GraphCase { id: string; kind: CaseKind; condition: Inline[]; rules?: Rule[]; join?: 'and' | 'or' }
// step = AI instruction · bubble = fixed message · input = ask and save the reply · condition = AI- or rule-judged branch.
export type GraphItem =
  | { id: string; type: 'step'; content: Inline[] }
  | { id: string; type: 'bubble'; content: Inline[] }
  | { id: string; type: 'input'; prompt: Inline[]; saveAs: string; format: InputFormat; retry?: string }
  | { id: string; type: 'condition'; mode?: 'ai' | 'rules'; cases: GraphCase[] };
export interface GraphGroup { id: string; title: string; x: number; y: number; items: GraphItem[] }
export interface EdgeFrom { groupId: string; itemId?: string; port?: string }
export interface EdgeTo { groupId: string; itemId?: string }
export interface GraphEdge { id: string; from: EdgeFrom; to: EdgeTo; maxVisits?: number; fresh?: boolean }
export interface WorkflowGraph { start: string; groups: GraphGroup[]; edges: GraphEdge[]; variables?: string[] } // variables: the workflow's own {{names}}

export const MAX_GRAPH_STEPS = 50;
export const GROUP_WIDTH = 300;

export const newStepItem = (): GraphItem => ({ id: rid(), type: 'step', content: [] });
export const newConditionItem = (): GraphItem => ({ id: rid(), type: 'condition', cases: [{ id: rid(), kind: 'if', condition: [] }, { id: rid(), kind: 'else', condition: [] }] });
export const newRuleConditionItem = (): GraphItem => ({ id: rid(), type: 'condition', mode: 'rules', cases: [
  { id: rid(), kind: 'if', condition: [], rules: [{ var: '', op: '=', value: '' }], join: 'and' }, { id: rid(), kind: 'else', condition: [] }] });
export const newBubbleItem = (): GraphItem => ({ id: rid(), type: 'bubble', content: [] });
export const newInputItem = (format: InputFormat = 'text'): GraphItem => ({ id: rid(), type: 'input', prompt: [], saveAs: '', format });

// The block menu (palette and "+" on a card), grouped like Typebot's.
export const BLOCKS: { section: string; items: { key: string; label: string; make: () => GraphItem }[] }[] = [
  { section: 'Bubbles', items: [{ key: 'bubble', label: 'Text', make: newBubbleItem }] },
  { section: 'Inputs', items: INPUT_FORMATS.map((f) => ({ key: `input-${f.format}`, label: f.label, make: () => newInputItem(f.format) })) },
  { section: 'Logic', items: [{ key: 'rules', label: 'Condition', make: newRuleConditionItem }, { key: 'ai-condition', label: 'AI condition', make: newConditionItem }] },
  { section: 'AI', items: [{ key: 'step', label: 'AI step', make: newStepItem }] },
];

// React Flow handle ids on a group node: outputs are "then" (the group's end) or "<itemId>:<caseId>";
// inputs are "group" (the card's top) or a step's id.
export const sourceHandle = (f: EdgeFrom) => (f.itemId ? `${f.itemId}:${f.port}` : 'then');
export const targetHandle = (t: EdgeTo) => t.itemId ?? 'group';
export const fromHandle = (groupId: string, handle?: string | null): EdgeFrom => {
  if (!handle || handle === 'then') return { groupId };
  const [itemId, port] = handle.split(':');
  return { groupId, itemId, port };
};
export const toHandle = (groupId: string, handle?: string | null): EdgeTo => (!handle || handle === 'group' ? { groupId } : { groupId, itemId: handle });
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
export const insertItem = (g: WorkflowGraph, groupId: string, item: GraphItem, index: number) =>
  mapGroup(g, groupId, (grp) => ({ ...grp, items: [...grp.items.slice(0, index), item, ...grp.items.slice(index)] }));

// Drag a step or condition to another place: same group (reorder), another group, or a new group (`to.at`).
// Its arrows move with it. A group left empty is removed, unless it's the start group.
export function moveItemTo(g: WorkflowGraph, itemId: string, to: { groupId: string; index: number } | { at: { x: number; y: number } }): WorkflowGraph {
  const src = g.groups.find((grp) => grp.items.some((it) => it.id === itemId));
  if (!src) return g;
  const from = src.items.findIndex((it) => it.id === itemId);
  const item = src.items[from];
  let next = mapGroup(g, src.id, (grp) => ({ ...grp, items: grp.items.filter((it) => it.id !== itemId) }));
  let groupId: string, index: number;
  if ('at' in to) {
    groupId = rid();
    index = 0;
    next = { ...next, groups: [...next.groups, { id: groupId, title: 'Group', x: Math.round(to.at.x), y: Math.round(to.at.y), items: [] }] };
  } else {
    groupId = to.groupId;
    index = to.groupId === src.id && to.index > from ? to.index - 1 : to.index;
  }
  next = insertItem(next, groupId, item, index);
  next = { ...next, edges: next.edges.map((e) => ({
    ...e,
    from: e.from.itemId === itemId ? { ...e.from, groupId } : e.from,
    to: e.to.itemId === itemId ? { ...e.to, groupId } : e.to,
  })) };
  return src.id !== g.start && src.id !== groupId && !src.items.some((it) => it.id !== itemId) ? removeGroup(next, src.id) : next;
}

// Copy/paste: the chosen groups and the arrows between them, with fresh ids so the copy is independent.
export interface Clip { groups: GraphGroup[]; edges: GraphEdge[] }
export const copyGroups = (g: WorkflowGraph, ids: string[]): Clip => ({
  groups: g.groups.filter((grp) => ids.includes(grp.id)),
  edges: g.edges.filter((e) => ids.includes(e.from.groupId) && ids.includes(e.to.groupId)),
});
export function pasteGroups(g: WorkflowGraph, clip: Clip, offset = 48): { graph: WorkflowGraph; ids: string[] } {
  const map = new Map<string, string>();
  const id = (old: string) => map.get(old) ?? (map.set(old, rid()), map.get(old)!);
  const groups = clip.groups.map((grp) => ({
    ...grp, id: id(grp.id), x: grp.x + offset, y: grp.y + offset,
    items: grp.items.map((it): GraphItem => (it.type === 'condition'
      ? { ...it, id: id(it.id), cases: it.cases.map((c) => ({ ...c, id: id(c.id) })) }
      : { ...it, id: id(it.id) })),
  }));
  const edges = clip.edges.map((e) => ({
    ...e, id: rid(),
    from: { groupId: id(e.from.groupId), ...(e.from.itemId ? { itemId: id(e.from.itemId), port: id(e.from.port!) } : {}) },
    to: { groupId: id(e.to.groupId), ...(e.to.itemId ? { itemId: id(e.to.itemId) } : {}) },
  }));
  return { graph: { ...g, groups: [...g.groups, ...groups], edges: [...g.edges, ...edges] }, ids: groups.map((x) => x.id) };
}

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
  mapItem(g, itemId, (it) => (it.type === 'step' || it.type === 'bubble' ? { ...it, content } : it));
export const setInput = (g: WorkflowGraph, itemId: string, patch: Partial<Extract<GraphItem, { type: 'input' }>>) =>
  mapItem(g, itemId, (it) => (it.type === 'input' ? { ...it, ...patch } : it));
export const setCase = (g: WorkflowGraph, itemId: string, caseId: string, patch: Partial<GraphCase>) =>
  mapItem(g, itemId, (it) => (it.type === 'condition' ? { ...it, cases: it.cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c)) } : it));
// Switching a condition between AI and rules keeps both kinds of text, so switching back loses nothing.
export const setConditionMode = (g: WorkflowGraph, itemId: string, mode: 'ai' | 'rules') =>
  mapItem(g, itemId, (it) => (it.type === 'condition' ? { ...it, mode, cases: it.cases.map((c) => (
    mode === 'rules' && c.kind !== 'else' && !c.rules?.length ? { ...c, rules: [{ var: '', op: '=' as RuleOp, value: '' }], join: c.join ?? 'and' } : c)) } : it));

// The workflow's own variables (what input blocks fill and rules compare).
export const VAR_NAME = /^[a-z][a-z0-9_]*$/;
export const toVarName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'v_$1');
export const addVariable = (g: WorkflowGraph, name: string) =>
  (!VAR_NAME.test(name) || g.variables?.includes(name) ? g : { ...g, variables: [...(g.variables ?? []), name] });
export const removeVariable = (g: WorkflowGraph, name: string) => ({ ...g, variables: (g.variables ?? []).filter((v) => v !== name) });
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
// Re-point an arrow (drag either end). Its repeat settings are kept; an arrow already on the new output is replaced.
export const reconnect = (g: WorkflowGraph, id: string, from: EdgeFrom, to: EdgeTo): WorkflowGraph => {
  const old = g.edges.find((e) => e.id === id);
  if (!old) return g;
  return { ...g, edges: [...g.edges.filter((e) => e.id !== id && !sameSource(e.from, from)), { ...old, from, to }] };
};
// Delete several groups and arrows as one edit (the start group stays).
export const removeMany = (g: WorkflowGraph, groupIds: string[], edgeIds: string[]): WorkflowGraph => {
  const drop = new Set(groupIds.filter((id) => id !== g.start));
  return { ...g, groups: g.groups.filter((grp) => !drop.has(grp.id)),
           edges: g.edges.filter((e) => !edgeIds.includes(e.id) && !drop.has(e.from.groupId) && !drop.has(e.to.groupId)) };
};
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

// Everything but conditions counts toward the step limit (same rule as the server).
export const graphStepCount = (g: WorkflowGraph) => g.groups.reduce((n, grp) => n + grp.items.filter((i) => i.type !== 'condition').length, 0);

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
  76 + grp.items.reduce((h, it) => h + (it.type === 'condition' ? 56 + it.cases.length * 48 : it.type === 'input' ? 88 : 64), 0);
