'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ActionBuilder, ActionDraft, ArgDef } from '@/components/action-builder';

// Maps a stored action back into the builder's draft shape.
function toDraft(a: any): ActionDraft {
  const props: Record<string, any> = a.input_schema?.properties ?? {};
  const args: ArgDef[] = Object.entries(props).map(([name, p]) => ({ name, type: p.type, required: (a.input_schema.required ?? []).includes(name), description: p.description ?? '' }));
  return {
    key: a.key, name: a.name, description: a.description, kind: a.kind, args, subject_field: a.subject_field ?? '', amount_field: a.amount_field ?? '',
    requires_approval: !!a.requires_approval,
    via_service_id: a.via_service_id ?? '', via_app_name: a.via_app_name ?? '', via_action_version_id: a.via_action_version_id ?? '',
    via_action_name: a.via_action_name ?? '', input_template: a.input_template ?? {},
  };
}

export default function EditActionPage() {
  const { key } = useParams<{ key: string }>();
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/actions/${key}`).then((a) => setDraft(toDraft(a))).catch((e) => setError(e.message)); }, [key]);
  if (error) return <div className="p-8 text-bad">{error}</div>;
  if (!draft) return <div className="p-8 text-ink-3">Loading…</div>;
  return <ActionBuilder key={key} initial={draft} isNew={false} />;
}
