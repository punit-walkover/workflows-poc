'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, Send, X } from 'lucide-react';
import { api, API, money } from '@/lib/api';
import { AttentionDot, Button, StatusChip } from '@/components/ui';
import { ApprovalCard, EventRow, RunPanel, RunView, Task } from '@/components/run-panel';
import type { ActionRun } from '@/components/tool-call';

interface Conv { id: string; customer_name: string; customer_email: string; channel: string; run_status: string | null; last_text: string | null; pending_approvals: number }
interface Msg { id: string; role: 'customer' | 'bot' | 'team' | 'system'; text: string; attachments: { id: string; file_name: string; mime_type: string }[]; created_at: string }
interface State { conversation: Conv; messages: Msg[]; runs: RunView[]; events: EventRow[]; approvals: Task[]; action_runs: ActionRun[] }

const PERSONAS = [
  { name: 'Alex Kim', email: 'alex@example.com', hint: 'Orders 4512 (headphones, 6 days ago) and 4513 (keyboard, 45 days ago)' },
  { name: 'Sam Rivera', email: 'sam@example.com', hint: 'Order 4600 (blender $159.99). Refunds need a teammate’s approval' },
  { name: 'Jo Patel', email: 'jo@example.com', hint: 'Order 4700 (mugs + kettle, 10 days ago)' },
];

// Who wrote it, shown on every bubble.
const WHO = {
  customer: { label: 'Customer', tag: 'bg-ink/10 text-ink', bubble: 'bg-ink text-white' },
  bot: { label: 'AI', tag: 'bg-action-soft text-action', bubble: 'border border-line bg-panel' },
  team: { label: 'Team', tag: 'bg-ok-soft text-ok', bubble: 'border border-ok/30 bg-ok-soft/50' },
} as const;

export default function PlaygroundPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [persona, setPersona] = useState(0);

  const loadList = useCallback(() => api<Conv[]>('/conversations').then(setConvs), []);
  const loadState = useCallback(async () => { if (activeId) setState(await api<State>(`/conversations/${activeId}`)); }, [activeId]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    setState(null);
    loadState();
    const t = setInterval(() => { loadState(); loadList(); }, 1500);
    return () => clearInterval(t);
  }, [loadState, loadList]);

  const start = async () => {
    const p = PERSONAS[persona];
    const c = await api<Conv>('/conversations', { method: 'POST', body: { customer_name: p.name, customer_email: p.email } });
    await loadList();
    setActiveId(c.id);
  };
  const refresh = () => { loadState(); loadList(); };
  const waiting = convs.filter((c) => c.pending_approvals > 0).length;

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Chat as customer</div>
          <select value={persona} onChange={(e) => setPersona(Number(e.target.value))} className="mb-2 w-full rounded-md border border-line px-2 py-1.5">
            {PERSONAS.map((p, i) => <option key={p.email} value={i}>{p.name} · {p.email}</option>)}
          </select>
          <div className="mb-2 text-xs text-ink-3">{PERSONAS[persona].hint}</div>
          <Button variant="primary" className="w-full" onClick={start}><Plus size={15} /> New conversation</Button>
        </div>
        {waiting > 0 && (
          <div className="flex items-center gap-2 border-b border-line bg-bad-soft px-3 py-2 text-xs font-medium text-bad">
            <AttentionDot /> {waiting} chat{waiting > 1 ? 's need' : ' needs'} approval
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {convs.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
                    className={`block w-full border-b border-line px-3 py-2.5 text-left ${c.id === activeId ? 'bg-hover' : 'hover:bg-hover/60'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {c.pending_approvals > 0 && <AttentionDot />}
                  <span className="truncate font-medium">{c.customer_name}</span>
                  {c.channel === 'widget' && <span className="rounded bg-var-soft px-1 text-[10px] font-medium text-var">widget</span>}
                </span>
                {c.run_status && <StatusChip status={c.run_status} />}
              </div>
              <div className={`truncate text-xs ${c.pending_approvals > 0 ? 'font-medium text-bad' : 'text-ink-3'}`}>
                {c.pending_approvals > 0 ? 'Needs approval · open to review' : c.last_text || 'No messages yet'}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {activeId && state ? (
        <>
          <Chat state={state} onChanged={refresh} />
          <aside className="w-[400px] shrink-0 overflow-auto border-l border-line bg-panel">
            <RunPanel run={state.runs[0]} events={state.events} approvals={state.approvals} actionRuns={state.action_runs} onChanged={refresh} />
          </aside>
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

type Item = { at: string; msg?: Msg; task?: Task };

function Chat({ state, onChanged }: { state: State; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [as, setAs] = useState<'customer' | 'team'>('customer');
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const convId = state.conversation.id;

  // Messages and approval requests in one timeline.
  const items: Item[] = [
    ...state.messages.map((m) => ({ at: m.created_at, msg: m })),
    ...state.approvals.map((t) => ({ at: t.created_at, task: t })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [items.length]);

  const last = state.messages.filter((m) => m.role !== 'system').at(-1);
  const run = state.runs[0];
  // Only while a run is actually working (or routing hasn't started one yet); a finished run never "works".
  const thinking = last?.role === 'customer' && (!run || run.status === 'running');
  const pending = state.approvals.filter((t) => t.status === 'pending').length;

  const send = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true);
    try {
      if (as === 'team') {
        await api(`/conversations/${convId}/team-messages`, { method: 'POST', body: { text } });
      } else {
        const ids: string[] = [];
        for (const f of files) {
          const data_base64 = await new Promise<string>((res) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).split(',')[1]);
            r.readAsDataURL(f);
          });
          ids.push((await api('/attachments', { method: 'POST', body: { conversation_id: convId, file_name: f.name, mime_type: f.type || 'application/octet-stream', data_base64 } })).id);
        }
        await api(`/conversations/${convId}/messages`, { method: 'POST', body: { text, attachment_ids: ids } });
      }
      setText(''); setFiles([]);
      onChanged();
    } finally { setBusy(false); }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{state.conversation.customer_name}
            {state.conversation.channel === 'widget' && <span className="ml-2 rounded bg-var-soft px-1.5 text-xs font-medium text-var">from embedded widget</span>}</div>
          <div className="text-xs text-ink-3">{state.conversation.customer_email} · write as the customer or the team; the right panel is the teammate view</div>
        </div>
        {pending > 0 && <span className="flex items-center gap-2 rounded-full bg-bad-soft px-3 py-1 text-xs font-medium text-bad"><AttentionDot /> Needs approval</span>}
      </header>
      <div className="flex-1 space-y-3 overflow-auto px-6 py-5">
        {items.map(({ msg: m, task }) => {
          if (task) return (
            <div key={task.id} className="flex justify-start">
              <div className="w-full max-w-[75%]">
                <Label who="team" extra={task.status === 'pending' ? 'approval needed' : undefined} at={task.created_at} />
                <ApprovalCard task={task} onDone={onChanged} />
              </div>
            </div>
          );
          if (!m) return null;
          if (m.role === 'system') return <div key={m.id} className="text-center text-xs text-ink-3">{m.text}</div>;
          return (
            <div key={m.id} className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[70%] flex-col ${m.role === 'customer' ? 'items-end' : 'items-start'}`}>
                <Label who={m.role} at={m.created_at} />
                <div className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 ${WHO[m.role].bubble}`}>
                  {m.text}
                  {m.attachments.map((a) => a.mime_type.startsWith('image/')
                    ? <img key={a.id} src={`${API}/attachments/${a.id}`} alt={a.file_name} className="mt-2 max-h-48 rounded-lg" />
                    : <div key={a.id} className="mt-1 text-xs underline">{a.file_name}</div>)}
                </div>
              </div>
            </div>
          );
        })}
        {thinking && <div className="text-xs text-ink-3"><Label who="bot" /> is working…</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-line bg-panel p-3">
        <div className="mb-2 flex items-center gap-1 text-xs">
          <span className="mr-1 text-ink-3">Write as</span>
          {(['customer', 'team'] as const).map((r) => (
            <button key={r} onClick={() => { setAs(r); setFiles([]); }}
                    className={`rounded-full px-2.5 py-0.5 font-medium ${as === r ? WHO[r].tag : 'text-ink-2 hover:bg-hover'}`}>{WHO[r].label}</button>
          ))}
          {as === 'team' && <span className="ml-2 text-ink-3">Team replies reach the customer but don&apos;t move the workflow forward.</span>}
        </div>
        {files.length > 0 && (
          <div className="mb-2 flex gap-2">
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-1 rounded-md bg-hover px-2 py-1 text-xs">{f.name}
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          {as === 'customer' && <button title="Attach image" onClick={() => fileInput.current?.click()} className="rounded-md p-2 text-ink-2 hover:bg-hover"><ImagePlus size={18} /></button>}
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={as === 'team' ? 'Reply as the team…' : 'Write as the customer…'}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    className="max-h-40 min-h-[38px] flex-1 resize-none rounded-lg border border-line px-3 py-2 outline-none focus:border-ink-3" />
          <Button variant="primary" onClick={send} disabled={busy}><Send size={15} /></Button>
        </div>
      </div>
    </section>
  );
}

function Label({ who, at, extra }: { who: keyof typeof WHO; at?: string; extra?: string }) {
  return (
    <span className="mb-1 inline-flex items-center gap-1.5 text-[11px] text-ink-3">
      <span className={`rounded px-1.5 py-px font-semibold ${WHO[who].tag}`}>{WHO[who].label}</span>
      {extra && <span className="font-medium text-bad">{extra}</span>}
      {at && new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

function EmptyState() {
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => { api('/orders').then(setOrders); }, []);
  return (
    <div className="flex-1 overflow-auto p-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold">Playground</h1>
        <p className="mb-6 text-ink-2">Pick a customer on the left and start a conversation. The agent routes it to a published workflow and runs it step by step, durably, with DBOS. Chats waiting on an approval show a red dot.</p>
        <div className="mb-6 rounded-xl border border-line bg-panel p-4">
          <div className="mb-2 font-medium">Try these</div>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            <li>As Alex: “My headphones arrived cracked, I want a refund.” Then send order <b>4512</b> and attach any photo. Approve it right in the chat.</li>
            <li>As Alex: “I want my money back for order 4513.” (outside the 30-day window, so it escalates)</li>
            <li>As Sam: “Refund my blender please, order 4600.” (refunds need approval: the chat gets a red dot, open it and approve)</li>
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="font-medium">Mock shop orders</span>
            <Button variant="ghost" onClick={async () => { await api('/demo/reset-orders', { method: 'POST' }); setOrders(await api('/orders')); }}>Reset refunds</Button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-3"><tr><th className="px-4 py-2">Order</th><th>Customer</th><th>Items</th><th>Delivered</th><th>Total</th><th>Refunded</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">{o.id}</td><td>{o.customer_email}</td>
                  <td>{o.items.map((i: any) => i.name).join(', ')}</td><td>{o.days_since_delivery} days ago</td>
                  <td>{money(o.total_minor)}</td><td>{money(o.refunded_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
