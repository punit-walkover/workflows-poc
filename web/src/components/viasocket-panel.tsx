'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

// viaSocket's embedded flow builder in a side panel. Each published flow becomes an action the AI can call.
const SCRIPT = 'https://embed.viasocket.com/prod-embedcomponent.js';
type Embed = { on: (e: 'flow', fn: (flow: any) => void) => void; destroy?: () => void };
declare global { interface Window { viaSocket?: { mount: (o: { embedToken: string; parent: string | HTMLElement; config?: object }) => Embed } } }

let loading: Promise<void> | null = null;
const loadScript = () => (loading ??= new Promise<void>((resolve, reject) => {
  if (window.viaSocket) return resolve();
  const s = document.createElement('script');
  s.src = SCRIPT;
  s.onload = () => resolve();
  s.onerror = () => { loading = null; reject(new Error('Could not load the viaSocket panel.')); };
  document.body.appendChild(s);
}));

export function ViaSocketPanel({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let embed: Embed | null = null;
    let cancelled = false;
    const save = async (flow: any) => {
      if (!['published', 'updated', 'paused', 'deleted'].includes(flow?.action)) return; // drafts don't become actions
      try {
        const a = await api('/actions/from-flow', { method: 'POST', body: flow });
        onSaved(flow.action === 'deleted' ? `Removed the action for “${flow.title}”.` : `@${a.key} is ready. Mention it in a workflow step.`);
      } catch (e: any) { setError(e.message); }
    };
    (async () => {
      try {
        setError('');
        const [{ token }] = await Promise.all([api<{ token: string }>('/integrations/token'), loadScript()]);
        if (cancelled || !host.current || !window.viaSocket) return;
        embed = window.viaSocket.mount({
          embedToken: token, parent: host.current,
          config: { pageheading: 'Action', pagesubheading: 'Build a tool the AI can call from a workflow step', chatbot: true, showEnabled: true },
        });
        embed.on('flow', save);
      } catch (e: any) { setError(e.message); }
    })();
    return () => { cancelled = true; embed?.destroy?.(); if (host.current) host.current.innerHTML = ''; };
  }, [open, onSaved]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside className="flex h-full w-[min(760px,100vw)] flex-col bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="flex-1">
            <div className="font-medium">Build an action in viaSocket</div>
            <div className="text-xs text-ink-3">Pick an app and what it should do, then publish. It shows up in your actions list.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
        </header>
        {error && <div className="m-4 rounded-lg bg-bad-soft px-3 py-2 text-bad">{error}</div>}
        <div ref={host} className="min-h-0 flex-1 overflow-auto" />
      </aside>
    </div>
  );
}
