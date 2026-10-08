'use client';

import { Loader2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { serverWaking } from '@/lib/api';

// Shown while api() waits for a sleeping API to boot (Render free plan), instead of a JSON error.
export function ServerStatus() {
  const waking = useSyncExternalStore(serverWaking.subscribe, serverWaking.now, () => false);
  const path = usePathname();
  if (!waking || path.startsWith('/embed')) return null;
  return (
    <div role="status" className="fixed left-1/2 top-3 z-[2000] flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-4 py-2 text-xs text-ink-2 shadow-lg">
      <Loader2 size={14} className="animate-spin text-action" />
      Starting the server… this can take up to a minute after it has been idle.
    </div>
  );
}
