'use client';

import { useState } from 'react';
import { Check, Circle, CircleDot, Clock, CornerUpLeft, Database, Loader2, Minus } from 'lucide-react';
import { api, API, money } from '@/lib/api';
import { inlineText, type WorkflowNode } from '@/lib/tree';
import { reachableFrom, type WorkflowGraph } from '@/lib/graph';
import { Button, StatusChip } from './ui';
import { InlineText } from './inline-text';
import { ActionRun, ToolCalls } from './tool-call';

export interface RunView {
  id: string; status: string; current_node_id: string | null; workflow_name: string; version: number; steps: WorkflowNode[]; graph?: WorkflowGraph | null;
  facts: { cases: Record<string, { case_id: string | null; reason: string }>; outputs: Record<string, any>; collected: Record<string, any>; vars?: Record<string, any>; visits?: Record<string, number> };
  waiting_for: any; end_reason: string | null;
}
export interface EventRow { id: string; node_id: string | null; actor: string; type: string; data: any; at: string }
export interface Task { id: string; run_id: string; status: string; kind: string; summary: string; amount_minor: number | null; evidence: any; decided_by: string | null; decision_note: string | null; created_at: string; decided_at: string | null }

const ACTIVE = ['running', 'waiting_customer', 'waiting_approval', 'paused', 'failed'];

export function RunPanel({ run, events, approvals, actionRuns = [], onChanged }: { run?: RunView; events: EventRow[]; approvals: Task[]; actionRuns?: ActionRun[]; onChanged: () => void }) {
  const [dbos, setDbos] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  if (!run) {
    return (
      <div className="p-5 text-ink-2">
        <div className="mb-1 font-medium text-ink">No workflow running</div>
        The bot answers freely until a message matches a published workflow&apos;s <i>When to use</i>.
      </div>
    );
  }
  const control = async (op: string) => {
    setError('');
    try { await api(`/runs/${run.id}/${op}`, { method: 'POST', body: { by: 'You (teammate)' } }); onChanged(); } catch (e: any) { setError(e.message); }
  };
  const visited = new Set(events.map((e) => e.node_id).filter(Boolean));
  // Tool calls per step, oldest first (a loop's repeat is a later visit).
  const calls = new Map<string, ActionRun[]>();
  for (const c of [...actionRuns].sort((a, b) => a.visit - b.visit || a.started_at.localeCompare(b.started_at)))
    if (c.node_id) calls.set(c.node_id, [...(calls.get(c.node_id) ?? []), c]);
  const active = ACTIVE.includes(run.status);
  const pending = approvals.filter((t) => t.status === 'pending' && t.run_id === run.id);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">{run.workflow_name} <span className="text-ink-3">v{run.version}</span></div>
          <StatusChip status={run.status} />
        </div>
        <WaitingLine run={run} />
        {run.end_reason && !active && <div className="mt-1 text-xs text-ink-3">Ended: {run.end_reason}</div>}
        {active && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {run.status !== 'paused' && <Button onClick={() => control('pause')}>Pause</Button>}
            {run.status === 'paused' && <Button onClick={() => control('resume')}>Resume</Button>}
            {run.status === 'failed' && <Button onClick={() => control('retry')}>Retry step</Button>}
            <Button variant="danger" onClick={() => control('cancel')}>Cancel</Button>
          </div>
        )}
        {error && <div className="mt-2 text-xs text-bad">{error}</div>}
      </div>

      {pending.map((t) => <ApprovalCard key={t.id} task={t} onDone={onChanged} />)}

      <section>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Steps</div>
        {run.graph ? <GraphRun graph={run.graph} run={run} visited={visited} calls={calls} /> : <RunTree list={run.steps} run={run} visited={visited} calls={calls} skipped={false} />}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Timeline</span>
          <button className="flex items-center gap-1 text-xs text-ink-2 hover:text-ink"
                  onClick={async () => setDbos(dbos ? null : await api(`/runs/${run.id}/dbos-steps`))}>
            <Database size={12} /> {dbos ? 'Hide' : 'Show'} DBOS checkpoints
          </button>
        </div>
        {dbos && (
          <div className="mb-3 rounded-lg border border-line bg-canvas p-2 font-mono text-[11px]">
            {dbos.map((s) => (
              <div key={s.function_id} className="flex gap-2">
                <span className="w-6 text-right text-ink-3">{s.function_id}</span>
                <span className="w-16">{s.name}</span>
                <span className="truncate text-ink-2">{s.error ? `error: ${s.error}` : JSON.stringify(s.output)}</span>
              </div>
            ))}
          </div>
        )}
        <Timeline events={events} />
      </section>
    </div>
  );
}

function WaitingLine({ run }: { run: RunView }) {
  const w = run.waiting_for;
  if (!w) return null;
  const at = (ms: number) => new Date(ms).toLocaleTimeString();
  if (w.type === 'customer')
    return <div className="mt-1 flex items-center gap-1 text-xs text-warn"><Clock size={12} /> Waiting on customer{w.expects?.length ? `: ${w.expects.join(', ')}` : ''} · {w.reminded ? `expires ${at(w.expires_at)}` : `reminder ${at(w.remind_at)}`}</div>;
  return <div className="mt-1 flex items-center gap-1 text-xs text-bad"><Clock size={12} /> Waiting for approval · due {at(w.due_at)}</div>;
}

type Calls = Map<string, ActionRun[]>;

function RunTree({ list, run, visited, calls, skipped, depth = 0 }: { list: WorkflowNode[]; run: RunView; visited: Set<unknown>; calls: Calls; skipped: boolean; depth?: number }) {
  return (
    <div className={depth ? 'ml-4 border-l border-line pl-3' : ''}>
      {list.map((n, i) => {
        const current = run.current_node_id === n.id && ACTIVE.includes(run.status);
        const done = visited.has(n.id) && !current;
        // The node the run is on gets a yellow box; others keep the same padding so nothing shifts.
        const box = current ? 'rounded-md border border-warn bg-warn-soft/60 px-1.5 shadow-sm' : 'border border-transparent px-1.5';
        const icon = skipped ? <Minus size={13} className="text-ink-3" />
          : current ? (run.status === 'running' ? <Loader2 size={13} className="animate-spin text-action" /> : <Clock size={13} className="text-warn" />)
          : done ? <Check size={13} className="text-ok" /> : <Circle size={13} className="text-line" />;
        if (n.type === 'goto') {
          const target = findNode(run.steps, n.target);
          const visit = run.facts.visits?.[n.id];
          return (
            <div key={n.id} className={`flex items-center gap-2 py-1 text-ink-2 ${box} ${skipped ? 'opacity-40' : ''}`}>
              <span className="shrink-0">{done ? <Check size={13} className="text-ok" /> : <CornerUpLeft size={13} className="text-action" />}</span>
              <span className="w-4 shrink-0 text-ink-3">{i + 1}.</span>
              <span className="truncate">Go to “{target?.type === 'step' ? inlineText(target.content).slice(0, 40) : n.target}”</span>
              <span className="ml-auto shrink-0 text-xs text-ink-3">{visit ? `visit ${visit} of ${n.max_visits}` : `max ${n.max_visits}`}</span>
            </div>
          );
        }
        if (n.type === 'step') {
          return (
            <div key={n.id} className={`my-0.5 flex gap-2 py-1 ${box} ${skipped ? 'opacity-40' : ''} ${current ? 'font-medium' : ''}`}>
              <span className="mt-1 shrink-0">{icon}</span>
              <span className="w-4 shrink-0 text-ink-3">{i + 1}.</span>
              <span className="min-w-0 leading-snug"><InlineText content={n.content} />
                {done && <ToolCalls calls={calls.get(n.id) ?? []} output={run.facts.outputs?.[n.id]} />}</span>
            </div>
          );
        }
        const chosen = run.facts.cases?.[n.id];
        return (
          <div key={n.id} className={`my-0.5 py-1 ${box}`}>
            {n.cases.map((c) => {
              const isChosen = chosen?.case_id === c.id;
              const off = skipped || (!!chosen && !isChosen);
              return (
                <div key={c.id} className="mb-1">
                  <div className={`flex items-start gap-2 ${off ? 'opacity-40' : ''}`}>
                    <span className="mt-1 shrink-0">{isChosen ? <Check size={13} className="text-ok" /> : <CircleDot size={13} className="text-brand" />}</span>
                    <span className="rounded bg-brand-soft px-1.5 text-xs font-medium text-brand">{{ if: 'If', else_if: 'Else if', else: 'Else' }[c.kind]}</span>
                    <span className="text-ink-2">{c.kind === 'else' ? 'otherwise' : <InlineText content={c.condition} />}</span>
                  </div>
                  {isChosen && <div className="ml-6 text-xs italic text-ok">{chosen.reason}</div>}
                  <RunTree list={c.steps} run={run} visited={visited} calls={calls} skipped={off} depth={depth + 1} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Canvas runs: groups in reading order (start first), the step the run is on in a yellow box.
function GraphRun({ graph, run, visited, calls }: { graph: WorkflowGraph; run: RunView; visited: Set<unknown>; calls: Calls }) {
  const groups = [...graph.groups].sort((a, b) => (a.id === graph.start ? -1 : b.id === graph.start ? 1 : a.x - b.x || a.y - b.y));
  const live = ACTIVE.includes(run.status);
  // Skipped: never ran and the run can't get there any more (after it ends, that's everything that never ran).
  const ahead = reachableFrom(graph, live ? run.current_node_id : null);
  const skipped = (id: string) => !visited.has(id) && !ahead.has(id);
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const off = g.items.length > 0 && g.items.every((it) => skipped(it.id));
        return (
        <div key={g.id} className={`rounded-lg border border-line px-2 py-1.5 ${off ? 'border-dashed bg-canvas/40 opacity-60' : ''}`}>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
            <span className={off ? 'line-through' : ''}>{g.title}</span>
            {off && <span className="rounded bg-hover px-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">Skipped</span>}
          </div>
          {g.items.map((it) => {
            const current = live && run.current_node_id === it.id;
            const done = visited.has(it.id) && !current;
            const skip = skipped(it.id);
            const icon = current ? (run.status === 'running' ? <Loader2 size={13} className="animate-spin text-action" /> : <Clock size={13} className="text-warn" />)
              : done ? <Check size={13} className="text-ok" /> : skip ? <Minus size={13} className="text-ink-3" /> : <Circle size={13} className="text-line" />;
            const chosen = it.type === 'condition' ? it.cases.find((c) => c.id === run.facts.cases?.[it.id]?.case_id) : undefined;
            return (
              <div key={it.id} className={`my-0.5 flex gap-2 rounded-md border px-1.5 py-1 ${current ? 'border-warn bg-warn-soft/60 font-medium shadow-sm' : 'border-transparent'}`}>
                <span className="mt-0.5 shrink-0">{icon}</span>
                <span className={`min-w-0 leading-snug ${skip ? 'text-ink-3 line-through decoration-ink-3/60' : ''}`}>
                  {it.type === 'step' ? <><InlineText content={it.content} />
                      {done && it.save?.map((m) => {
                        const v = run.facts.vars?.[m.var];
                        return <span key={m.var} className="block text-xs">
                          <span className="font-mono text-var">{m.var}</span>{v === undefined ? <span className="text-warn"> ({m.path}: not in response)</span> : <span className="text-ok"> = {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>}
                        </span>;
                      })}
                      {(done || current) && <ToolCalls calls={calls.get(it.id) ?? []} output={run.facts.outputs?.[it.id]} />}</>
                    : it.type === 'bubble' ? <span className="text-ink-2">Says: “<InlineText content={it.content} />”</span>
                    : it.type === 'input' ? <>Asks for <span className="font-mono text-var">{it.saveAs || '…'}</span>
                        {(run.facts.vars?.[it.saveAs] ?? run.facts.collected?.[it.saveAs]) !== undefined && done && <span className="text-ok"> = {String(run.facts.vars?.[it.saveAs] ?? run.facts.collected[it.saveAs])}</span>}</>
                    : <>Condition{chosen && <span className="text-ok"> → {chosen.kind === 'else' ? 'otherwise'
                        : it.mode === 'rules' ? (chosen.rules ?? []).map((r) => `${r.var} ${r.op} ${r.value}`.trim()).join(chosen.join === 'or' ? ' or ' : ' and ')
                        : <InlineText content={chosen.condition} />}</span>}</>}
                </span>
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}

function findNode(list: WorkflowNode[], id: string): WorkflowNode | null {
  for (const n of list) {
    if (n.id === id) return n;
    if (n.type === 'branch') for (const c of n.cases) { const f = findNode(c.steps, id); if (f) return f; }
  }
  return null;
}

const LABEL: Record<string, string> = {
  run_started: 'Run started', llm_decision: 'Model decided', case_chosen: 'Branch chosen', action_called: 'Action called',
  action_result: 'Action result', input_received: 'Answer saved', response_saved: 'Response saved', input_invalid: 'Answer did not fit', goto_jumped: 'Jumped', goto_limit: 'Repeat limit hit', approval_requested: 'Approval requested', waiting: 'Waiting',
  message_sent: 'Message sent', signal: 'Signal received', signal_applied: 'Signal applied', reminder_sent: 'Reminder sent',
  run_completed: 'Run completed', run_escalated: 'Escalated', run_failed: 'Failed', run_expired: 'Expired', run_cancelled: 'Cancelled',
  error: 'Error', invalid_action: 'Invalid action',
};

function summary(e: EventRow): string {
  const d = e.data ?? {};
  switch (e.type) {
    case 'run_started': return `${d.workflow} v${d.version} — ${d.reason}`;
    case 'llm_decision': return `${d.decision}${d.action?.key ? ` ${d.action.key}` : ''} — ${d.reason || ''}`;
    case 'case_chosen': return `${d.case_id} — ${d.reason}`;
    case 'action_called': return `${d.key}(${JSON.stringify(d.args)})`;
    case 'action_result': return d.ok ? JSON.stringify(d.result).slice(0, 140) : `failed: ${d.error}`;
    case 'goto_jumped': return `${d.direction === 'forward' ? 'ahead' : 'back'} to ${d.target} · visit ${d.visit} of ${d.max_visits}`;
    case 'goto_limit': return `${d.target} already ran ${d.max_visits}× · handed to a person`;
    case 'approval_requested': return d.summary;
    case 'waiting': return d.for === 'customer' ? `customer: ${(d.expects ?? []).join(', ')}` : 'approval';
    case 'message_sent': return d.text;
    case 'signal': case 'signal_applied': return `${d.type}${d.approved !== undefined ? (d.approved ? ' ✓ approved' : ' ✗ rejected') : ''}${d.note ? ` — "${d.note}"` : ''}`;
    default: return d.reason || d.error || '';
  }
}

function Timeline({ events }: { events: EventRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      {events.filter((e) => e.type !== 'signal_applied').map((e) => (
        <button key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} className="block w-full rounded-md px-2 py-1 text-left hover:bg-hover">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="w-14 shrink-0 text-ink-3">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="font-medium">{LABEL[e.type] ?? e.type}</span>
            {e.node_id && <span className="text-ink-3">{e.node_id}</span>}
            <span className="ml-auto shrink-0 text-ink-3">{e.actor}</span>
          </div>
          <div className="ml-16 line-clamp-2 text-xs text-ink-2">{summary(e)}</div>
          {open === e.id && <pre className="ml-16 mt-1 overflow-auto rounded bg-canvas p-2 text-[11px]">{JSON.stringify(e.data, null, 2)}</pre>}
        </button>
      ))}
    </div>
  );
}

export function ApprovalCard({ task, onDone, showContext }: { task: Task & { customer_name?: string; workflow_name?: string; attachments?: any[] }; onDone: () => void; showContext?: boolean }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approved: boolean) => {
    setBusy(true);
    try { await api(`/approvals/${task.id}/decide`, { method: 'POST', body: { approved, note, by: 'You (team)' } }); onDone(); } finally { setBusy(false); }
  };
  const ids: string[] = task.evidence?.attachment_ids ?? [];
  return (
    <div className="rounded-lg border border-warn/40 bg-warn-soft/60 p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-warn">
        <span className="font-medium uppercase tracking-wide">Needs approval · {task.kind === 'action' ? 'action' : 'evidence review'}</span>
        {task.amount_minor != null && <span className="font-semibold">{money(task.amount_minor)}</span>}
      </div>
      {showContext && <div className="text-xs text-ink-2">{task.customer_name} · {task.workflow_name}</div>}
      <div className="mb-1 text-ink">{task.summary}</div>
      {task.evidence?.reason && <div className="mb-2 text-xs text-ink-2">Why: {String(task.evidence.reason)}</div>}
      {ids.length > 0 && (
        <div className="mb-2 flex gap-2">
          {ids.map((id) => <a key={id} href={`${API}/attachments/${id}`} target="_blank" rel="noreferrer">
            <img src={`${API}/attachments/${id}`} alt="evidence" className="h-20 w-20 rounded border border-line bg-panel object-cover" /></a>)}
        </div>
      )}
      {task.status === 'pending' ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (optional)"
                 className="mb-2 w-full rounded-md border border-line bg-panel px-2 py-1 text-sm outline-none" />
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy} onClick={() => decide(true)}>Approve</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide(false)}>Reject</Button>
          </div>
        </>
      ) : (
        <div className="text-xs text-ink-2"><StatusChip status={task.status} /> by {task.decided_by}{task.decision_note ? ` — "${task.decision_note}"` : ''}</div>
      )}
    </div>
  );
}
