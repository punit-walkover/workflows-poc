'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Toggle } from './ui';

// One dialog per tool: viaSocket's builder inline on the left (how the tool works), our details on the right
// (the @name workflows mention, the description the AI reads, approval). Publishing in viaSocket creates the action.
const SCRIPT_ID = 'viasocket-embed-main-script';
const SCRIPT_SRC = 'https://embed.viasocket.com/prod-embedcomponent.js';
const META = { type: 'tool', createFrom: 'workflows-poc' };

export interface Tool {
  key: string; name: string; description: string; requires_approval: boolean; enabled: boolean; via_flow_id: string | null;
  input_schema?: { properties?: Record<string, unknown> };
}

// A whole app enabled as one AI tool (inputs action_name + instructions) isn't a flow viaSocket can open by id;
// it lives on the builder's home screen under Enabled Integrations.
const flowToOpen = (t: Tool | null) => {
  const p = t?.input_schema?.properties ?? {};
  return 'action_name' in p && 'instructions' in p ? undefined : t?.via_flow_id ?? undefined;
};
type Embed = { on: (e: 'flow', fn: (f: any) => void) => void; destroy: () => void };
declare global {
  interface Window { viaSocket?: { mount: (o: { embedToken: string; parent: HTMLElement; config?: object; open?: object }) => Embed } }
}

// The script is loaded without a token, so it doesn't create its own floating slider; we mount it inline.
let loading: Promise<void> | null = null;
const loadScript = () => (loading ??= new Promise<void>((resolve, reject) => {
  if (window.viaSocket) return resolve();
  const s = document.createElement('script');
  s.id = SCRIPT_ID;
  s.src = SCRIPT_SRC;
  s.onload = () => resolve();
  s.onerror = () => { loading = null; reject(new Error('Could not load the viaSocket builder.')); };
  document.body.appendChild(s);
}));

const fromTool = (t: Tool | null) => ({
  key: t?.key ?? '', name: t?.name ?? '', description: t?.description ?? '',
  requires_approval: t?.requires_approval ?? true, enabled: t?.enabled ?? true,
});

export function ToolDialog({ tool: initial, onClose, onChanged }: { tool: Tool | null; onClose: () => void; onChanged: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool | null>(initial);
  const [form, setForm] = useState(fromTool(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = useRef({ form, dirty });
  latest.current = { form, dirty };

  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const save = async (t: Tool, f = form) => {
    setBusy(true); setMsg(null);
    try {
      const body = { new_key: f.key || undefined, name: f.name || undefined, description: f.description || undefined,
                     requires_approval: f.requires_approval, enabled: f.enabled };
      const saved = await api<Tool>(`/actions/${t.key}`, { method: 'PATCH', body });
      setTool(saved); setForm(fromTool(saved)); setDirty(false);
      setMsg({ ok: true, text: `Saved. Mention it in a workflow step as @${saved.key}.` });
      onChanged();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };

  // Mount the builder inline, opened on this tool's flow (or a new one), and turn its events into the action.
  useEffect(() => {
    let embed: Embed | null = null;
    let cancelled = false;
    (async () => {
      try {
        const [{ token }] = await Promise.all([api<{ token: string }>('/integrations/builder-token'), loadScript()]);
        if (cancelled || !host.current || !window.viaSocket) return;
        embed = window.viaSocket.mount({ embedToken: token, parent: host.current, config: { pageheading: 'Tool' },
                                         open: { flowId: flowToOpen(initial), meta: META } });
        embed.on('flow', async (f) => {
          if (!['published', 'updated', 'paused', 'deleted', 'delete'].includes(f?.action) || !f.webhookurl) return; // drafts stay drafts
          try {
            const a = await api<Tool & { ok?: boolean }>('/actions/from-flow', { method: 'POST', body: f });
            if (f.action.startsWith('delete')) { setTool(null); setMsg({ ok: true, text: 'Deleted in viaSocket, so the action is gone too.' }); onChanged(); return; }
            setTool(a);
            // Details typed before going live are applied now; otherwise show what viaSocket sent.
            if (latest.current.dirty) await save(a, latest.current.form);
            else { setForm(fromTool(a)); setMsg({ ok: true, text: f.action === 'paused' ? 'Paused in viaSocket, so the action is off.' : `@${a.key} is live.` }); onChanged(); }
          } catch (e: any) { setMsg({ ok: false, text: e.message }); }
        });
      } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    })();
    return () => { cancelled = true; embed?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const input = 'mt-1 w-full rounded-md border border-line bg-panel px-2.5 py-1.5 outline-none focus:border-ink-3';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex h-[92vh] w-[min(1320px,100%)] overflow-hidden rounded-xl bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <section className="min-w-0 flex-1 bg-[#1b1b1f]">
          <div ref={host} className="h-full w-full" />
        </section>

        <aside className="flex w-80 shrink-0 flex-col border-l border-line">
          <header className="flex items-start gap-2 border-b border-line px-5 py-4">
            <div className="flex-1">
              <div className="font-semibold">{tool ? `@${tool.key}` : 'New tool'}</div>
              <div className="text-xs text-ink-3">{tool ? 'Live in viaSocket' : 'Build it on the left, then click Go live'}</div>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
          </header>

          <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
            <label className="block">
              <span className="font-medium">@name</span>
              <span className="block text-xs text-ink-3">How workflow steps mention it. Lowercase, digits and _.</span>
              <div className="mt-1 flex items-center rounded-md border border-line focus-within:border-ink-3">
                <span className="pl-2.5 text-ink-3">@</span>
                <input id="tool-key" value={form.key} placeholder={tool ? '' : 'from the tool name'}
                       onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                       className="w-full bg-transparent px-1 py-1.5 outline-none" />
              </div>
            </label>
            <label className="block">
              <span className="font-medium">Display name</span>
              <input id="tool-name" value={form.name} placeholder="e.g. Refund order" onChange={(e) => set({ name: e.target.value })} className={input} />
            </label>
            <label className="block">
              <span className="font-medium">Description for the AI</span>
              <span className="block text-xs text-ink-3">When to use it and what it returns. The AI reads this to decide.</span>
              <textarea id="tool-description" value={form.description} rows={6} placeholder="Filled from viaSocket when it goes live"
                        onChange={(e) => set({ description: e.target.value })} className={`${input} resize-y`} />
            </label>
            <div className="flex items-start justify-between gap-3">
              <div><div className="font-medium">Needs approval</div><div className="text-xs text-ink-3">A teammate approves before it runs.</div></div>
              <Toggle on={form.requires_approval} onChange={(v) => set({ requires_approval: v })} />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div><div className="font-medium">Enabled</div><div className="text-xs text-ink-3">Workflows can use it.</div></div>
              <Toggle on={form.enabled} onChange={(v) => set({ enabled: v })} />
            </div>
            {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{msg.text}</div>}
          </div>

          <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
            <span className="flex-1 text-xs text-ink-3">{tool ? (dirty ? 'Unsaved changes' : 'All saved') : dirty ? 'Saved when it goes live' : ''}</span>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={!tool || !dirty || busy} onClick={() => tool && save(tool)}>{busy ? 'Saving…' : 'Save'}</Button>
          </footer>
        </aside>
      </div>
    </div>
  );
}
