'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'secondary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const v = {
    primary: 'bg-ink text-white hover:bg-[#333]',
    secondary: 'border border-line bg-panel hover:bg-hover',
    ghost: 'hover:bg-hover',
    danger: 'border border-line bg-panel text-bad hover:bg-bad-soft',
  }[variant];
  return <button type="button" {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${v} ${className}`} />;
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
            className={`relative h-5 w-9 rounded-full transition disabled:opacity-40 ${on ? 'bg-brand' : 'bg-[#d0d0cb]'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

const STATUS: Record<string, string> = {
  running: 'bg-action-soft text-action',
  waiting_customer: 'bg-warn-soft text-warn',
  waiting_approval: 'bg-bad-soft text-bad',
  paused: 'bg-hover text-ink-2',
  failed: 'bg-bad-soft text-bad',
  completed: 'bg-ok-soft text-ok',
  escalated: 'bg-bad-soft text-bad',
  expired: 'bg-hover text-ink-2',
  cancelled: 'bg-hover text-ink-2',
  pending: 'bg-warn-soft text-warn',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-bad-soft text-bad',
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[status] ?? 'bg-hover text-ink-2'}`}>{status.replace('_', ' ')}</span>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-panel ${className}`}>{children}</div>;
}

// Red pulsing dot: something is waiting on an approval.
export function AttentionDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" title="Needs approval">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-bad" />
    </span>
  );
}
