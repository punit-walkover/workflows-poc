'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bot, GitBranch, MessagesSquare, ShieldCheck, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { AttentionDot } from './ui';

const ITEMS = [
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/playground', label: 'Playground', icon: MessagesSquare },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/actions', label: 'Actions', icon: Wrench },
  { href: '/chatbot', label: 'Chatbot embed', icon: Bot },
];

export function Nav() {
  const path = usePathname();
  const [pending, setPending] = useState(0);
  const embedded = path.startsWith('/embed');
  useEffect(() => {
    if (embedded) return;
    const load = () => api<any[]>('/approvals?status=pending').then((r) => setPending(r.length)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [embedded]);
  if (embedded) return null; // the widget and the demo host page render without the admin shell
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-[#f7f7f4] px-3 py-4">
      <div className="mb-6 px-2">
        <div className="text-base font-semibold">Ticket0</div>
        <div className="text-xs text-ink-3">Workflows POC · DBOS + GTWY</div>
      </div>
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href}
              className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 ${path.startsWith(href) ? 'bg-hover font-medium' : 'text-ink-2 hover:bg-hover'}`}>
          <Icon size={16} /> {label}
          {href === '/approvals' && pending > 0 && <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-bad"><AttentionDot />{pending}</span>}
        </Link>
      ))}
    </aside>
  );
}
