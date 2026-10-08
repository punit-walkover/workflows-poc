'use client';

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { JsonView } from './json-view';

// One durable step DBOS recorded for a run (GET /runs/:id/dbos-steps).
export interface DbosStep { function_id: number; name: string; error: string | null; output: any; started_at?: number; completed_at?: number }

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const took = (s: DbosStep) => (s.started_at && s.completed_at ? s.completed_at - s.started_at : null);

// What the runner's steps mean, in words (see server/src/runner/workflow.ts and steps.ts).
const BADGE: Record<string, string> = {
  decide: 'bg-action-soft text-action', act: 'bg-warn-soft text-warn', advance: 'bg-hover text-ink-2', apply: 'bg-hover text-ink-2',
  flush: 'bg-ok-soft text-ok', 'DBOS.recv': 'bg-var-soft text-var', 'DBOS.sleep': 'bg-var-soft text-var',
};

function summarize(s: DbosStep): { text: string; node?: string } {
  const o = s.output;
  if (s.error) return { text: s.error };
  switch (s.name) {
    case 'decide':
      switch (o?.kind) {
        case 'step': return { node: o.nodeId, text: `AI decided: ${String(o.d?.decision ?? '').replace('_', ' ')}${o.d?.action?.key ? ` @${o.d.action.key}` : ''}` };
        case 'case': return { node: o.nodeId, text: `Condition → ${o.caseId ?? 'no case'}` };
        case 'ask': return { node: o.nodeId, text: o.answer ? 'Answer accepted' : o.invalid ? "Answer didn't fit, asking again" : 'Ask the customer' };
        case 'say': return { node: o.nodeId, text: 'Text bubble' };
        case 'goto': return { node: o.nodeId, text: 'Go to step' };
        case 'end': return { text: 'End of workflow' };
        case 'error': return { node: o.nodeId, text: `Error: ${o.error}` };
      }
      return { text: 'Decided' };
    case 'act':
      return { text: { done: 'Tool ran', wait_approval: 'Approval requested', escalated: 'Escalated', invalid: `Invalid tool call: ${o?.error ?? ''}`, failed: `Tool failed: ${o?.error ?? ''}` }[o?.status as string] ?? 'Acted' };
    case 'advance':
    case 'apply':
      if (o?.next === 'continue') return { text: 'On to the next block' };
      if (o?.next === 'run') return { text: 'Resume the run' };
      if (o?.next === 'end') return { text: 'Run ended' };
      if (o?.next === 'wait') return { text: o.deadline ? `Wait until ${time(o.deadline)}` : 'Wait' };
      return { text: s.name === 'apply' ? 'Applied' : 'Advanced' };
    case 'flush': return { text: o ? 'Message sent to the customer' : 'Nothing to send' };
    case 'DBOS.recv':
      if (!o) return { text: 'Timer fired (no signal)' };
      if (o.type === 'customer_message') return { text: 'Customer replied' };
      if (o.type === 'approval_decision') return { text: `Team ${o.approved ? 'approved' : 'rejected'}${o.by ? ` (${o.by})` : ''}` };
      return { text: `Signal: ${o.type}` };
    // DBOS records the recv's deadline as a sleep step: when the run would have woken up without a signal.
    case 'DBOS.sleep': return { text: typeof o === 'number' ? `Wait deadline ${time(o)}` : 'Wait deadline' };
  }
  return { text: typeof o === 'string' ? o : '' };
}

// DBOS's own checkpoint log, readable: one row per durable step, raw output on click.
// A wait (recv) starts a new turn, so it gets a divider: that's where the run was asleep.
export function DbosSteps({ steps }: { steps: DbosStep[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!steps.length) return <div className="mb-3 rounded-lg border border-line px-3 py-2 text-xs text-ink-3">No checkpoints yet.</div>;
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-line text-xs">
      {steps.map((s) => {
        const { text, node } = summarize(s);
        const ms = took(s);
        const wait = s.name === 'DBOS.recv';
        return (
          <div key={s.function_id} className={wait ? 'border-t-2 border-dashed border-var/30 first:border-t-0' : 'border-t border-line first:border-t-0'}>
            <button type="button" onClick={() => setOpen(open === s.function_id ? null : s.function_id)}
                    className="grid w-full grid-cols-[1.5rem_5.5rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-left hover:bg-hover">
              <span className="text-right font-mono text-[10px] text-ink-3">{s.function_id}</span>
              <span className={`truncate rounded px-1.5 py-px text-center font-mono text-[10px] font-medium ${BADGE[s.name] ?? 'bg-hover text-ink-2'}`}>{s.name.replace('DBOS.', '')}</span>
              <span className={`flex min-w-0 items-center gap-1.5 ${s.error ? 'text-bad' : 'text-ink'}`}>
                <ChevronRight size={11} className={`shrink-0 text-ink-3 transition-transform ${open === s.function_id ? 'rotate-90' : ''}`} />
                <span className="truncate">{text}</span>
                {node && <span className="shrink-0 rounded bg-canvas px-1 font-mono text-[10px] text-ink-3">{node}</span>}
              </span>
              <span className="text-[10px] text-ink-3">{ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}</span>
            </button>
            {open === s.function_id && (
              <div className="max-h-60 overflow-auto border-t border-line bg-canvas/60 px-3 py-2">
                {s.started_at && <div className="mb-1 text-[10px] text-ink-3">{time(s.started_at)}</div>}
                {s.error ? <div className="text-bad">{s.error}</div> : s.output === null || s.output === undefined ? <span className="text-ink-3">no output</span> : <JsonView value={s.output} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
