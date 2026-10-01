'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Actions area: tools the AI can call, and the app connections they run through.
const TABS = [
  { href: '/actions', label: 'Actions', hint: 'Tools workflows can mention with @key' },
  { href: '/actions/connections', label: 'Connections', hint: 'Apps connected through viaSocket' },
];

export function ActionsTabs() {
  const path = usePathname();
  const active = path === '/actions/connections' ? TABS[1] : TABS[0];
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold">Actions</h1>
      <p className="mb-4 text-ink-2">{active.hint}.</p>
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${t === active ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
