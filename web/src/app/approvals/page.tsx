'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ApprovalCard } from '@/components/run-panel';

export default function ApprovalsPage() {
  const [pending, setPending] = useState<any[]>([]);
  const [done, setDone] = useState<any[]>([]);
  const load = useCallback(async () => {
    setPending(await api('/approvals?status=pending'));
    setDone((await api<any[]>('/approvals?status=all')).filter((t) => t.status !== 'pending').slice(0, 20));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <p className="mb-6 text-ink-2">Photos and write actions waiting on a person. Deciding here resumes the paused workflow run.</p>
      {pending.length === 0 && <div className="mb-6 rounded-lg border border-line bg-panel px-4 py-6 text-center text-ink-3">Nothing waiting.</div>}
      <div className="mb-8 space-y-3">{pending.map((t) => <ApprovalCard key={t.id} task={t} onDone={load} showContext />)}</div>
      {done.length > 0 && <>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Recently decided</div>
        <div className="space-y-2">{done.map((t) => <ApprovalCard key={t.id} task={t} onDone={load} showContext />)}</div>
      </>}
    </div>
  );
}
