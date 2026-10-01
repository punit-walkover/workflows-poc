'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// viaSocket's flow builder, wired the way GTWY does it: the embed script is loaded once with a token,
// window.openViasocket(flowId?, { embedToken, meta }) opens viaSocket's own panel, and results come back
// as window messages. Each published flow becomes an action the AI can call.
const SCRIPT_ID = 'viasocket-embed-main-script';
const SCRIPT_SRC = 'https://embed.viasocket.com/prod-embedcomponent.js';
const META = { type: 'tool', createFrom: 'workflows-poc' };
const LAYOUT = { type: 'right_slider', width: '75', widthUnit: '%', height: '100', heightUnit: '%', backdrop: true };

declare global { interface Window { openViasocket?: (flowId: string | undefined, opts: { embedToken: string; meta?: object }) => void } }

export function useViaSocketBuilder(onSaved: (msg: string) => void) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const saved = useRef(onSaved);
  saved.current = onSaved;

  // Load the embed script once, with the builder token on the tag.
  useEffect(() => {
    let cancelled = false;
    api<{ token: string }>('/integrations/builder-token').then(({ token }) => {
      if (cancelled) return;
      setToken(token);
      if (document.getElementById(SCRIPT_ID)) return;
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = SCRIPT_SRC;
      s.setAttribute('embedToken', token);
      // Overrides the project's dashboard layout: a right-hand slider with viaSocket's own close / fullscreen header.
      s.setAttribute('config', JSON.stringify(LAYOUT));
      s.onerror = () => setError('Could not load the viaSocket builder.');
      document.body.appendChild(s);
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Flow events: only ours (meta.type 'tool') and only ones with a run URL.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const f = e.data;
      if (f?.metadata?.type !== 'tool' || !f?.webhookurl) return;
      if (!['published', 'updated', 'paused', 'deleted', 'delete'].includes(f.action)) return; // drafts don't become actions
      try {
        const a = await api('/actions/from-flow', { method: 'POST', body: f });
        saved.current(f.action.startsWith('delete') ? `Removed the action for “${f.title}”.`
          : f.action === 'paused' ? `@${a.key} is paused in viaSocket, so it's turned off here.`
          : `@${a.key} is ready. Mention it in a workflow step.`);
      } catch (err: any) { setError(err.message); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // New action: no flow id. Edit: the flow id stored on the action.
  const open = (flowId?: string) => {
    if (!token || typeof window.openViasocket !== 'function') return setError('The viaSocket builder is still loading. Try again in a moment.');
    setError('');
    window.openViasocket(flowId, { embedToken: token, meta: META });
  };
  return { open, error, ready: !!token };
}
