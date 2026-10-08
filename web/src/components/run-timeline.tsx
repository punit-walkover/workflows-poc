'use client';

import {
  AlertTriangle, ArrowLeftRight, Check, ChevronRight, Clock, CornerUpLeft, GitBranch, MessageSquare, Save, ShieldCheck, Sparkles, User, Wrench, X,
} from 'lucide-react';
import { useState } from 'react';
import type { WorkflowGraph } from '@/lib/graph';
import { inlineText, type WorkflowNode } from '@/lib/tree';
import { StatusChip } from './ui';

export interface TimelineEvent { id: string; run_id: string; node_id: string | null; actor: string; type: string; data: any; at: string }
export interface TimelineMessage { id: string; text: string; attachments?: { id: string }[] }
export interface TimelineRun { id: string; status: string; workflow_name: string; version: number; steps: WorkflowNode[]; graph?: WorkflowGraph | null; end_reason: string | null; started_at?: string }

// GTWY's history page for the POC agent (e.g. https://gtwy.ai/org/<org>/agents/history/<agent>); the link is hidden when unset.
const GTWY_HISTORY = process.env.NEXT_PUBLIC_GTWY_HISTORY_URL;

const cut = (s: string, n = 32) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const value = (v: unknown) => cut(typeof v === 'object' ? JSON.stringify(v) : String(v), 40);

// Block id → readable label from the run's own version: "Start › 2 · Asks for order_id" (canvas) or "Step 3 · Use @x…" (list).
export function nodeLabels(run: Pick<TimelineRun, 'steps' | 'graph'>): Map<string, string> {
  const m = new Map<string, string>();
  if (run.graph) {
    for (const g of run.graph.groups) g.items.forEach((it, i) => {
      const what = it.type === 'step' || it.type === 'bubble' ? cut(inlineText(it.content))
        : it.type === 'input' ? `Asks for ${it.saveAs || '…'}` : it.mode === 'rules' ? 'Condition' : 'AI condition';
      m.set(it.id, `${g.title} › ${i + 1} · ${what}`);
    });
    return m;
  }
  let n = 0;
  const walk = (list: WorkflowNode[]) => list.forEach((node) => {
    if (node.type === 'step') m.set(node.id, `Step ${++n} · ${cut(inlineText(node.content))}`);
    else if (node.type === 'goto') m.set(node.id, `Go to (after step ${n})`);
    else { m.set(node.id, `Condition (after step ${n})`); node.cases.forEach((c) => walk(c.steps)); }
  });
  walk(run.steps ?? []);
  return m;
}

// ---- Simple view: one plain sentence per meaningful event; plumbing (signals, duplicate waits) is left out.
type Tone = 'ai' | 'bot' | 'customer' | 'tool' | 'ok' | 'bad' | 'wait' | 'muted';
const TONE: Record<Tone, string> = {
  ai: 'text-action', bot: 'text-ink-2', customer: 'text-ink', tool: 'text-warn', ok: 'text-ok', bad: 'text-bad', wait: 'text-ink-3', muted: 'text-ink-3',
};
type Line = { icon: typeof Check; tone: Tone; text: string } | null;

function sentence(e: TimelineEvent, all: TimelineEvent[], messages: Map<string, TimelineMessage>): Line {
  const d = e.data ?? {};
  switch (e.type) {
    case 'message_sent': return { icon: MessageSquare, tone: 'bot', text: `Bot: “${cut(String(d.text ?? ''), 90)}”` };
    case 'signal':
      if (d.type === 'customer_message') {
        // The signal only carries the message id; show what the customer actually wrote.
        const m = messages.get(d.messageId);
        const files = m?.attachments?.length ? ` · ${m.attachments.length} attachment${m.attachments.length > 1 ? 's' : ''}` : '';
        return { icon: User, tone: 'customer', text: m ? `Customer: “${cut(m.text || '(no text)', 90)}”${files}` : 'Customer replied' };
      }
      if (d.type === 'approval_decision') return { icon: ShieldCheck, tone: d.approved ? 'ok' : 'bad', text: `Team ${d.approved ? 'approved' : 'rejected'}${d.note ? `: “${d.note}”` : ''}` };
      if (d.type === 'cancel' && /topic/.test(d.by ?? '')) return null; // the switch marker says it
      return { icon: User, tone: 'muted', text: `${d.type}${d.by ? ` by ${d.by}` : ''}` };
    case 'waiting': {
      // "Waiting" right after the question it waits on adds nothing; keep it for approvals and silent waits.
      if (d.for === 'approval') return { icon: Clock, tone: 'wait', text: 'Waiting for the team to approve' };
      const asked = all.some((x) => x.type === 'message_sent' && x.node_id === e.node_id && Math.abs(+new Date(x.at) - +new Date(e.at)) < 5000);
      return asked ? null : { icon: Clock, tone: 'wait', text: `Waiting for the customer${d.expects?.length ? ` (${d.expects.join(', ')})` : ''}` };
    }
    case 'llm_decision':
      if (d.decision === 'call_action') return { icon: Sparkles, tone: 'ai', text: `AI chose to use @${d.action?.key}` };
      if (d.decision === 'ask_customer') return { icon: Sparkles, tone: 'ai', text: `AI asked the customer${d.missing?.length ? ` for ${d.missing.join(', ')}` : ''}` };
      if (d.decision === 'escalate') return { icon: Sparkles, tone: 'bad', text: 'AI handed the chat to a person' };
      return { icon: Sparkles, tone: 'ai', text: 'AI finished the step' };
    case 'action_called': return null; // the result line says it ran
    case 'action_result':
      return d.ok ? { icon: Wrench, tone: 'tool', text: `Tool ran successfully` } : { icon: Wrench, tone: 'bad', text: `Tool failed: ${cut(String(d.error ?? ''), 60)}` };
    case 'tool_retry': return { icon: Wrench, tone: 'bad', text: `Tool failed: ${cut(String(d.error ?? ''), 70)}. AI is retrying` };
    case 'approval_requested': return { icon: ShieldCheck, tone: 'wait', text: `Asked the team to approve: ${cut(String(d.summary ?? ''), 60)}` };
    case 'input_received': {
      const [k, v] = Object.entries(d).find(([key]) => key !== 'format') ?? [];
      return { icon: Save, tone: 'ok', text: k ? `Saved ${k} = ${value(v)}` : 'Answer saved' };
    }
    case 'input_invalid': return { icon: X, tone: 'bad', text: d.reason === 'not an answer to the question' ? "Reply wasn't an answer, asked again" : "Answer didn't fit, asked again" };
    case 'response_saved': {
      const saved = Object.entries(d.saved ?? {}).map(([k, v]) => `${k} = ${value(v)}`);
      const missing = (d.missing ?? []) as string[];
      return { icon: Save, tone: missing.length && !saved.length ? 'bad' : 'ok', text: [saved.length ? `Saved ${saved.join(', ')}` : '', missing.length ? `not in response: ${missing.join(', ')}` : ''].filter(Boolean).join(' · ') };
    }
    case 'case_chosen': return { icon: GitBranch, tone: 'ai', text: d.case_id ? `Condition matched: ${cut(String(d.reason ?? ''), 70)}` : 'No condition matched' };
    case 'topic_checked':
      if (d.kind === 'answer') return null;
      if (d.kind === 'neither') return { icon: Sparkles, tone: 'muted', text: "Reply didn't answer the question" };
      return null; // a switch shows as the marker between runs
    case 'goto_jumped': return { icon: CornerUpLeft, tone: 'ai', text: `Went back (try ${d.visit} of ${d.max_visits ?? '∞'})` };
    case 'goto_limit': return { icon: AlertTriangle, tone: 'bad', text: 'Repeat limit reached, handed to a person' };
    case 'reminder_sent': return { icon: Clock, tone: 'wait', text: 'Sent a reminder' };
    case 'invalid_action': return { icon: AlertTriangle, tone: 'bad', text: `AI made an invalid tool call, retrying` };
    case 'error': return { icon: AlertTriangle, tone: 'bad', text: `Error: ${cut(String(d.error ?? ''), 70)}` };
    case 'run_completed': return { icon: Check, tone: 'ok', text: 'Workflow finished' };
    case 'run_escalated': return { icon: AlertTriangle, tone: 'bad', text: `Handed to a person${d.reason ? `: ${cut(d.reason, 60)}` : ''}` };
    case 'run_expired': return { icon: Clock, tone: 'muted', text: 'Closed: the customer stopped replying' };
    case 'run_failed': return { icon: AlertTriangle, tone: 'bad', text: `Run failed${d.error ? `: ${cut(d.error, 60)}` : ''}` };
    case 'run_cancelled': return /topic/.test(d.reason ?? '') ? null : { icon: X, tone: 'muted', text: 'Run cancelled' };
    case 'run_started': case 'signal_applied': return null; // the run header covers the start
    default: return null;
  }
}

// The runner logs the end of a run just before sending its last replies; in the simple view the end comes last.
const ENDS = new Set(['run_completed', 'run_escalated', 'run_expired', 'run_failed', 'run_cancelled']);
const simpleOrder = (list: TimelineEvent[]) => [...list.filter((e) => !ENDS.has(e.type)), ...list.filter((e) => ENDS.has(e.type))];

// The whole conversation's timeline: a header per run (oldest first) and a marker where a topic switch moved the chat
// to another workflow. Older runs start collapsed so the current one stays in focus.
// Plain sentences only; click a line for its raw event, or use the DBOS checkpoints for the engine-level view.
export function RunTimeline({ runs, events, messages = [] }: { runs: TimelineRun[]; events: TimelineEvent[]; messages?: TimelineMessage[] }) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const ordered = [...runs].reverse(); // the API sends newest first
  const current = runs[0]?.id;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const labels = new Map(ordered.map((r) => [r.id, nodeLabels(r)]));
  const shown = events.filter((e) => e.type !== 'signal_applied');

  const row = (e: TimelineEvent, line: NonNullable<Line>) => (
    <button key={e.id} type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="block w-full rounded-md px-1.5 py-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-action/40">
      <span className="flex items-start gap-2 text-xs">
        <line.icon size={13} className={`mt-px shrink-0 ${TONE[line.tone]}`} />
        <span className={`min-w-0 flex-1 ${line.tone === 'bot' ? 'text-ink-2' : line.tone === 'muted' ? 'text-ink-3' : 'text-ink'}`}>{line.text}</span>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-3">{clock(e.at)}</span>
      </span>
      {open === e.id && <pre className="mt-1 overflow-auto rounded bg-canvas p-2 text-[11px] text-ink-2">{JSON.stringify(e.data, null, 2)}</pre>}
      {open === e.id && e.data?.gtwy && GTWY_HISTORY && (
        <a href={`${GTWY_HISTORY}?thread_id=${encodeURIComponent(e.data.gtwy.thread_id)}&subThread_id=${encodeURIComponent(e.data.gtwy.sub_thread_id)}`}
           target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="mt-1 inline-block text-[11px] text-link hover:underline">Open this call in GTWY ↗</a>
      )}
    </button>
  );

  return (
    <div>
      {ordered.map((r, i) => {
        const own = shown.filter((e) => e.run_id === r.id);
        const isOpen = r.id === current || expanded.has(r.id);
        const next = ordered[i + 1];
        const topic = [...own].reverse().find((e) => e.type === 'topic_checked' && e.data?.kind === 'new_request');
        const switched = next && topic && /topic switch/.test(r.end_reason ?? '');
        const runLabels = labels.get(r.id)!;
        // Simple view: consecutive events of the same block form one step box; run-level lines (e.g. the customer's reply)
        // join the step they belong to, and the run's ending gets its own line after the boxes.
        const steps: { node: string | null; items: { e: TimelineEvent; line: NonNullable<Line> }[] }[] = [];
        const tail: { e: TimelineEvent; line: NonNullable<Line> }[] = [];
        for (const e of simpleOrder(own)) {
          const line = sentence(e, own, byId);
          if (!line) continue;
          if (ENDS.has(e.type)) { tail.push({ e, line }); continue; }
          const last = steps[steps.length - 1];
          if (last && (!e.node_id || e.node_id === last.node)) last.items.push({ e, line });
          else steps.push({ node: e.node_id, items: [{ e, line }] });
        }
        return (
          <div key={r.id} className="mb-1">
            {ordered.length > 1 && (
              <button type="button" onClick={() => r.id !== current && setExpanded((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}
                      className={`mb-1 flex w-full items-center gap-1.5 rounded-md bg-canvas px-2 py-1.5 text-left text-xs ${r.id === current ? 'cursor-default' : 'hover:bg-hover'}`}>
                {r.id !== current && <ChevronRight size={12} className={`shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                <span className="min-w-0 truncate font-semibold text-ink">{r.workflow_name}</span>
                <span className="ml-auto shrink-0"><StatusChip status={r.status} /></span>
              </button>
            )}
            {isOpen && (
              // A vertical rail with a dot per step: reads as "what happened, in order", unlike the Steps cards above.
              <div className="relative ml-1.5 space-y-2 border-l-2 border-line pl-3.5 pt-0.5">
                {steps.map((st) => {
                  const label = st.node ? runLabels.get(st.node) : undefined;
                  return (
                    <div key={st.items[0].e.id} className="relative">
                      <span className="absolute -left-[21px] top-2 size-2.5 rounded-full border-2 border-panel bg-ink-3" />
                      <div className="rounded-md bg-canvas px-1 pb-0.5 pt-1">
                        {label && <div className="truncate px-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3" title={st.node ?? ''}>{label}</div>}
                        {st.items.map(({ e, line }) => row(e, line))}
                      </div>
                    </div>
                  );
                })}
                {tail.map(({ e, line }) => (
                  <div key={e.id} className="relative">
                    <span className={`absolute -left-[21px] top-2 size-2.5 rounded-full border-2 border-panel ${line.tone === 'ok' ? 'bg-ok' : line.tone === 'bad' ? 'bg-bad' : 'bg-ink-3'}`} />
                    {row(e, line)}
                  </div>
                ))}
              </div>
            )}
            {switched && (
              <div className="my-1.5 flex items-start gap-1.5 rounded-md border border-action/30 bg-action-soft px-2 py-1.5 text-xs text-action">
                <ArrowLeftRight size={13} className="mt-0.5 shrink-0" />
                <span>Customer changed topic → switched to <b>{next.workflow_name}</b>{topic?.data?.reason ? `. ${topic.data.reason}` : ''}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
