import { ActionRow, BranchNode, Facts, StepNode } from '../types';
import { renderInline } from '../workflows/tree';
import { chat, parseJson } from './gtwy';

export interface Transcript { role: string; text: string; attachments: { id: string; file_name: string }[]; created_at?: string }

export interface StepDecision {
  decision: 'complete' | 'ask_customer' | 'call_action' | 'escalate';
  collected?: Record<string, unknown>;
  message?: string;
  missing?: string[];
  action?: { key: string; args: Record<string, unknown> };
  reason: string;
  tokens?: number | null;
  ms?: number;
}

export interface CaseDecision { case_id: string | null; reason: string; checks?: unknown; tokens?: number | null; ms?: number }

const transcript = (msgs: Transcript[]) =>
  msgs.slice(-20).map((m) => {
    if (m.role === 'note') return `(${m.text})`;
    const who = m.role === 'customer' ? 'Customer' : m.role === 'team' ? 'Teammate' : 'Assistant';
    const files = m.attachments.length ? ` [attached: ${m.attachments.map((a) => `${a.file_name} (attachment id ${a.id})`).join(', ')}]` : '';
    return `${who}: ${m.text || '(no text)'}${files}`;
  }).join('\n');

const STEP_SYSTEM = `You are the step engine of a customer-support workflow. You execute exactly ONE step and answer with ONE JSON object only.
Rules:
- Do only what the current step says. Never do later steps.
- The customer's name and email shown under "Customer" are already known (they are the sender). Use them instead of asking, unless the customer said the order is under different details. When one of several alternatives is asked for (e.g. "email or phone"), having one is enough: the known email counts as the email on the order, so never ask for a phone number or to confirm the email. Never ask for anything already in Known facts.
- If the step asks the customer for information or a file: if the conversation already contains it, answer "complete" and put it in "collected" (for files, put the attachment ids in collected.attachment_ids). Otherwise answer "ask_customer" with a short friendly "message" and list what is "missing".
- If the step says to use an action: answer "call_action" with "action": {"key": "...", "args": {...}} using only the allowed actions. Take args from known facts or the conversation; never invent values. Amounts are integers in cents taken from action results. If a required arg is unknown, answer "ask_customer" instead. If the step also says to tell the customer something, put it in "message".
- If the step tells you to explain, confirm or tell the customer something: answer "complete" with that "message".
- "message" is read by the customer: short, warm, plain text, real values only, no placeholders. Never mention steps, workflows, actions, what you already know about them (like their email) or that you are checking something internally.
- Answer "escalate" only if the customer demands a human or the step cannot be done.
- If the conversation has a line saying the workflow came back to this step, follow it: either keep what is known and ask only for what the previous results say is missing, or (if it says so) ask again from scratch. Never complete such a step with nothing new.
- "reason" is required: one short sentence explaining the decision from the facts.
JSON: {"decision":"complete|ask_customer|call_action|escalate","collected":{},"message":"","missing":[],"action":{"key":"","args":{}},"reason":"one short sentence"}`;

export async function decideStep(input: {
  workflowName: string; step: StepNode; vars: Record<string, string>; allowed: ActionRow[];
  facts: Facts; messages: Transcript[]; retry?: boolean;
}): Promise<StepDecision> {
  const allowed = input.allowed.length
    ? input.allowed.map((a) => `- ${a.key}: ${a.description} Args schema: ${JSON.stringify(a.input_schema)}`).join('\n')
    : 'none';
  const user = `Workflow: ${input.workflowName}
Current step (${input.step.id}): ${renderInline(input.step.content, input.vars)}
Allowed actions for this step:
${allowed}${input.step.id in input.facts.outputs
  ? `\nThis step's action already ran; its result is outputs.${input.step.id}. Do not call it again: answer "complete" with a "message" that tells the customer what the step says, using that result (empty message only if the step says nothing to tell).`
  : input.allowed.length ? `\nThis step is not done until you call ${input.allowed.map((a) => a.key).join(' / ')} with "call_action" (put anything to tell the customer in "message"), unless you must "ask_customer" for a missing arg.` : ''}
Customer: ${input.vars['customer.name']} <${input.vars['customer.email']}>
Known facts (action results are authoritative): ${JSON.stringify({ collected: input.facts.collected, ...(input.facts.vars ? { variables: input.facts.vars } : {}), outputs: input.facts.outputs, ...(input.facts.previous ? { previous_results: input.facts.previous } : {}) })}
Conversation (oldest first):
${transcript(input.messages)}${input.retry ? '\n Follow the rules exactly.' : ''}`;
  const r = await chat(STEP_SYSTEM, user, true);
  const d = parseJson<StepDecision>(r.content);
  if (!['complete', 'ask_customer', 'call_action', 'escalate'].includes(d.decision)) throw new Error(`bad decision: ${d.decision}`);
  return { ...d, reason: d.reason || '', tokens: r.tokens, ms: r.ms };
}

const CASE_SYSTEM = `You check workflow conditions. For EACH condition, decide if it is true given the known facts (action results are authoritative) and the latest customer messages.
Answer with ONE JSON object only: {"checks":[{"id":"<condition id>","true":true|false,"why":"short"}],"reason":"one short sentence citing the facts"}.`;

// The model judges each condition; code picks the first true one (else the Else case), so the pick can't contradict the reasoning.
export async function chooseCase(input: { branch: BranchNode; vars: Record<string, string>; facts: Facts; messages: Transcript[] }): Promise<CaseDecision> {
  const conds = input.branch.cases.filter((c) => c.kind !== 'else');
  const list = conds.map((c) => `- id ${c.id}: ${renderInline(c.condition, input.vars)}`).join('\n');
  const user = `Conditions:\n${list}\nKnown facts: ${JSON.stringify({ collected: input.facts.collected, outputs: input.facts.outputs, ...(input.facts.previous ? { previous_results: input.facts.previous } : {}) })}\nRecent conversation:\n${transcript(input.messages.slice(-6))}`;
  const r = await chat(CASE_SYSTEM, user, true);
  const d = parseJson<{ checks: { id: string; true: boolean; why?: string }[]; reason: string }>(r.content);
  const truth = new Map((d.checks ?? []).map((c) => [c.id, c.true === true]));
  const hit = conds.find((c) => truth.get(c.id)) ?? input.branch.cases.find((c) => c.kind === 'else') ?? null;
  return { case_id: hit?.id ?? null, reason: d.reason || "", checks: d.checks, tokens: r.tokens, ms: r.ms };
}

const ROUTE_SYSTEM = `You route a customer's message to a support workflow. Answer with ONE JSON object only:
{"workflow_id":"<id or null>","confidence":0.0,"wants_human":0.0,"question":"","reason":"one short sentence"}.
- workflow_id: the workflow whose "When to use" best matches what the customer wants, or null if none fits (greetings, general questions).
- confidence: 0 to 1, how sure you are that workflow_id is right.
- wants_human: 0 to 1, how clearly the customer asks to talk to a person.
- question: one short question to the customer that would tell the likely workflows apart, for when you are unsure.`;

export interface RouteGuess { workflow_id: string | null; confidence: number; wants_human: number; question: string; reason: string }

// The WorkflowRouter port. Jev answers the same question in the plan; this adapter uses GTWY.
export async function route(workflows: { id: string; name: string; when_to_use: string }[], messages: Transcript[]): Promise<RouteGuess> {
  if (!workflows.length) return { workflow_id: null, confidence: 0, wants_human: 0, question: '', reason: 'No published workflows' };
  const list = workflows.map((w) => `- id ${w.id}: ${w.name}. When to use: ${w.when_to_use}`).join('\n');
  const r = await chat(ROUTE_SYSTEM, `Workflows:\n${list}\nConversation:\n${transcript(messages.slice(-6))}`, true);
  const d = parseJson<RouteGuess>(r.content);
  const known = workflows.some((w) => w.id === d.workflow_id);
  return { workflow_id: known ? d.workflow_id : null, confidence: known ? Number(d.confidence) || 0 : 0,
           wants_human: Number(d.wants_human) || 0, question: d.question || '', reason: d.reason || '' };
}

// Confidence gate: turns a routing guess into what happens next.
export function gate(g: RouteGuess): 'human' | 'start' | 'clarify' | 'none' {
  if (g.wants_human >= 0.8) return 'human';
  if (g.workflow_id && g.confidence >= 0.7) return 'start';
  if (g.workflow_id && g.confidence >= 0.4 && g.question) return 'clarify';
  return 'none';
}

// Several notes from one turn become one natural reply.
export async function compose(notes: string[]): Promise<string> {
  if (notes.length === 1) return notes[0];
  const r = await chat(
    'Merge these notes into ONE short, friendly reply to the customer. Keep every fact, amount and date exactly. Plain text only, no greeting repeated, no sign-off name.',
    notes.map((n, i) => `${i + 1}. ${n}`).join('\n'),
    false,
  );
  return r.content.trim();
}

export async function freeReply(messages: Transcript[]): Promise<string> {
  const r = await chat(
    'You are a helpful customer support assistant. Answer briefly and warmly in plain text. If the customer needs something done for them, ask what happened and for the details needed to look it up.',
    `Conversation:\n${transcript(messages)}\nWrite the assistant's next reply.`,
    false,
  );
  return r.content.trim();
}
