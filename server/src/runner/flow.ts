import { BranchNode, GotoNode, GraphEdge, StepNode, WorkflowGraph, WorkflowNode } from '../types';
import { indexTree, nextAfter } from '../workflows/tree';

// What the runner needs from a workflow version, whether it is a tree (list editor) or a graph (canvas).
export type FlowNode = StepNode | BranchNode | GotoNode;
export interface Jump { to: string | null; edge?: GraphEdge }
export interface Flow {
  kind: 'tree' | 'graph';
  first(): string | null;
  node(id: string): FlowNode | undefined;
  next(id: string): Jump;                           // after a step (or a condition with no case taken)
  afterCase(id: string, caseId: string | null): Jump;
  tree?: ReturnType<typeof indexTree>;             // tree only: Go to step needs document order
}

export function treeFlow(steps: WorkflowNode[]): Flow {
  const index = indexTree(steps);
  return {
    kind: 'tree', tree: index,
    first: () => steps[0]?.id ?? null,
    node: (id) => index.get(id)?.node as FlowNode | undefined,
    next: (id) => ({ to: nextAfter(index, id) }),
    afterCase: (id, caseId) => {
      const b = index.get(id)!.node as BranchNode;
      return { to: b.cases.find((c) => c.id === caseId)?.steps[0]?.id ?? nextAfter(index, id) };
    },
  };
}

export function graphFlow(g: WorkflowGraph): Flow {
  const at = new Map<string, { groupId: string; idx: number }>();
  g.groups.forEach((grp) => grp.items.forEach((it, idx) => at.set(it.id, { groupId: grp.id, idx })));
  const groups = new Map(g.groups.map((grp) => [grp.id, grp]));
  const target = (e: GraphEdge): Jump => ({ to: e.to.itemId ?? groups.get(e.to.groupId)?.items[0]?.id ?? null, edge: e });
  const next = (id: string): Jump => {
    const { groupId, idx } = at.get(id)!;
    const following = groups.get(groupId)!.items[idx + 1];
    if (following) return { to: following.id };
    const out = g.edges.find((e) => e.from.groupId === groupId && !e.from.itemId);
    return out ? target(out) : { to: null };
  };
  return {
    kind: 'graph',
    first: () => groups.get(g.start)?.items[0]?.id ?? null,
    node: (id) => {
      const p = at.get(id);
      const it = p && groups.get(p.groupId)!.items[p.idx];
      if (!it) return undefined;
      // A condition item runs exactly like a branch whose cases lead out through edges.
      return it.type === 'step' ? { id, type: 'step', content: it.content } : { id, type: 'branch', cases: it.cases.map((c) => ({ ...c, steps: [] })) };
    },
    next,
    afterCase: (id, caseId) => {
      const e = g.edges.find((x) => x.from.itemId === id && x.from.port === caseId);
      return e ? target(e) : next(id); // an unconnected case falls through to what follows the condition
    },
  };
}

export const flowOf = (v: { steps: WorkflowNode[]; graph: WorkflowGraph | null }) => (v.graph ? graphFlow(v.graph) : treeFlow(v.steps));
