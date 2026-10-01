import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { one, q, tx } from '../db';
import { WorkflowNode } from '../types';
import { TEMPLATES } from './templates';
import { validateWorkflow } from './validator';

const enabledActionKeys = async () => (await q<{ key: string }>('select key from action where enabled')).map((r) => r.key);

export async function listWorkflows() {
  return q(`select w.id, w.name, w.when_to_use, w.enabled, w.step_count, w.has_unpublished_changes,
                   w.updated_at, v.version as published_version
            from workflow w left join workflow_version v on v.id = w.published_version_id
            where w.archived_at is null order by w.created_at`);
}

export async function getWorkflow(id: string) {
  const w = await one(`select w.*, v.version as published_version from workflow w
                       left join workflow_version v on v.id = w.published_version_id
                       where w.id = $1 and w.archived_at is null`, [id]);
  if (!w) throw new NotFoundException('workflow not found');
  return { ...w, validation: validateWorkflow(w.steps, await enabledActionKeys()) };
}

export async function createWorkflow(body: { template?: string; name?: string }) {
  const tpl = TEMPLATES.find((t) => t.key === body.template);
  const base = body.name?.trim() || tpl?.name || 'Untitled workflow';
  const taken = await q<{ name: string }>('select name from workflow where name like $1 and archived_at is null', [`${base}%`]);
  const name = taken.some((r) => r.name === base) ? `${base} ${taken.length + 1}` : base;
  const steps: WorkflowNode[] = tpl?.steps ?? [{ id: rid(), type: 'step', content: [] }];
  const v = validateWorkflow(steps, await enabledActionKeys());
  const row = await one(`insert into workflow (name, when_to_use, steps, action_keys, step_count, template)
                         values ($1, $2, $3, $4, $5, $6) returning id`,
    [name, tpl?.when_to_use ?? '', JSON.stringify(steps), v.action_keys, v.step_count, tpl?.key ?? null]);
  return getWorkflow(row.id);
}

export async function saveWorkflow(id: string, body: { name: string; when_to_use: string; steps: WorkflowNode[]; row_version: number }) {
  if (!body.name?.trim()) throw new BadRequestException('name is required');
  const v = validateWorkflow(body.steps, await enabledActionKeys());
  const row = await one(`update workflow set name = $2, when_to_use = $3, steps = $4, action_keys = $5, step_count = $6,
                           has_unpublished_changes = true, row_version = row_version + 1, updated_at = now()
                         where id = $1 and row_version = $7 and archived_at is null returning id`,
    [id, body.name.trim(), body.when_to_use ?? '', JSON.stringify(body.steps), v.action_keys, v.step_count, body.row_version]);
  if (!row) throw new ConflictException('This workflow changed elsewhere — reload to see the latest version.');
  return getWorkflow(id);
}

// Freezes the draft as the next version; new runs use it, running ones keep theirs.
export async function publishWorkflow(id: string) {
  const w = await getWorkflow(id);
  if (w.validation.issues.length) throw new BadRequestException({ message: 'Fix these before publishing', issues: w.validation.issues });
  await tx(async (c) => {
    const next = (await c.query('select coalesce(max(version), 0) + 1 as n from workflow_version where workflow_id = $1', [id])).rows[0].n;
    const ver = (await c.query(`insert into workflow_version (workflow_id, version, name, when_to_use, steps, action_keys)
                                values ($1, $2, $3, $4, $5, $6) returning id`,
      [id, next, w.name, w.when_to_use, JSON.stringify(w.steps), w.action_keys])).rows[0].id;
    await c.query(`update workflow set published_version_id = $2, has_unpublished_changes = false, enabled = true,
                     updated_at = now() where id = $1`, [id, ver]);
  });
  return getWorkflow(id);
}

export async function patchWorkflow(id: string, body: { enabled?: boolean }) {
  const w = await getWorkflow(id);
  if (body.enabled && !w.published_version_id) throw new BadRequestException('Publish the workflow before enabling it');
  await q(`update workflow set enabled = coalesce($2, enabled), updated_at = now() where id = $1`, [id, body.enabled ?? null]);
  return getWorkflow(id);
}

export async function archiveWorkflow(id: string) {
  await q('update workflow set archived_at = now(), enabled = false where id = $1', [id]);
  return { ok: true };
}

// Demo data: publish both templates on first boot.
export async function seedWorkflows() {
  if (await one('select 1 from workflow limit 1')) return;
  for (const tpl of TEMPLATES) {
    const w = await createWorkflow({ template: tpl.key });
    await publishWorkflow(w.id);
  }
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}
