import { BadRequestException, Logger } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { one, q } from '../db';
import { freeReply, gate, route } from '../llm/decider';
import { ACTIVE, RunStatus, Signal, WorkflowGraph, WorkflowNode } from '../types';
import { flowOf } from './flow';
import { loadTranscript } from './context';
import { addEvent } from './events';
import { runWorkflow } from './workflow';

const log = new Logger('RunControl');

// Which interventions each status accepts; anything else is rejected, never silently applied.
const ALLOWED: Record<RunStatus, Signal['type'][]> = {
  running: ['customer_message', 'pause', 'cancel'],
  waiting_customer: ['customer_message', 'pause', 'cancel'],
  waiting_approval: ['customer_message', 'approval_decision', 'pause', 'cancel'],
  paused: ['customer_message', 'resume', 'cancel'],
  failed: ['customer_message', 'retry_step', 'cancel'],
  completed: [], escalated: [], expired: [], cancelled: [],
};

// The one entry point for interventions: check, log, then deliver durably to the run.
export async function signal(runId: string, s: Signal, idempotencyKey: string) {
  const run = await one<{ status: RunStatus }>('select status from workflow_run where id = $1', [runId]);
  if (!run) throw new BadRequestException('run not found');
  if (!ALLOWED[run.status].includes(s.type)) throw new BadRequestException(`"${s.type}" is not allowed while the run is ${run.status}`);
  await addEvent(runId, null, s.type === 'customer_message' ? 'customer' : `user:${'by' in s ? s.by : ''}`, 'signal', s);
  await DBOS.send(`run:${runId}`, s, 'signal', idempotencyKey);
}

// New customer message: resume the active run, or pick a workflow, or answer freely.
export async function onCustomerMessage(conversationId: string, messageId: string) {
  const active = await one<{ id: string }>(`select id from workflow_run where conversation_id = $1 and status = any($2)`, [conversationId, ACTIVE]);
  if (active) return signal(active.id, { type: 'customer_message', messageId }, `msg:${messageId}`);

  const last = await one<{ status: string }>('select status from workflow_run where conversation_id = $1 order by started_at desc limit 1', [conversationId]);
  if (last?.status === 'escalated') {
    await q(`insert into message (conversation_id, role, text) values ($1, 'system', 'Escalated to a human: the bot stays quiet on this conversation.')`, [conversationId]);
    return;
  }

  const messages = await loadTranscript(conversationId);
  const workflows = await q<{ id: string; name: string; when_to_use: string; version_id: string }>(
    `select w.id, w.name, w.when_to_use, w.published_version_id as version_id from workflow w
     where w.enabled and w.archived_at is null and w.published_version_id is not null`);
  const pick = await route(workflows, messages);
  const outcome = gate(pick);
  await q(`insert into message (conversation_id, role, text) values ($1, 'system', $2)`,
    [conversationId, `Routing: ${outcome} (confidence ${pick.confidence.toFixed(2)}). ${pick.reason}`]);
  const bot = (text: string) => q(`insert into message (conversation_id, role, text) values ($1, 'bot', $2)`, [conversationId, text]);
  if (outcome === 'human') return void (await bot('Sure, I am passing you to a teammate. They will reply here shortly.'));
  if (outcome === 'clarify') return void (await bot(pick.question));
  if (outcome === 'none') return void (await bot(await freeReply(messages)));
  const wf = workflows.find((w) => w.id === pick.workflow_id)!;
  await startRun(conversationId, wf.version_id, `${pick.reason} (confidence ${pick.confidence.toFixed(2)})`);
}

export async function startRun(conversationId: string, versionId: string, reason: string) {
  const v = await one<{ steps: WorkflowNode[]; graph: WorkflowGraph | null; name: string; version: number }>('select steps, graph, name, version from workflow_version where id = $1', [versionId]);
  const conv = await one<{ customer_name: string; customer_email: string }>('select * from conversation where id = $1', [conversationId]);
  // The sender's identity is known up front, so steps never ask for it.
  const facts = { collected: { customer_name: conv!.customer_name, email: conv!.customer_email }, outputs: {}, cases: {}, attempts: {}, visits: {} };
  let run: { id: string } | null;
  try {
    run = await one(`insert into workflow_run (conversation_id, workflow_version_id, current_node_id, facts) values ($1, $2, $3, $4) returning id`,
      [conversationId, versionId, flowOf(v!).first(), JSON.stringify(facts)]);
  } catch (e: any) {
    if (e.code === '23505') return log.warn('run already active for conversation'); // unique active-run index
    throw e;
  }
  await addEvent(run!.id, null, 'system', 'run_started', { workflow: v!.name, version: v!.version, reason });
  await DBOS.startWorkflow(runWorkflow, { workflowID: `run:${run!.id}` })(run!.id);
  return run!.id;
}
