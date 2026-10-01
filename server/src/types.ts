// Workflow tree as stored in workflow.steps / workflow_version.steps.
export type Inline = { t: 'text'; v: string } | { t: 'action'; key: string } | { t: 'var'; key: string };

export interface StepNode { id: string; type: 'step'; content: Inline[] }
export interface BranchCase { id: string; kind: 'if' | 'else_if' | 'else'; condition: Inline[]; steps: WorkflowNode[] }
export interface BranchNode { id: string; type: 'branch'; cases: BranchCase[] }
// Jump back to an earlier node; the target may run at most max_visits times.
export interface GotoNode { id: string; type: 'goto'; target: string; max_visits: number }
export type WorkflowNode = StepNode | BranchNode | GotoNode;

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
  since?: Record<string, string>; // node id -> when a Go to step jumped back over it
  collectedBy?: Record<string, string[]>; // node id -> collected keys it filled
}

export type WaitingFor =
  | { type: 'customer'; node_id: string; expects: string[]; remind_at: number; expires_at: number; reminded: boolean }
  | { type: 'approval'; node_id: string; task_id: string; due_at: number };

export interface RunRow {
  id: string;
  conversation_id: string;
  workflow_version_id: string;
  status: RunStatus;
  current_node_id: string | null;
  facts: Facts;
  waiting_for: WaitingFor | null;
  outbox: string[];
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
