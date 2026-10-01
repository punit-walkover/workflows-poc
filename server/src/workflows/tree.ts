import { Inline, WorkflowNode, BranchNode } from '../types';

interface Slot { node: WorkflowNode; list: WorkflowNode[]; idx: number; parentBranch: string | null; pos: number }

// id → where the node sits (pos = document order), so the runner can find "next" without re-walking the tree.
export function indexTree(steps: WorkflowNode[]): Map<string, Slot> {
  const map = new Map<string, Slot>();
  const walk = (list: WorkflowNode[], parentBranch: string | null) =>
    list.forEach((node, idx) => {
      map.set(node.id, { node, list, idx, parentBranch, pos: map.size });
      if (node.type === 'branch') node.cases.forEach((c) => walk(c.steps, node.id));
    });
  walk(steps, null);
  return map;
}

// Next node after `id` finishes: sibling, else the node after the enclosing branch, else null (end).
export function nextAfter(map: Map<string, Slot>, id: string): string | null {
  const slot = map.get(id);
  if (!slot) return null;
  const sibling = slot.list[slot.idx + 1];
  if (sibling) return sibling.id;
  return slot.parentBranch ? nextAfter(map, slot.parentBranch) : null;
}

// Node ids from `from` to `to` in document order (what a Go to step re-runs).
export function between(map: Map<string, Slot>, from: string, to: string): string[] {
  const a = map.get(from)?.pos ?? 0;
  const b = map.get(to)?.pos ?? -1;
  return [...map.entries()].filter(([, s]) => s.pos >= a && s.pos <= b).map(([id]) => id);
}

const children = (n: WorkflowNode) => (n.type === 'branch' ? n.cases : []);

export function countSteps(steps: WorkflowNode[]): number {
  return steps.reduce((n, s) => n + (s.type === 'step' ? 1 : children(s).reduce((m, c) => m + countSteps(c.steps), 0)), 0);
}

export function mentions(steps: WorkflowNode[]): { actions: string[]; vars: string[] } {
  const actions = new Set<string>();
  const vars = new Set<string>();
  const scan = (content: Inline[]) => content.forEach((p) => (p.t === 'action' ? actions.add(p.key) : p.t === 'var' ? vars.add(p.key) : 0));
  const walk = (list: WorkflowNode[]) =>
    list.forEach((n) => (n.type === 'step' ? scan(n.content) : children(n).forEach((c) => (scan(c.condition), walk(c.steps)))));
  walk(steps);
  return { actions: [...actions], vars: [...vars] };
}

// Plain text for prompts: @actions become `key`, {{vars}} get their values.
export function renderInline(content: Inline[], vars: Record<string, string> = {}): string {
  return content
    .map((p) => (p.t === 'text' ? p.v : p.t === 'action' ? `\`${p.key}\`` : vars[p.key] ?? `{{${p.key}}}`))
    .join('')
    .trim();
}

export function stepActions(content: Inline[]): string[] {
  return content.filter((p): p is { t: 'action'; key: string } => p.t === 'action').map((p) => p.key);
}

export function isBranch(n: WorkflowNode): n is BranchNode {
  return n.type === 'branch';
}
