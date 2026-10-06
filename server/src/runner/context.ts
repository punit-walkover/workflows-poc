import { one, q } from '../db';
import { Transcript } from '../llm/decider';
import { RunRow, WorkflowGraph, WorkflowNode } from '../types';
import { flowOf } from './flow';

// Everything a step needs about a run, read fresh (steps must not rely on workflow-function memory).
export async function loadRun(runId: string) {
  const run = await one<RunRow>('select * from workflow_run where id = $1', [runId]);
  if (!run) throw new Error(`run ${runId} not found`);
  const version = await one<{ name: string; version: number; steps: WorkflowNode[]; graph: WorkflowGraph | null; workflow_id: string }>(
    'select name, version, steps, graph, workflow_id from workflow_version where id = $1', [run.workflow_version_id]);
  const conv = await one<{ customer_name: string; customer_email: string }>('select * from conversation where id = $1', [run.conversation_id]);
  const messages = await loadTranscript(run.conversation_id);
  const vars: Record<string, string> = { 'customer.name': conv!.customer_name, 'customer.email': conv!.customer_email, today: new Date().toISOString().slice(0, 10) };
  // The workflow's own variables (filled by input blocks) read like the built-in ones once they have a value.
  for (const k of version!.graph?.variables ?? []) if (run.facts.collected[k] !== undefined) vars[k] = String(run.facts.collected[k]);
  return { run, version: version!, flow: flowOf(version!), messages, vars };
}

export async function loadTranscript(conversationId: string): Promise<Transcript[]> {
  const rows = await q(`select m.role, m.text, m.created_at, coalesce(json_agg(json_build_object('id', a.id, 'file_name', a.file_name))
                          filter (where a.id is not null), '[]') as attachments
                        from message m left join attachment a on a.id = any(m.attachment_ids)
                        where m.conversation_id = $1 and m.role <> 'system' group by m.id order by m.created_at`, [conversationId]);
  return rows as Transcript[];
}

export async function saveRun(runId: string, run: Partial<RunRow> & { ended?: boolean; end_reason?: string }) {
  await q(`update workflow_run set status = $2, current_node_id = $3, facts = $4, waiting_for = $5, outbox = $6, paused_from = $7,
             updated_at = now(), ended_at = case when $8 then now() else ended_at end, end_reason = coalesce($9, end_reason)
           where id = $1`,
    [runId, run.status, run.current_node_id ?? null, JSON.stringify(run.facts), run.waiting_for ? JSON.stringify(run.waiting_for) : null,
     JSON.stringify(run.outbox ?? []), run.paused_from ? JSON.stringify(run.paused_from) : null, !!run.ended, run.end_reason ?? null]);
}
