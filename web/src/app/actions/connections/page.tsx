'use client';

import { ActionsTabs } from '@/components/actions-tabs';
import { ConnectedApps } from '@/components/connected-apps';

export default function ConnectionsPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <ActionsTabs />
      <ConnectedApps />
    </div>
  );
}
