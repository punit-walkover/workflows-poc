import { config } from '../config';
import { one, q } from '../db';
import { executeAction, getAction, validateArgs } from '../actions/execute';
import { chooseCase, compose, decideStep, StepDecision } from '../llm/decider';
import { ActionRow, Facts, GotoNode, OutboxItem, RunRow, Signal, StepNode } from '../types';
import { between, renderInline, stepActions } from '../workflows/tree';
import { checkAnswer, chooseByRules, RETRY, saveResponse } from './blocks';
import { AskNode, Flow, Jump, SayNode } from './flow';
import { loadRun, saveRun } from './context';
import { addEvent } from './events';

// Each exported function is one DBOS step: its result is checkpointed, so replay never repeats it.

export type Decision =
  | { kind: 'end' }
  | { kind: 'error'; nodeId: string; error: string }
  | { kind: 'case'; nodeId: string; caseId: string | null; reason: string }
  | { kind: 'goto'; nodeId: string }
  | { kind: 'say'; nodeId: string }
  | { kind: 'ask'; nodeId: string; answer: { value: string | number } | null; invalid: boolean }
  | { kind: 'step'; nodeId: string; d: StepDecision };

export type ActOutcome =
  | { status: 'done'; output: any }
  | { status: 'wait_approval'; taskId: string }
  | { status: 'escalated'; reason: string }
  | { status: 'invalid' | 'failed'; error: string };

export interface Next { next: 'continue' | 'wait' | 'end' | 'run'; deadline?: number }

const HOUR = 3600_000;
const TERMINAL = ['completed', 'escalated', 'expired', 'cancelled'];

// ① Ask GTWY what to do at the current node (branch → pick a case, step → a decision).
export async function decide(runId: string): Promise<Decision> {
  const ctx = await loadRun(runId);
  const nodeId = ctx.run.current_node_id;
  if (!nodeId) return { kind: 'end' };
  const node = ctx.flow.node(nodeId)!;
  if (node.type === 'goto') return { kind: 'goto', nodeId }; // no AI: a jump is deterministic
  if (node.type === 'say') return { kind: 'say', nodeId };   // text bubble: sent as written
  if (node.type === 'ask') {
    // Input block: once it has asked, the customer's next message is the answer.
    const asked = ctx.run.facts.asked?.[nodeId];
    const reply = asked && [...ctx.messages].reverse().find((m) => m.role === 'customer' && !!m.created_at && new Date(m.created_at).toISOString() > asked);
    if (!reply) return { kind: 'ask', nodeId, answer: null, invalid: false };
    // The topic check already found this reply isn't an answer ("hmm I don't know"): ask again instead of saving it.
    if (ctx.run.facts.notAnswer?.[nodeId]) {
      await addEvent(runId, nodeId, 'system', 'input_invalid', { [node.saveAs]: reply.text, reason: 'not an answer to the question' });
      return { kind: 'ask', nodeId, answer: null, invalid: true };
    }
    const v = checkAnswer(node.format, reply.text ?? '');
    await addEvent(runId, nodeId, 'system', v.ok ? 'input_received' : 'input_invalid', { [node.saveAs]: v.ok ? v.value : reply.text, format: node.format });
    return { kind: 'ask', nodeId, answer: v.ok ? { value: v.value } : null, invalid: !v.ok };
  }
  if (node.type === 'branch' && node.mode === 'rules') {
    const c = chooseByRules(node, { ...ctx.run.facts.collected, ...ctx.vars, ...ctx.run.facts.vars });
    await addEvent(runId, nodeId, 'system', 'case_chosen', c);
    return { kind: 'case', nodeId, caseId: c.case_id, reason: c.reason };
  }
  // A step repeated by Go to step gets a marker in the transcript: keep known answers and ask only for what is
  // missing (default), or start over ("Ask again"). Older runs stored a plain timestamp, which meant start over.
  const raw = ctx.run.facts.since?.[nodeId];
  const since = typeof raw === 'string' ? { at: raw, fresh: true } : raw;
  if (since) {
    const i = ctx.messages.findIndex((m) => !!m.created_at && new Date(m.created_at).toISOString() > since.at);
    const note = { role: 'note', attachments: [], text: since.fresh
      ? 'The workflow went back to this step here. Answers above this line do not count for this step: ask again.'
      : 'The workflow came back to this step here because something is still missing. Keep what the customer already gave; ask only for what the previous results say is missing.' };
    ctx.messages = i < 0 ? [...ctx.messages, note] : [...ctx.messages.slice(0, i), note, ...ctx.messages.slice(i)];
  }
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (node.type === 'branch') {
        const c = await chooseCase({ branch: node, vars: ctx.vars, facts: ctx.run.facts, messages: ctx.messages });
        await addEvent(runId, nodeId, 'ai', 'case_chosen', c);
        return { kind: 'case', nodeId, caseId: c.case_id, reason: c.reason };
      }
      const allowed = (await Promise.all(stepActions(node.content).map(getAction))).filter((a): a is ActionRow => !!a?.enabled);
      const d = await decideStep({ workflowName: ctx.version.name, step: node, vars: ctx.vars, allowed, facts: ctx.run.facts,
                                   messages: ctx.messages, retry: (ctx.run.facts.attempts['!' + nodeId] ?? 0) > 0 });
      await addEvent(runId, nodeId, 'ai', 'llm_decision', d);
      return { kind: 'step', nodeId, d };
    } catch (e: any) {
      lastError = e.message;
    }
  }
  await addEvent(runId, nodeId, 'system', 'error', { where: 'decide', error: lastError });
  return { kind: 'error', nodeId, error: lastError };
}

// Each Go to step jump starts a new visit, so a re-run action gets a fresh idempotency key.
const visitOf = (f: Facts) => 1 + Object.values(f.visits ?? {}).reduce((a, b) => a + b - 1, 0);

// ② Run the chosen action: validate, then execute, or open an approval task when the action needs one.
export async function act(runId: string, dec: Extract<Decision, { kind: 'step' }>): Promise<ActOutcome> {
  try {
    const ctx = await loadRun(runId);
    const node = ctx.flow.node(dec.nodeId) as StepNode;
    const key = dec.d.action?.key ?? '';
    if (!stepActions(node.content).includes(key)) return { status: 'invalid', error: `${key || 'action'} is not allowed in this step` };
    const action = await getAction(key);
    if (!action?.enabled) return { status: 'invalid', error: `${key} is disabled` };
    const v = validateArgs(action, dec.d.action?.args);
    if (!v.ok) return { status: 'invalid', error: v.error };
    // The step already ran its action (it came back to report the result): don't run it twice.
    const done = ctx.run.facts.outputs[dec.nodeId] as Record<string, unknown> | undefined;
    if (done && !('approval_task_id' in done)) return { status: 'done', output: done };
    await addEvent(runId, dec.nodeId, 'ai', 'action_called', { key, args: v.args });

    if (key === 'escalate_to_human') return { status: 'escalated', reason: String(v.args.reason ?? '') };
    if (key === 'request_approval') {
      const attachmentIds = (ctx.run.facts.collected.attachment_ids as string[] | undefined)
        ?? ctx.messages.flatMap((m) => m.attachments.map((a) => a.id));
      const taskId = await openTask(ctx.run, dec.nodeId, {
        kind: 'evidence', summary: String(v.args.summary), evidence: { attachment_ids: attachmentIds, facts: ctx.run.facts.outputs },
      });
      return { status: 'wait_approval', taskId };
    }

    if (action.requires_approval) {
      const amount = action.amount_field ? Number(v.args[action.amount_field]) : undefined;
      const subject = action.subject_field ? String(v.args[action.subject_field]) : '';
      const taskId = await openTask(ctx.run, dec.nodeId, {
        kind: 'action', summary: `${action.name}${amount !== undefined ? `: ${fmt(amount)}` : ''}${subject ? ` for ${subject}` : ''}`,
        action_key: key, action_args: v.args, amount_minor: amount, evidence: { reason: v.args.reason ?? dec.d.reason, facts: ctx.run.facts.outputs },
      });
      return { status: 'wait_approval', taskId };
    }
    const r = await executeAction(action, v.args, { runId, nodeId: dec.nodeId, mode: 'auto', visit: visitOf(ctx.run.facts) });
    await addEvent(runId, dec.nodeId, 'system', 'action_result', r);
    return r.ok ? { status: 'done', output: r.result } : { status: 'failed', error: r.error };
  } catch (e: any) {
    await addEvent(runId, dec.nodeId, 'system', 'error', { where: 'act', error: e.message });
    return { status: 'failed', error: e.message };
  }
}

// ③ Apply the decision to run state: facts, cursor, status. Returns what the loop does next.
export async function advance(runId: string, dec: Decision, out: ActOutcome | null): Promise<Next> {
  const { run, flow, vars, version } = await loadRun(runId);
  const r: RunRow = { ...run, outbox: [...run.outbox] };
  const now = Date.now();
  // Words the customer reads: a declared variable with no value yet shows as nothing, not as {{name}}.
  const shown = { ...Object.fromEntries((version.graph?.variables ?? []).map((k) => [k, ''])), ...vars };
  const finish = async (status: RunRow['status'], reason: string): Promise<Next> => {
    await saveRun(runId, { ...r, status, current_node_id: status === 'completed' ? null : r.current_node_id, waiting_for: null, ended: true, end_reason: reason });
    await addEvent(runId, null, 'system', status === 'completed' ? 'run_completed' : `run_${status}`, { reason });
    return { next: 'end' };
  };
  const go = async (from: string, jump: Jump): Promise<Next> => {
    const to = await follow(runId, r, flow, from, jump);
    if (to === LIMIT) { r.outbox.push('I am handing this to a teammate who will reply shortly.'); return finish('escalated', 'loop_limit'); }
    r.current_node_id = to;
    if (!to) return finish('completed', 'completed');
    await saveRun(runId, { ...r, status: 'running' });
    return { next: 'continue' };
  };
  const moveOn = (from: string) => go(from, flow.next(from));
  const fail = async (nodeId: string, error: string): Promise<Next> => {
    r.outbox.push("Sorry, I hit a problem on my side. A teammate will take a look and follow up.");
    await saveRun(runId, { ...r, status: 'failed', waiting_for: null });
    await addEvent(runId, nodeId, 'system', 'run_failed', { error });
    return { next: 'wait', deadline: now + HOUR };
  };

  if (dec.kind === 'end') return finish('completed', 'completed');
  if (dec.kind === 'error') return fail(dec.nodeId, dec.error);
  if (dec.kind === 'case') {
    r.facts.cases[dec.nodeId] = { case_id: dec.caseId, reason: dec.reason };
    return go(dec.nodeId, flow.afterCase(dec.nodeId, dec.caseId));
  }
  if (dec.kind === 'goto') {
    // Tree Go to step. Forward (skip ahead): nothing re-runs. Back (a loop): the target and what follows run fresh.
    const index = flow.tree!;
    const g = index.get(dec.nodeId)!.node as GotoNode;
    const forward = (index.get(g.target)?.pos ?? -1) > index.get(g.id)!.pos;
    const visit = rerun(r, g.id, g.max_visits, g.fresh, forward ? [] : between(index, g.target, g.id));
    if (visit === false) {
      r.outbox.push('I am handing this to a teammate who will reply shortly.');
      await addEvent(runId, g.id, 'system', 'goto_limit', { target: g.target, max_visits: g.max_visits });
      return finish('escalated', 'loop_limit');
    }
    r.current_node_id = g.target;
    await addEvent(runId, g.id, 'system', 'goto_jumped', { target: g.target, visit, max_visits: g.max_visits, direction: forward ? 'forward' : 'back' });
    await saveRun(runId, { ...r, status: 'running' });
    return { next: 'continue' };
  }
  if (dec.kind === 'say') {
    const text = renderInline((flow.node(dec.nodeId) as SayNode).content, shown);
    if (text) r.outbox.push({ text, verbatim: true, nodeId: dec.nodeId });
    return moveOn(dec.nodeId);
  }
  if (dec.kind === 'ask') {
    const node = flow.node(dec.nodeId) as AskNode;
    if (dec.answer) {
      (r.facts.vars ??= {})[node.saveAs] = dec.answer.value;
      (r.facts.varsBy ??= {})[dec.nodeId] = [node.saveAs];
      r.facts.outputs[dec.nodeId] = { [node.saveAs]: dec.answer.value };
      delete r.facts.asked?.[dec.nodeId]; // answer used: a later visit asks again
      return moveOn(dec.nodeId);
    }
    delete r.facts.notAnswer?.[dec.nodeId];
    r.facts.attempts[dec.nodeId] = (r.facts.attempts[dec.nodeId] ?? 0) + 1;
    if (r.facts.attempts[dec.nodeId] > 3) {
      r.outbox.push('I am handing this to a teammate who will reply shortly.');
      return finish('escalated', 'no valid answer after 3 tries');
    }
    // An empty prompt is fine: the text bubble before it usually asks the question.
    const text = dec.invalid ? node.retry?.trim() || RETRY[node.format] : renderInline(node.prompt, shown);
    if (text) r.outbox.push({ text, verbatim: true, nodeId: dec.nodeId });
    (r.facts.asked ??= {})[dec.nodeId] = new Date().toISOString();
    r.waiting_for = { type: 'customer', node_id: dec.nodeId, expects: [node.saveAs], remind_at: now + config.remindAfterSec * 1000,
                      expires_at: now + config.expireAfterSec * 1000, reminded: false };
    await saveRun(runId, { ...r, status: 'waiting_customer' });
    await addEvent(runId, dec.nodeId, 'system', 'waiting', { for: 'customer', expects: [node.saveAs] });
    return { next: 'wait', deadline: r.waiting_for.remind_at };
  }

  const { d, nodeId } = dec;
  Object.assign(r.facts.collected, d.collected ?? {});
  if (d.collected && Object.keys(d.collected).length) (r.facts.collectedBy ??= {})[nodeId] = Object.keys(d.collected);
  const say = (text?: string) => text?.trim() && r.outbox.push(text.trim());

  if (d.decision === 'complete') {
    // A step that mentions an action only completes once that action has run.
    const node = flow.node(nodeId) as StepNode;
    if (stepActions(node.content).length && !(nodeId in r.facts.outputs)) {
      r.facts.attempts['!' + nodeId] = (r.facts.attempts['!' + nodeId] ?? 0) + 1;
      await addEvent(runId, nodeId, 'system', 'invalid_action', { error: 'step completed without calling its action' });
      if (r.facts.attempts['!' + nodeId] > 2) return fail(nodeId, 'model would not call the step action');
      await saveRun(runId, { ...r, status: 'running' });
      return { next: 'continue' };
    }
    say(d.message);
    return moveOn(nodeId);
  }
  if (d.decision === 'escalate') { say(d.message || 'I am handing this to a teammate who will reply shortly.'); return finish('escalated', d.reason); }
  if (d.decision === 'ask_customer') {
    r.facts.attempts[nodeId] = (r.facts.attempts[nodeId] ?? 0) + 1;
    if (r.facts.attempts[nodeId] > 3) { say('I am handing this to a teammate who will reply shortly.'); return finish('escalated', 'asked 3 times without an answer'); }
    say(d.message);
    r.waiting_for = { type: 'customer', node_id: nodeId, expects: d.missing ?? [], remind_at: now + config.remindAfterSec * 1000,
                      expires_at: now + config.expireAfterSec * 1000, reminded: false };
    await saveRun(runId, { ...r, status: 'waiting_customer' });
    await addEvent(runId, nodeId, 'system', 'waiting', { for: 'customer', expects: d.missing });
    return { next: 'wait', deadline: r.waiting_for.remind_at };
  }

  // call_action
  if (!out) return fail(nodeId, 'no action outcome');
  if (out.status === 'done') {
    delete r.facts.toolError?.[nodeId];
    const first = !(nodeId in r.facts.outputs);
    r.facts.outputs[nodeId] = out.output;
    if (first) await keepResponse(runId, r, flow.node(nodeId) as StepNode, out.output);
    // Nothing said yet: run the step once more so the AI can tell the customer what the result means.
    if (first && !d.message?.trim()) { await saveRun(runId, { ...r, status: 'running' }); return { next: 'continue' }; }
    say(d.message);
    return moveOn(nodeId);
  }
  if (out.status === 'escalated') { say(d.message || 'I am handing this to a teammate who will reply shortly.'); return finish('escalated', out.reason); }
  if (out.status === 'failed') {
    // One retry with the error in the prompt (e.g. a wrong column name the AI guessed); a second failure fails the run.
    if (r.facts.toolError?.[nodeId]) return fail(nodeId, out.error);
    (r.facts.toolError ??= {})[nodeId] = out.error;
    await addEvent(runId, nodeId, 'system', 'tool_retry', { error: out.error });
    await saveRun(runId, { ...r, status: 'running' });
    return { next: 'continue' };
  }
  if (out.status === 'invalid') {
    r.facts.attempts['!' + nodeId] = (r.facts.attempts['!' + nodeId] ?? 0) + 1;
    await addEvent(runId, nodeId, 'system', 'invalid_action', { error: out.error });
    if (r.facts.attempts['!' + nodeId] > 2) return fail(nodeId, out.error);
    await saveRun(runId, { ...r, status: 'running' });
    return { next: 'continue' };
  }
  if (out.status !== 'wait_approval') return fail(nodeId, 'unexpected outcome');
  const task = await one<{ due_at: Date; kind: string }>('select due_at, kind from approval_task where id = $1', [out.taskId]);
  // A write waiting for approval hasn't happened yet, so don't let the model claim it has.
  say(task!.kind === 'action' ? "Thanks! I've sent this to our team for a quick approval and will update you as soon as it's done." : d.message);
  r.facts.outputs[nodeId] = { approval_task_id: out.taskId };
  r.waiting_for = { type: 'approval', node_id: nodeId, task_id: out.taskId, due_at: new Date(task!.due_at).getTime() };
  await saveRun(runId, { ...r, status: 'waiting_approval' });
  await addEvent(runId, nodeId, 'system', 'waiting', { for: 'approval', task_id: out.taskId });
  return { next: 'wait', deadline: r.waiting_for.due_at };
}

// ④ Send what this turn produced, in order: AI notes in a row merge into one reply; text bubbles go out as written.
export async function flush(runId: string): Promise<string | null> {
  const run = await one<RunRow>('select * from workflow_run where id = $1', [runId]);
  if (!run?.outbox.length) return null;
  const parts: { text: string; verbatim: boolean; nodeId?: string }[] = [];
  let notes: string[] = [];
  const merge = async () => {
    if (!notes.length) return;
    let text: string;
    try { text = await compose(notes); } catch { text = notes.join('\n\n'); }
    parts.push({ text, verbatim: false });
    notes = [];
  };
  for (const item of run.outbox as OutboxItem[]) {
    if (typeof item === 'string') notes.push(item);
    else { await merge(); parts.push({ text: item.text, verbatim: true, nodeId: item.nodeId }); }
  }
  await merge();
  let last: string | null = null;
  for (const p of parts) {
    const m = await one<{ id: string }>(`insert into message (conversation_id, role, text, run_id) values ($1, 'bot', $2, $3) returning id`,
      [run.conversation_id, p.text, runId]);
    await addEvent(runId, p.nodeId ?? run.current_node_id, p.verbatim ? 'system' : 'ai', 'message_sent', { text: p.text });
    last = m!.id;
  }
  await q(`update workflow_run set outbox = '[]'::jsonb where id = $1`, [runId]);
  return last;
}

// ⑤ Apply one signal (or a timer when recv timed out) through the run state machine.
export async function apply(runId: string, s: Signal | null): Promise<Next> {
  const { run, flow } = await loadRun(runId);
  const r: RunRow = { ...run, outbox: [...run.outbox] };
  const now = Date.now();
  const w = r.waiting_for;
  const waitAgain = (): Next => ({ next: 'wait', deadline: w?.type === 'customer' ? (w.reminded ? w.expires_at : w.remind_at) : w?.type === 'approval' ? w.due_at : now + HOUR });
  const end = async (status: RunRow['status'], reason: string, say?: string): Promise<Next> => {
    if (say) r.outbox.push(say);
    await q(`update approval_task set status = 'cancelled' where run_id = $1 and status = 'pending'`, [runId]);
    await saveRun(runId, { ...r, status, waiting_for: null, ended: true, end_reason: reason });
    await addEvent(runId, null, 'system', `run_${status}`, { reason });
    return { next: 'end' };
  };
  const resumeAt = async (nodeId: string | null): Promise<Next> => {
    r.current_node_id = nodeId;
    if (!nodeId) return end('completed', 'completed');
    await saveRun(runId, { ...r, status: 'running', waiting_for: null });
    return { next: 'run' };
  };
  if (TERMINAL.includes(r.status)) return { next: 'end' };

  if (!s) {
    if (w?.type === 'customer') {
      if (now >= w.expires_at) return end('expired', 'customer did not reply', "I haven't heard back, so I'm closing this for now. Just reply any time to pick it up again.");
      if (now >= w.remind_at && !w.reminded) {
        w.reminded = true;
        r.outbox.push(`Just checking in: I still need ${w.expects.length ? w.expects.join(' and ').replace(/_/g, ' ') : 'a reply from you'} to continue.`);
        await saveRun(runId, r);
        await addEvent(runId, w.node_id, 'system', 'reminder_sent', {});
      }
      return waitAgain();
    }
    if (w?.type === 'approval' && now >= w.due_at) {
      await q(`update approval_task set status = 'expired' where id = $1 and status = 'pending'`, [w.task_id]);
      return end('escalated', 'approval timed out', 'Our team needs a little more time on this. A teammate will follow up with you directly.');
    }
    return waitAgain();
  }

  await addEvent(runId, w?.node_id ?? r.current_node_id, s.type === 'customer_message' ? 'customer' : `user:${'by' in s ? s.by : ''}`, 'signal_applied', s);
  switch (s.type) {
    case 'customer_message':
      if (r.status === 'waiting_customer') return resumeAt(r.current_node_id);
      if (r.status === 'waiting_approval') {
        r.outbox.push('Thanks! Our team is still reviewing this. I will update you as soon as they decide.');
        await saveRun(runId, r);
      }
      return waitAgain();

    case 'approval_decision': {
      if (r.status !== 'waiting_approval' || w?.type !== 'approval' || w.task_id !== s.taskId) return waitAgain();
      const task = await one('select * from approval_task where id = $1', [s.taskId]);
      const nodeId = w.node_id;
      if (task.kind === 'action' && s.approved) {
        const action = (await getAction(task.action_key))!;
        const res = await executeAction(action, task.action_args, { runId, nodeId, mode: 'approved', taskId: task.id, visit: visitOf(r.facts) });
        await addEvent(runId, nodeId, 'system', 'action_result', res);
        if (!res.ok) {
          r.outbox.push('Sorry, I hit a problem on my side. A teammate will take a look and follow up.');
          await saveRun(runId, { ...r, status: 'failed', waiting_for: null });
          return { next: 'wait', deadline: now + HOUR };
        }
        r.facts.outputs[nodeId] = res.result;
        await keepResponse(runId, r, flow.node(nodeId) as StepNode, res.result);
      } else {
        r.facts.outputs[nodeId] = { approved: s.approved, reviewed_by: s.by, reviewer_note: s.note ?? '' };
      }
      const to = await follow(runId, r, flow, nodeId, flow.next(nodeId));
      if (to === LIMIT) return end('escalated', 'loop_limit', 'I am handing this to a teammate who will reply shortly.');
      return resumeAt(to);
    }

    case 'pause':
      r.paused_from = { status: r.status, waiting_for: r.waiting_for };
      await saveRun(runId, { ...r, status: 'paused', waiting_for: null });
      return { next: 'wait', deadline: now + HOUR };

    case 'resume': {
      if (r.status !== 'paused') return waitAgain();
      const from = r.paused_from ?? { status: 'running' as const, waiting_for: null };
      r.paused_from = null;
      if (from.status === 'waiting_customer' || from.status === 'waiting_approval') {
        await saveRun(runId, { ...r, status: from.status, waiting_for: from.waiting_for });
        const pw = from.waiting_for;
        return { next: 'wait', deadline: pw?.type === 'customer' ? pw.remind_at : pw?.type === 'approval' ? pw.due_at : now + HOUR };
      }
      return resumeAt(r.current_node_id);
    }

    case 'retry_step':
      if (r.status !== 'failed') return waitAgain();
      if (r.current_node_id) r.facts.attempts['!' + r.current_node_id] = 0;
      return resumeAt(r.current_node_id);

    case 'cancel':
      return end('cancelled', `cancelled by ${s.by}`);
  }
}

const LIMIT = Symbol('loop limit');

// Copy the step's mapped response fields into variables, and log what was saved (or missing).
async function keepResponse(runId: string, r: RunRow, step: StepNode | undefined, output: unknown) {
  if (!step?.save?.length) return;
  const { saved, missing } = saveResponse(r.facts, step.id, step.save, output);
  await addEvent(runId, step.id, 'system', 'response_saved', { saved, missing });
}

// Repeat bookkeeping for a jump back: count the visit and clear what re-runs (results kept as "previous").
// Returns the visit number, or false once a limited jump has been taken too often.
function rerun(r: RunRow, key: string, max: number | undefined, fresh: boolean | undefined, ids: string[]): number | false {
  r.facts.visits ??= {};
  const visit = (r.facts.visits[key] ?? 1) + 1;
  if (max && visit > max) return false;
  r.facts.visits[key] = visit; // also feeds visitOf, so a re-run tool call gets a fresh idempotency key
  r.facts.since ??= {};
  r.facts.previous ??= {};
  const at = new Date().toISOString();
  for (const id of ids) {
    if (id in r.facts.outputs) r.facts.previous[id] = r.facts.outputs[id];
    delete r.facts.outputs[id]; delete r.facts.cases[id]; delete r.facts.attempts[id]; delete r.facts.attempts['!' + id];
    delete r.facts.asked?.[id];
    r.facts.since[id] = { at, fresh: !!fresh };
    // "Ask again": the customer's earlier answers to these steps no longer count.
    if (fresh) for (const k of r.facts.collectedBy?.[id] ?? []) delete r.facts.collected[k];
    if (fresh) for (const k of r.facts.varsBy?.[id] ?? []) delete r.facts.vars?.[k];
  }
  return visit;
}

// Leave `from` along `jump`. Canvas runs keep a trail of finished items: an arrow back to one already on it is a loop.
async function follow(runId: string, r: RunRow, flow: Flow, from: string, jump: Jump): Promise<string | null | typeof LIMIT> {
  r.facts.attempts[from] = 0;
  r.facts.attempts['!' + from] = 0;
  if (flow.kind !== 'graph') return jump.to;
  const trail = [...(r.facts.trail ?? []), from];
  r.facts.trail = trail;
  if (!jump.to || !jump.edge) return jump.to;
  const back = trail.lastIndexOf(jump.to);
  if (back < 0) return jump.to;
  const e = jump.edge;
  const visit = rerun(r, e.id, e.maxVisits, e.fresh, trail.slice(back));
  if (visit === false) {
    await addEvent(runId, from, 'system', 'goto_limit', { target: jump.to, max_visits: e.maxVisits });
    return LIMIT;
  }
  r.facts.trail = trail.slice(0, back);
  await addEvent(runId, from, 'system', 'goto_jumped', { target: jump.to, visit, max_visits: e.maxVisits ?? null, direction: 'back' });
  return jump.to;
}

async function openTask(run: RunRow, nodeId: string, t: {
  kind: 'evidence' | 'action'; summary: string; evidence: object; action_key?: string; action_args?: object; amount_minor?: number;
}): Promise<string> {
  const due = new Date(Date.now() + config.approvalTimeoutSec * 1000);
  const existing = await one<{ id: string }>(`select id from approval_task where run_id = $1 and node_id = $2 and status = 'pending'`, [run.id, nodeId]);
  if (existing) return existing.id;
  const row = await one<{ id: string }>(`insert into approval_task (run_id, conversation_id, node_id, kind, action_key, action_args, amount_minor,
                                           summary, evidence, due_at)
                                         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [run.id, run.conversation_id, nodeId, t.kind, t.action_key ?? null, t.action_args ? JSON.stringify(t.action_args) : null,
     t.amount_minor ?? null, t.summary, JSON.stringify(t.evidence), due]);
  await addEvent(run.id, nodeId, 'system', 'approval_requested', { task_id: row!.id, kind: t.kind, summary: t.summary });
  return row!.id;
}

const fmt = (minor?: number) => (minor === undefined ? '' : `$${(minor / 100).toFixed(2)}`);
