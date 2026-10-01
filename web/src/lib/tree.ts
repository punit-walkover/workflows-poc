// Workflow tree shape (same as the server's) and immutable edit helpers for the editor.
export type Inline = { t: 'text'; v: string } | { t: 'action'; key: string } | { t: 'var'; key: string };
export interface StepNode { id: string; type: 'step'; content: Inline[] }
export interface BranchCase { id: string; kind: 'if' | 'else_if' | 'else'; condition: Inline[]; steps: WorkflowNode[] }
export interface BranchNode { id: string; type: 'branch'; cases: BranchCase[] }
export interface GotoNode { id: string; type: 'goto'; target: string; max_visits: number }
export type WorkflowNode = StepNode | BranchNode | GotoNode;

export const MAX_STEPS = 15;
export const MAX_DEPTH = 2;

export const rid = () => Math.random().toString(36).slice(2, 10);
export const newStep = (content: Inline[] = []): StepNode => ({ id: rid(), type: 'step', content });

// Apply `fn` to every node list (top level and inside every case).
function mapLists(list: WorkflowNode[], fn: (l: WorkflowNode[]) => WorkflowNode[]): WorkflowNode[] {
  return fn(list).map((n) => (n.type === 'branch' ? { ...n, cases: n.cases.map((c) => ({ ...c, steps: mapLists(c.steps, fn) })) } : n));
}

const mapCases = (list: WorkflowNode[], fn: (c: BranchCase, b: BranchNode) => BranchCase | null): WorkflowNode[] =>
  mapLists(list, (l) => l.map((n) => (n.type === 'branch' ? { ...n, cases: n.cases.map((c) => fn(c, n)).filter((c): c is BranchCase => !!c) } : n)));

export const setStep = (s: WorkflowNode[], id: string, content: Inline[]) =>
  mapLists(s, (l) => l.map((n) => (n.id === id && n.type === 'step' ? { ...n, content } : n)));

export const insertAfter = (s: WorkflowNode[], id: string, node: WorkflowNode) =>
  mapLists(s, (l) => { const i = l.findIndex((n) => n.id === id); return i < 0 ? l : [...l.slice(0, i + 1), node, ...l.slice(i + 1)]; });

export const removeNode = (s: WorkflowNode[], id: string) => mapLists(s, (l) => l.filter((n) => n.id !== id));

export const moveNode = (s: WorkflowNode[], id: string, dir: -1 | 1) =>
  mapLists(s, (l) => {
    const i = l.findIndex((n) => n.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const copy = [...l];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

// "Condition" from the @ menu: the step's text becomes the If condition.
export const toBranch = (s: WorkflowNode[], id: string) =>
  mapLists(s, (l) => l.map((n) => (n.id === id && n.type === 'step'
    ? { id: rid(), type: 'branch', cases: [{ id: rid(), kind: 'if', condition: n.content, steps: [newStep()] }] }
    : n)));

export const addCase = (s: WorkflowNode[], branchId: string, kind: 'else_if' | 'else') =>
  mapLists(s, (l) => l.map((n) => {
    if (n.id !== branchId || n.type !== 'branch') return n;
    const c: BranchCase = { id: rid(), kind, condition: [], steps: [newStep()] };
    const elseIdx = n.cases.findIndex((x) => x.kind === 'else');
    if (kind === 'else') return elseIdx >= 0 ? n : { ...n, cases: [...n.cases, c] };
    return elseIdx >= 0 ? { ...n, cases: [...n.cases.slice(0, elseIdx), c, ...n.cases.slice(elseIdx)] } : { ...n, cases: [...n.cases, c] };
  }));

export const setCondition = (s: WorkflowNode[], caseId: string, condition: Inline[]) =>
  mapCases(s, (c) => (c.id === caseId ? { ...c, condition } : c));

// Removing the If removes the whole condition block; other cases just drop out.
export const removeCase = (s: WorkflowNode[], caseId: string) => {
  let branchToDrop: string | null = null;
  const out = mapCases(s, (c, b) => {
    if (c.id !== caseId) return c;
    if (c.kind === 'if') branchToDrop = b.id;
    return null;
  });
  return branchToDrop ? removeNode(out, branchToDrop) : out;
};

export function countSteps(s: WorkflowNode[]): number {
  return s.reduce((n, x) => n + (x.type === 'step' ? 1 : x.type === 'branch' ? x.cases.reduce((m, c) => m + countSteps(c.steps), 0) : 0), 0);
}

export const inlineText = (c: Inline[]) => c.map((p) => (p.t === 'text' ? p.v : p.t === 'action' ? `@${p.key}` : `{{${p.key}}}`)).join('');

// A new If block with one empty step (the "Add condition" button).
export const newBranch = (): BranchNode => ({ id: rid(), type: 'branch', cases: [{ id: rid(), kind: 'if', condition: [], steps: [newStep()] }] });

export const appendToCase = (s: WorkflowNode[], caseId: string, node: WorkflowNode) =>
  mapCases(s, (c) => (c.id === caseId ? { ...c, steps: [...c.steps, node] } : c));

// "Go to step": jump back to an earlier step, at most max_visits times.
export const newGoto = (): GotoNode => ({ id: rid(), type: 'goto', target: '', max_visits: 2 });

export const setGoto = (s: WorkflowNode[], id: string, patch: Partial<Pick<GotoNode, 'target' | 'max_visits'>>) =>
  mapLists(s, (l) => l.map((n) => (n.id === id && n.type === 'goto' ? { ...n, ...patch } : n)));

// Steps a Go to may jump to: earlier steps in its own list and on the path above it, labelled like the editor ("3.1 › 2").
export function gotoTargets(steps: WorkflowNode[], gotoId: string): { id: string; label: string; text: string }[] {
  let found: { id: string; label: string; text: string }[] | null = null;
  const walk = (list: WorkflowNode[], prefix: string, earlier: { id: string; label: string; text: string }[]) => {
    const seen = [...earlier];
    list.forEach((n, i) => {
      if (found) return;
      const label = `${prefix}${i + 1}`;
      if (n.id === gotoId) { found = seen; return; }
      if (n.type === 'branch') n.cases.forEach((c, ci) => walk(c.steps, `${label}.${ci + 1} › `, seen));
      if (n.type === 'step') seen.push({ id: n.id, label, text: inlineText(n.content) });
    });
  };
  walk(steps, '', []);
  return found ?? [];
}
