'use client';

import { ActionBuilder, emptyDraft } from '@/components/action-builder';

export default function NewActionPage() {
  return <ActionBuilder initial={emptyDraft()} isNew />;
}
