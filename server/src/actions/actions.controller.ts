import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { one, q } from '../db';
import { renderTemplate, templateArgs } from '../integrations/template';
import { runViaSocket, validateArgs } from './execute';
import { ActionRow } from '../types';

interface ArgDef { name: string; type: 'string' | 'integer' | 'number' | 'boolean'; required: boolean; description?: string }
interface ActionBody {
  key: string; name: string; description: string; kind: 'read' | 'write';
  args: ArgDef[]; subject_field?: string | null; amount_field?: string | null;
  requires_approval?: boolean;
  via_service_id: string; via_app_name?: string; via_action_version_id: string; via_action_name?: string;
  input_template: Record<string, unknown>;
}

// Custom actions: an app action from viaSocket + the args the model fills + an input template.
function toRow(b: ActionBody) {
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(b.key ?? '')) throw new BadRequestException('key: lowercase letters, digits and _, starting with a letter');
  if (!b.name?.trim() || !b.description?.trim()) throw new BadRequestException('name and description are required');
  if (!['read', 'write'].includes(b.kind)) throw new BadRequestException('kind must be read or write');
  if (!b.via_service_id || !b.via_action_version_id) throw new BadRequestException('pick an app and an app action');
  if (!b.input_template || typeof b.input_template !== 'object' || Array.isArray(b.input_template)) throw new BadRequestException('input template must be a JSON object');
  const names = (b.args ?? []).map((a) => a.name);
  if (names.some((n) => !/^[a-z][a-z0-9_]*$/.test(n))) throw new BadRequestException('argument names: lowercase letters, digits and _');
  const undeclared = templateArgs(b.input_template).filter((n) => !names.includes(n));
  if (undeclared.length) throw new BadRequestException(`template uses undeclared args: ${undeclared.join(', ')}`);
  for (const f of [b.subject_field, b.amount_field]) if (f && !names.includes(f)) throw new BadRequestException(`${f} is not one of the args`);
  const properties = Object.fromEntries((b.args ?? []).map((a) => [a.name, { type: a.type, ...(a.description ? { description: a.description } : {}) }]));
  return [b.key, b.name.trim(), b.description.trim(), b.kind,
    JSON.stringify({ type: 'object', properties, required: (b.args ?? []).filter((a) => a.required).map((a) => a.name) }),
    b.subject_field || null, b.amount_field || null, !!b.requires_approval, b.via_service_id, b.via_app_name || null, b.via_action_version_id,
    b.via_action_name || null, JSON.stringify(b.input_template)];
}

@Controller('actions')
export class ActionsController {
  @Get() list() { return q('select * from action order by source, created_at, key'); }

  @Get(':key')
  async get(@Param('key') key: string) {
    const a = await one('select * from action where key = $1', [key]);
    if (!a) throw new NotFoundException();
    return a;
  }

  @Post()
  async create(@Body() b: ActionBody) {
    if (await one('select 1 from action where key = $1', [b.key])) throw new BadRequestException(`@${b.key} already exists`);
    await q(`insert into action (key, name, description, kind, input_schema, subject_field, amount_field, requires_approval,
               via_service_id, via_app_name, via_action_version_id, via_action_name, input_template, source, builtin, enabled)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'viasocket',false,true)`, toRow(b));
    return this.get(b.key);
  }

  @Put(':key')
  async update(@Param('key') key: string, @Body() b: ActionBody) {
    const cur = await one<ActionRow>('select * from action where key = $1', [key]);
    if (!cur || cur.source !== 'viasocket') throw new BadRequestException('only viaSocket actions can be edited');
    const [, ...rest] = toRow({ ...b, key });
    await q(`update action set name=$2, description=$3, kind=$4, input_schema=$5, subject_field=$6, amount_field=$7, requires_approval=$8,
               via_service_id=$9, via_app_name=$10, via_action_version_id=$11, via_action_name=$12, input_template=$13 where key = $1`, [key, ...rest]);
    return this.get(key);
  }

  @Patch(':key')
  async patch(@Param('key') key: string, @Body() b: { enabled?: boolean; requires_approval?: boolean }) {
    await q(`update action set enabled = coalesce($2, enabled), requires_approval = coalesce($3, requires_approval) where key = $1`,
      [key, b.enabled ?? null, b.requires_approval ?? null]);
    return this.get(key);
  }

  @Delete(':key')
  async remove(@Param('key') key: string) {
    const used = await q(`select name from workflow where archived_at is null and $1 = any(action_keys)`, [key]);
    if (used.length) throw new BadRequestException(`used by: ${used.map((w) => w.name).join(', ')}`);
    await q(`delete from action where key = $1 and source = 'viasocket'`, [key]);
    return { ok: true };
  }

  // Dry run with sample args: shows the exact inputData sent and the app's raw response. Not logged as a run.
  @Post(':key/test')
  async test(@Param('key') key: string, @Body() b: { args: Record<string, unknown> }) {
    const a = await one<ActionRow>('select * from action where key = $1', [key]);
    if (!a || a.source !== 'viasocket') throw new BadRequestException('only viaSocket actions can be tested here');
    const v = validateArgs(a, b.args);
    if (!v.ok) throw new BadRequestException(v.error);
    const inputData = renderTemplate(a.input_template ?? {}, v.args);
    try { return { ok: true, inputData, result: await runViaSocket(a, v.args) }; }
    catch (e: any) { return { ok: false, inputData, error: e.message, body: e.body ?? null }; }
  }
}
