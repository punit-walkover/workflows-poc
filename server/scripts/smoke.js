// End-to-end smoke test against a running server: `npm run smoke -- damaged|escalate|approval`.
const API = process.env.API_URL || 'http://localhost:4001';
const j = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the bot has replied and the run is no longer mid-step.
async function turn(id, seen) {
  for (let i = 0; i < 60; i++) {
    const s = await j('GET', `/conversations/${id}`);
    const fresh = s.messages.filter((m) => m.role !== 'customer' && !seen.has(m.id));
    if (!fresh.some((m) => m.role !== 'system')) { await sleep(1500); continue; }
    if (fresh.length && s.runs[0]?.status !== 'running') {
      fresh.forEach((m) => { seen.add(m.id); console.log(`  [${m.role}] ${m.text}`); });
      const r = s.runs[0];
      if (r) console.log(`  → ${r.workflow_name} v${r.version} · ${r.status} · at ${r.current_node_id ?? '-'}`);
      return s;
    }
    await sleep(1500);
  }
  throw new Error('no reply within 90s');
}

(async () => {
  const mode = process.argv[2] || 'damaged';
  const who = { damaged: ['Alex Kim', 'alex@example.com'], escalate: ['Alex Kim', 'alex@example.com'], approval: ['Sam Rivera', 'sam@example.com'], sheets: ['Alex Kim', 'alex@example.com'] }[mode];
  await j('POST', '/demo/reset-orders');
  const conv = await j('POST', '/conversations', { customer_name: who[0], customer_email: who[1] });
  const seen = new Set();
  const say = async (text, extra = {}) => { console.log(`\n> ${text}`); await j('POST', `/conversations/${conv.id}/messages`, { text, ...extra }); return turn(conv.id, seen); };
  const approvePending = async () => {
    const t = (await j('GET', '/approvals')).find((x) => x.conversation_id === conv.id);
    if (!t) throw new Error('expected a pending approval');
    console.log(`\n* approving: ${t.summary}`);
    await j('POST', `/approvals/${t.id}/decide`, { approved: true, note: 'Looks good' });
    return turn(conv.id, seen);
  };

  let s;
  if (mode === 'damaged') {
    await say('Hi, the headphones I got arrived cracked. I want a refund.');
    await say('Order 4512');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const att = await j('POST', '/attachments', { conversation_id: conv.id, file_name: 'crack.png', mime_type: 'image/png', data_base64: png });
    await say('Here is a photo of the damage', { attachment_ids: [att.id] });
    s = await approvePending();
    if (s.runs[0].status === 'waiting_approval') s = await approvePending(); // the refund needs approval too
  } else if (mode === 'sheets') {
    await say('I want a refund for order 5001, the headphones stopped working after a week.');
    s = await say('Yes, the wireless headphones. They stopped charging.');
    if (s.runs[0].status === 'waiting_approval') s = await approvePending();
  } else if (mode === 'escalate') {
    s = await say('I want my money back for order 4513, the keyboard.');
  } else {
    await say("I'd like a refund for my blender, order 4600. It stopped working after two days.");
    s = (await j('GET', `/conversations/${conv.id}`)).runs[0].status === 'waiting_approval' ? await approvePending() : await say('The Pro blender, it stopped working.');
    if (s.runs[0].status === 'waiting_approval') s = await approvePending();
  }
  console.log(`\nfinal: ${s.runs[0]?.status} (${s.runs[0]?.end_reason ?? ''})`);
  console.log('actions:', s.action_runs.map((a) => `${a.action_key}/${a.mode}/${a.status}`).join(', ') || 'none');
})().catch((e) => { console.error(e.message); process.exit(1); });
