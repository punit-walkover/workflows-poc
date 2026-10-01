'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ImagePlus, Send, X } from 'lucide-react';
import { api, API } from '@/lib/api';

// The chat panel other products embed (loaded in an iframe by /widget.js). Customer-facing only.
interface Msg { id: string; role: 'customer' | 'bot' | 'team'; text: string; attachments: { id: string; file_name: string; mime_type: string }[]; created_at: string }
interface Conv { conversation: { id: string; customer_name: string }; messages: Msg[]; typing: boolean; waiting_approval: boolean }

const KEY = 't0_widget_conversation';
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

export default function EmbedPage() {
  return <Suspense><Widget /></Suspense>;
}

function Widget() {
  const p = useSearchParams();
  const title = p.get('title') || 'Support';
  const color = p.get('color') || '#1a1a1a';
  const [convId, setConvId] = useState<string | null>(null);
  const [data, setData] = useState<Conv | null>(null);
  const [who, setWho] = useState({ name: p.get('name') || '', email: p.get('email') || '' });
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const known = !!p.get('email');

  useEffect(() => { setConvId(store.get()); }, []);
  const load = useCallback(async () => {
    if (!convId) return;
    try { setData(await api<Conv>(`/widget/conversations/${convId}`)); } catch { store.set(null); setConvId(null); }
  }, [convId]);
  useEffect(() => { load(); const t = setInterval(load, 1500); return () => clearInterval(t); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [data?.messages.length, data?.typing]);

  const send = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true); setError('');
    try {
      let id = convId;
      if (!id) {
        id = (await api('/widget/conversations', { method: 'POST', body: who })).id as string;
        store.set(id); setConvId(id);
      }
      const ids: string[] = [];
      for (const f of files) {
        const data_base64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
        ids.push((await api('/attachments', { method: 'POST', body: { conversation_id: id, file_name: f.name, mime_type: f.type || 'application/octet-stream', data_base64 } })).id);
      }
      await api(`/widget/conversations/${id}/messages`, { method: 'POST', body: { text, attachment_ids: ids } });
      setText(''); setFiles([]);
      const fresh = await api<Conv>(`/widget/conversations/${id}`);
      setData(fresh);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const needsIdentity = !convId && !known;
  const close = () => window.parent?.postMessage({ t0: 'close' }, '*');

  return (
    <div className="fixed inset-0 flex flex-col bg-panel text-sm">
      <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: color }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 font-semibold">{title[0]}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          <div className="text-xs opacity-80">AI assistant · a teammate steps in when needed</div>
        </div>
        <button onClick={close} aria-label="Close chat" className="rounded p-1 hover:bg-white/20"><X size={18} /></button>
      </header>

      <div className="flex-1 space-y-3 overflow-auto bg-canvas px-4 py-4">
        {!data?.messages.length && (
          <div className="rounded-xl bg-panel p-3 text-ink-2 shadow-sm">
            <Tag role="bot" /> Hi{who.name ? ` ${who.name.split(' ')[0]}` : ''}! How can we help today?
          </div>
        )}
        {data?.messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'customer' ? 'items-end' : 'items-start'}`}>
            <Tag role={m.role} />
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 ${m.role === 'customer' ? 'text-white' : m.role === 'team' ? 'border border-ok/30 bg-ok-soft' : 'bg-panel shadow-sm'}`}
                 style={m.role === 'customer' ? { background: color } : undefined}>
              {m.text}
              {m.attachments.map((a) => a.mime_type.startsWith('image/')
                ? <img key={a.id} src={`${API}/attachments/${a.id}`} alt={a.file_name} className="mt-2 max-h-40 rounded-lg" />
                : <div key={a.id} className="mt-1 text-xs underline">{a.file_name}</div>)}
            </div>
          </div>
        ))}
        {data?.typing && <div className="flex items-center gap-1 text-xs text-ink-3"><Tag role="bot" /> typing…</div>}
        {data?.waiting_approval && <div className="text-center text-xs text-ink-3">A teammate is reviewing your request.</div>}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line bg-panel p-3">
        {needsIdentity && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            <input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Your name" className="rounded-md border border-line px-2 py-1.5 outline-none" />
            <input value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} placeholder="Email" type="email" className="rounded-md border border-line px-2 py-1.5 outline-none" />
          </div>
        )}
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => <span key={i} className="flex items-center gap-1 rounded-md bg-hover px-2 py-1 text-xs">{f.name}
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove file"><X size={12} /></button></span>)}
          </div>
        )}
        {error && <div className="mb-2 text-xs text-bad">{error}</div>}
        <div className="flex items-end gap-2">
          <button title="Attach image" onClick={() => fileInput.current?.click()} className="rounded-md p-2 text-ink-2 hover:bg-hover"><ImagePlus size={18} /></button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Type a message…"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    className="max-h-28 min-h-[38px] flex-1 resize-none rounded-lg border border-line px-3 py-2 outline-none focus:border-ink-3" />
          <button onClick={send} disabled={busy || (needsIdentity && !who.email.includes('@'))} aria-label="Send"
                  className="rounded-lg p-2.5 text-white disabled:opacity-40" style={{ background: color }}><Send size={16} /></button>
        </div>
        <div className="mt-2 text-center text-[10px] text-ink-3">Powered by Ticket0</div>
      </div>
    </div>
  );
}

function Tag({ role }: { role: 'customer' | 'bot' | 'team' }) {
  const t = { customer: ['You', 'text-ink-3'], bot: ['AI assistant', 'text-action'], team: ['Team', 'text-ok'] }[role];
  return <span className={`mb-0.5 text-[11px] font-semibold ${t[1]}`}>{t[0]}</span>;
}
