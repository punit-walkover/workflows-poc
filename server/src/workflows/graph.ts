import { config } from '../config';
import { GraphEdge, GraphGroup, GraphItem, Inline, VARIABLES, WorkflowGraph, WorkflowNode } from '../types';
import { renderInline } from './tree';

const rid = () => Math.random().toString(36).slice(2, 10);
// A short group title from a condition: up to ~5 words.
const words = (c: Inline[]) => {
  const w = renderInline(c).replace(/`/g, '').split(/\s+/).filter(Boolean);
  return (w.slice(0, 5).join(' ') + (w.length > 5 ? '…' : '')) || 'Untitled';
};

// Tree workflow → canvas graph. Item ids are kept, so facts and run history still line up.
// A condition ends its group: each case's steps get their own group, and whatever follows the condition
// continues in a new group that every case joins. A Go to step becomes an edge to its target.
export function treeToGraph(steps: WorkflowNode[]): WorkflowGraph {
  const groups: GraphGroup[] = [];
  const edges: GraphEdge[] = [];
  const where = new Map<string, string>(); // item id -> group id
  const gotos: { from: GraphEdge['from']; target: string; max: number; fresh?: boolean }[] = [];
  const newGroup = (title: string) => { const g: GraphGroup = { id: rid(), title, x: 0, y: 0, items: [] }; groups.push(g); return g; };
  const link = (from: GraphEdge['from'], to: string) => edges.push({ id: rid(), from, to: { groupId: to } });

  // Builds `list` into `group`; returns the group the list ends in (null if it jumped away).
  const build = (list: WorkflowNode[], group: GraphGroup): GraphGroup | null => {
    let cur: GraphGroup = group;
    for (const n of list) {
      if (n.type === 'step') { cur.items.push({ id: n.id, type: 'step', content: n.content }); where.set(n.id, cur.id); continue; }
      if (n.type === 'goto') { gotos.push({ from: { groupId: cur.id }, target: n.target, max: n.max_visits, fresh: n.fresh }); return null; }
      cur.items.push({ id: n.id, type: 'condition', cases: n.cases.map((c) => ({ id: c.id, kind: c.kind, condition: c.condition })) });
      where.set(n.id, cur.id);
      const after = newGroup('Then');
      for (const c of n.cases) {
        const port = { groupId: cur.id, itemId: n.id, port: c.id };
        if (!c.steps.length) { link(port, after.id); continue; }
        const head = c.steps[0];
        if (head.type === 'goto') { gotos.push({ from: port, target: head.target, max: head.max_visits, fresh: head.fresh }); continue; }
        const g = newGroup(c.kind === 'else' ? 'Otherwise' : words(c.condition));
        link({ groupId: cur.id, itemId: n.id, port: c.id }, g.id);
        const end = build(c.steps, g);
        if (end) link({ groupId: end.id }, after.id);
      }
      if (!n.cases.some((c) => c.kind === 'else')) link({ groupId: cur.id }, after.id); // no case matched: fall through
      cur = after;
    }
    return cur;
  };
  const start = newGroup('Start');
  build(steps, start);
  for (const g of gotos) {
    const to = where.get(g.target);
    if (to) edges.push({ id: rid(), from: g.from, to: { groupId: to, itemId: g.target }, maxVisits: g.max, fresh: g.fresh });
  }
  // Empty groups (a "Then" with nothing after the condition) are passed through: arrows into one go
  // straight to where it leads, or end the run if it leads nowhere.
  let list = edges;
  for (const g of groups.filter((x) => !x.items.length && x.id !== start.id)) {
    const out = list.find((e) => e.from.groupId === g.id && !e.from.itemId);
    list = list.filter((e) => e !== out).flatMap((e) => (e.to.groupId !== g.id ? [e] : out ? [{ ...e, to: out.to }] : []));
  }
  return layout({ start: start.id, groups: groups.filter((g) => g.items.length || g.id === start.id), edges: list });
}

// Left-to-right layout by distance from the start group; used on conversion and by "Tidy up".
export function layout(g: WorkflowGraph): WorkflowGraph {
  const depth = new Map<string, number>([[g.start, 0]]);
  const queue = [g.start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of g.edges.filter((x) => x.from.groupId === id)) {
      if (!depth.has(e.to.groupId)) { depth.set(e.to.groupId, depth.get(id)! + 1); queue.push(e.to.groupId); }
    }
  }
  const tops = new Map<number, number>();
  const last = Math.max(0, ...depth.values()) + 1;
  const groups = g.groups.map((grp) => {
    const d = depth.get(grp.id) ?? last;
    const y = tops.get(d) ?? 0;
    tops.set(d, y + cardHeight(grp) + 48);
    return { ...grp, x: d * 400, y };
  });
  return { ...g, groups };
}

// Rough card height (header, steps, conditions, footer), so stacked cards don't overlap.
export const cardHeight = (grp: GraphGroup) =>
  76 + grp.items.reduce((h, it) => h + (it.type === 'step' ? 64 : 56 + it.cases.length * 48), 0);

const allItems = (g: WorkflowGraph) => g.groups.flatMap((grp) => grp.items);

export function graphMentions(g: WorkflowGraph) {
  const actions = new Set<string>();
  const vars = new Set<string>();
  const scan = (c: Inline[]) => c.forEach((p) => (p.t === 'action' ? actions.add(p.key) : p.t === 'var' ? vars.add(p.key) : 0));
  for (const it of allItems(g)) it.type === 'step' ? scan(it.content) : it.cases.forEach((c) => scan(c.condition));
  return { actions: [...actions], vars: [...vars] };
}

export const graphStepCount = (g: WorkflowGraph) => allItems(g).filter((i) => i.type === 'step').length;

// Groups that sit on a cycle, as strongly connected components (Tarjan). A loop needs a repeat limit somewhere.
export function cycles(g: WorkflowGraph): string[][] {
  let i = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const next = (id: string) => g.edges.filter((e) => e.from.groupId === id).map((e) => e.to.groupId);
  const visit = (v: string) => {
    idx.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of next(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || next(v).includes(v)) out.push(comp);
    }
  };
  g.groups.forEach((grp) => { if (!idx.has(grp.id)) visit(grp.id); });
  return out;
}

export function validateGraph(g: unknown, enabledActions: string[]) {
  const issues: string[] = [];
  const graph = g as WorkflowGraph;
  if (!graph?.groups?.length) return { issues: ['Add at least one group'], action_keys: [], step_count: 0 };
  const groups = new Map(graph.groups.map((x) => [x.id, x]));
  const items = new Map<string, { item: GraphItem; group: GraphGroup }>();
  const text = (c: Inline[]) => c.map((p) => (p.t === 'text' ? p.v : 'x')).join('').trim();
  for (const grp of graph.groups) {
    if (!grp.items.length) issues.push(`"${grp.title}": add at least one step`);
    for (const it of grp.items) {
      if (items.has(it.id)) issues.push(`"${grp.title}": duplicate item id`);
      items.set(it.id, { item: it, group: grp });
      if (it.type === 'step' && !text(it.content)) issues.push(`"${grp.title}": a step is empty`);
      if (it.type === 'condition') {
        if (it.cases[0]?.kind !== 'if') issues.push(`"${grp.title}": a condition must start with If`);
        it.cases.forEach((c, ci) => {
          if (c.kind === 'else' && ci !== it.cases.length - 1) issues.push(`"${grp.title}": Else must be last`);
          if (c.kind !== 'else' && !text(c.condition)) issues.push(`"${grp.title}": a condition is empty`);
        });
      }
    }
  }
  if (!groups.has(graph.start)) issues.push('The start group is missing');
  const sources = new Set<string>();
  for (const e of graph.edges) {
    const from = groups.get(e.from.groupId);
    if (!from || !groups.has(e.to.groupId)) { issues.push('An arrow points to a group that no longer exists'); continue; }
    if (e.to.itemId && items.get(e.to.itemId)?.group.id !== e.to.groupId) issues.push(`An arrow into "${groups.get(e.to.groupId)!.title}" points to a step that no longer exists`);
    if (e.from.itemId) {
      const c = items.get(e.from.itemId)?.item;
      if (c?.type !== 'condition' || !c.cases.some((x) => x.id === e.from.port)) issues.push(`"${from.title}": an arrow starts from a case that no longer exists`);
    }
    const key = `${e.from.groupId}:${e.from.itemId ?? ''}:${e.from.port ?? ''}`;
    if (sources.has(key)) issues.push(`"${from.title}": one output has two arrows`);
    sources.add(key);
    if (e.maxVisits !== undefined && (!Number.isInteger(e.maxVisits) || e.maxVisits < 1 || e.maxVisits > config.maxVisits))
      issues.push(`"${from.title}": repeat limit must be 1 to ${config.maxVisits}`);
  }
  // Every group must be reachable from the start.
  const seen = new Set<string>([graph.start]);
  const queue = [graph.start];
  while (queue.length) {
    const id = queue.shift();
    for (const e of graph.edges.filter((x) => x.from.groupId === id)) if (!seen.has(e.to.groupId)) { seen.add(e.to.groupId); queue.push(e.to.groupId); }
  }
  graph.groups.filter((x) => !seen.has(x.id)).forEach((x) => issues.push(`"${x.title}" can't be reached from the start`));
  // Every loop needs at least one arrow with a repeat limit.
  for (const comp of cycles(graph)) {
    const inside = graph.edges.filter((e) => comp.includes(e.from.groupId) && comp.includes(e.to.groupId));
    if (!inside.some((e) => e.maxVisits)) issues.push(`Loop through ${comp.map((id) => `"${groups.get(id)?.title}"`).join(', ')} needs a repeat limit on one of its arrows`);
  }
  const step_count = graphStepCount(graph);
  if (step_count > config.maxGraphSteps) issues.push(`Too many steps: ${step_count} of ${config.maxGraphSteps}`);
  const { actions, vars } = graphMentions(graph);
  actions.filter((k) => !enabledActions.includes(k)).forEach((k) => issues.push(`@${k} doesn't exist or is disabled`));
  vars.filter((k) => !VARIABLES.some((v) => v.key === k)).forEach((k) => issues.push(`Unknown variable {{${k}}}`));
  return { issues, action_keys: actions, step_count };
}
