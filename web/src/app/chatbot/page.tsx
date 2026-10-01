'use client';

import { useEffect, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Button, Card } from '@/components/ui';

// Set up the embeddable chat widget: pick a look, copy one script tag, try it on a demo site.
export default function ChatbotPage() {
  const [title, setTitle] = useState('Northwind Help');
  const [color, setColor] = useState('#1f4fd1');
  const [identify, setIdentify] = useState(true);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const snippet = `<script src="${origin}/widget.js"\n  data-title="${title}" data-color="${color}"${identify ? '\n  data-name="{{user.name}}" data-email="{{user.email}}"' : ''}\n  async></script>`;
  const q = new URLSearchParams({ title, color, ...(identify ? { name: 'Jo Patel', email: 'jo@example.com' } : {}) });
  const demo = `/embed-demo?${new URLSearchParams({ title, color, ...(identify ? {} : { anon: '1' }) })}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const input = 'mt-1 w-full rounded-md border border-line px-2 py-1.5';

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-xl font-semibold">Chatbot embed</h1>
      <p className="mb-6 text-ink-2">Put the same AI agent and workflows inside any product with one script tag. Chats from the widget show up in the Playground with a <span className="rounded bg-var-soft px-1 text-xs font-medium text-var">widget</span> badge, and approvals work the same way.</p>
      <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <Card className="grid grid-cols-2 gap-4 px-5 py-4">
            <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
            <label>Color
              <span className="mt-1 flex items-center gap-2"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 rounded border border-line" />
                <input value={color} onChange={(e) => setColor(e.target.value)} className="w-full rounded-md border border-line px-2 py-1.5 font-mono text-xs" /></span></label>
            <label className="col-span-2 flex items-start gap-2">
              <input type="checkbox" checked={identify} onChange={(e) => setIdentify(e.target.checked)} className="mt-1" />
              <span>Pass the signed-in user <span className="block text-xs text-ink-3">The host product fills in name and email, so the AI never has to ask. Off: the widget asks for them.</span></span>
            </label>
          </Card>
          <Card className="px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Paste this before &lt;/body&gt;</span>
              <Button onClick={copy}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-canvas p-3 font-mono text-xs">{snippet}</pre>
            <p className="mt-2 text-xs text-ink-3">Optional from the page’s own code: <code>Ticket0Chat.open()</code> and <code>Ticket0Chat.close()</code>.</p>
          </Card>
          <Card className="px-5 py-4">
            <div className="mb-1 font-medium">Try it on a demo site</div>
            <p className="mb-3 text-ink-2">A fake store page with the snippet above already pasted in.</p>
            <a href={demo} target="_blank" rel="noreferrer"><Button variant="primary"><ExternalLink size={14} /> Open demo site</Button></a>
          </Card>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Live preview</div>
          <iframe key={q.toString()} src={`/embed?${q}`} title="Widget preview" className="h-[580px] w-full rounded-2xl border border-line bg-panel shadow-lg" />
        </div>
      </div>
    </div>
  );
}
