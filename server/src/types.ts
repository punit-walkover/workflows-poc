// Workflow tree as stored in workflow.steps / workflow_version.steps.
export type Inline = { t: 'text'; v: string } | { t: 'action'; key: string } | { t: 'var'; key: string };

export interface StepNode { id: string; type: 'step'; content: Inline[] }
export interface BranchCase { id: string; kind: 'if' | 'else_if' | 'else'; condition: Inline[]; steps: WorkflowNode[]; rules?: Rule[]; join?: 'and' | 'or' }
// mode 'rules': cases are checked in code against variables (no AI); otherwise the AI judges each case.
export interface BranchNode { id: string; type: 'branch'; cases: BranchCase[]; mode?: 'ai' | 'rules' }
// Jump back to an earlier node; the target may run at most max_visits times.
// fresh = "Ask again": the target restarts as if new; otherwise known answers are kept and only what's missing is asked.
export interface GotoNode { id: string; type: 'goto'; target: string; max_visits: number; fresh?: boolean }
export type WorkflowNode = StepNode | BranchNode | GotoNode;

// A rule compares a variable with a value, without AI.
export const RULE_OPS = ['=', '!=', 'contains', '>', '<', 'empty', 'not_empty'] as const;
export interface Rule { var: string; op: (typeof RULE_OPS)[number]; value: string }
export const INPUT_FORMATS = ['text', 'email', 'number', 'phone'] as const;
export type InputFormat = (typeof INPUT_FORMATS)[number];

// Canvas form (workflow.graph): groups of items joined by edges. Item ids are unique across the graph.
// step = AI instruction · bubble = fixed message · input = ask and save the reply in a variable · condition = branch.
export interface GraphCase { id: string; kind: 'if' | 'else_if' | 'else'; condition: Inline[]; rules?: Rule[]; join?: 'and' | 'or' }
export type GraphItem =
  | { id: string; type: 'step'; content: Inline[] }
  | { id: string; type: 'bubble'; content: Inline[] }
  | { id: string; type: 'input'; prompt: Inline[]; saveAs: string; format: InputFormat; retry?: string }
  | { id: string; type: 'condition'; mode?: 'ai' | 'rules'; cases: GraphCase[] };
export interface GraphGroup { id: string; title: string; x: number; y: number; items: GraphItem[] }
// from: a group's end (no itemId) or a condition case (itemId + port = case id). to: a group, or a step inside one.
export interface GraphEdge {
  id: string;
  from: { groupId: string; itemId?: string; port?: string };
  to: { groupId: string; itemId?: string };
  maxVisits?: number; // required on edges that close a loop
  fresh?: boolean;    // "ask again" when looping back
}
export interface WorkflowGraph { start: string; groups: GraphGroup[]; edges: GraphEdge[]; variables?: string[] } // variables: the workflow's own {{names}}

export interface ActionRow {
  key: string;
  name: string;
  description: string;
  kind: 'read' | 'write';
  builtin: boolean;
  input_schema: { type: 'object'; properties: Record<string, { type: string }>; required?: string[] };
  subject_field: string | null;
  amount_field: string | null;
  requires_approval: boolean;
  enabled: boolean;
  source: 'builtin' | 'mock' | 'viasocket' | 'viasocket_flow';
  via_service_id: string | null;
  via_app_name: string | null;
  via_action_version_id: string | null;
  via_action_name: string | null;
  input_template: Record<string, unknown> | null;
  via_flow_id: string | null;
  via_flow_url: string | null;
  details_edited: boolean;
}

export type RunStatus =
  | 'running' | 'waiting_customer' | 'waiting_approval' | 'paused' | 'failed'
  | 'completed' | 'escalated' | 'expired' | 'cancelled';

export const ACTIVE: RunStatus[] = ['running', 'waiting_customer', 'waiting_approval', 'paused', 'failed'];

export interface Facts {
  collected: Record<string, unknown>;
  outputs: Record<string, unknown>;
  cases: Record<string, { case_id: string | null; reason: string }>;
  attempts: Record<string, number>;
  visits: Record<string, number>; // goto id -> visit number of its target
  since?: Record<string, string | { at: string; fresh: boolean }>; // node id -> when a Go to step jumped back over it
  previous?: Record<string, unknown>; // node id -> its result before the last jump back
  collectedBy?: Record<string, string[]>; // node id -> collected keys it filled
  asked?: Record<string, string>; // input block id -> when it last asked (its answer is the next customer message)
  trail?: string[]; // canvas runs: item ids in the order they finished (finds what a loop back re-runs)
}

export type WaitingFor =
  | { type: 'customer'; node_id: string; expects: string[]; remind_at: number; expires_at: number; reminded: boolean }
  | { type: 'approval'; node_id: string; task_id: string; due_at: number };

// What a turn sends: AI notes are merged into one reply; a text bubble goes out word for word as its own message.
export type OutboxItem = string | { text: string; verbatim: true; nodeId?: string };

export interface RunRow {
  id: string;
  conversation_id: string;
  workflow_version_id: string;
  status: RunStatus;
  current_node_id: string | null;
  facts: Facts;
  waiting_for: WaitingFor | null;
  outbox: OutboxItem[];
  paused_from: { status: RunStatus; waiting_for: WaitingFor | null } | null;
}

// Every intervention reaches a run as one of these (via DBOS.send on topic 'signal').
export type Signal =
  | { type: 'customer_message'; messageId: string }
  | { type: 'approval_decision'; taskId: string; approved: boolean; by: string; note?: string }
  | { type: 'pause' | 'resume' | 'cancel' | 'retry_step'; by: string };

export const VARIABLES = [
  { key: 'customer.name', label: 'Customer name' },
  { key: 'customer.email', label: 'Customer email' },
  { key: 'today', label: "Today's date" },
];
