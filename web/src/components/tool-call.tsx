'use client';

import { ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import { JsonView } from './json-view';

// One row of action_run: every tool call a run made.
export interface ActionRun {
  id: string; action_key: string; node_id: string | null; mode: 'auto' | 'approved' | 'test'; visit: number;
  status: 'running' | 'succeeded' | 'failed'; args: unknown; result: unknown; error: string | null;
  started_at: string; finished_at: string | null;
}

const STATUS = { succeeded: 'text-ok', failed: 'text-bad', running: 'text-warn' } as const;
const secs = (c: ActionRun) => {
  if (!c.finished_at) return '…';
  const ms = Math.max(0, new Date(c.finished_at).getTime() - new Date(c.started_at).getTime());
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
};
const nth = (n: number) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// Under a step: its tool calls (input + response), collapsed; a failed call opens on its own so the error shows.
export function ToolCalls({ calls, output }: { calls: ActionRun[]; output?: unknown }) {
  if (calls.length) return <div className="mt-1 space-y-1">{calls.map((c) => <Call key={c.id} c={c} retry={calls.length > 1} />)}</div>;
  // Built-in steps (approval, escalation) don't call a tool; show what they produced instead.
  if (output === undefined) return null;
  return <Fold title={<span className="text-ink-2">Result</span>}><Section label="Result" value={output} /></Fold>;
}

function Call({ c, retry }: { c: ActionRun; retry: boolean }) {
  return (
    <Fold defaultOpen={c.status === 'failed'} title={<>
      <span className="text-ink-2">Tool call</span>
      <span className={STATUS[c.status]}>· {c.status}</span>
      <span className="text-ink-3">· {secs(c)}{c.mode === 'approved' ? ' · approved' : ''}{retry && c.visit > 1 ? ` · ${nth(c.visit)} try` : ''}</span>
    </>}>
      <Section label="Input" value={c.args} />
      {c.status === 'failed'
        ? <div className="rounded bg-bad-soft px-2 py-1 text-[11px] text-bad">{c.error || 'failed'}</div>
        : <Section label="Response" value={c.result} />}
    </Fold>
  );
}

function Fold({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="text-xs font-normal">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 hover:text-ink">
        <ChevronRight size={12} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`} />{title}
      </button>
      {open && <div className="mt-1 space-y-1.5 rounded-md border border-line bg-canvas/60 p-2">{children}</div>}
    </div>
  );
}

function Section({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ }
  };
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        {label}
        <button type="button" title={`Copy ${label.toLowerCase()} as JSON`} onClick={copy} className="flex items-center gap-1 font-normal normal-case tracking-normal hover:text-ink">
          <Copy size={10} /> {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="max-h-60 overflow-auto">{value === null || value === undefined ? <span className="text-ink-3">empty</span> : <JsonView value={value} />}</div>
    </div>
  );
}
