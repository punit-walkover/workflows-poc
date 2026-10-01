import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { one, q } from '../db';
import { ActionRow } from '../types';

// What viaSocket's builder posts back (window message) when a tool is published, updated, paused or deleted.
interface FlowEvent {
  id: string; action?: string; status?: string; title?: string; description?: string; webhookurl?: string;
  payload?: Record<string, unknown>;
  openaiToolJson?: { function?: { name?: string; description?: string; parameters?: any } };
  mcpToolJson?: { inputSchema?: any };
}

// The flow's tool schema as our input_schema; falls back to the sample payload's keys.
function toSchema(params: any, payload?: Record<string, unknown>) {
  const props: Record<string, any> = params?.properties ?? Object.fromEntries(Object.entries(payload ?? {}).map(([k, v]) => [k, { type: typeof v === 'number' ? 'number' : 'string' }]));
  const properties = Object.fromEntries(Object.entries(props).map(([k, p]) => [k, { type: p?.type || 'string', ...(p?.description ? { description: p.description } : {}) }]));
  return { type: 'object', properties, required: (params?.required ?? []).filter((r: string) => r in properties) };
}

// An @key from the flow's tool name, unique among actions.
async function freeKey(name: string) {
  let base = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 40) || 'flow';
  if (base.length < 2) base = `flow_${base}`;
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}_${i}`;
    if (!(await one('select 1 from action where key = $1', [key]))) return key;
  }
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
    await q(`delete from action where key = $1 and source in ('viasocket', 'viasocket_flow')`, [key]);
    return { ok: true };
  }

  // A flow event from the embedded viaSocket panel. published/updated → upsert the action, paused → disable, deleted → remove.
  @Post('from-flow')
  async fromFlow(@Body() f: FlowEvent) {
    if (!f?.id || !/^https:\/\/flow\.sokt\.io\/func\/[A-Za-z0-9_-]+$/.test(f.webhookurl ?? '')) throw new BadRequestException('not a viaSocket flow event');
    const cur = await one<ActionRow>('select * from action where via_flow_id = $1', [f.id]);
    if (f.action === 'deleted' || f.action === 'delete' || f.status === 'deleted') {
      if (!cur) return { ok: true };
      const used = await q(`select 1 from workflow where archived_at is null and $1 = any(action_keys)`, [cur.key]);
      await q(used.length ? `update action set enabled = false where key = $1` : `delete from action where key = $1`, [cur.key]);
      return { ok: true, key: cur.key, removed: !used.length };
    }
    const tool = f.openaiToolJson?.function;
    const schema = toSchema(tool?.parameters ?? f.mcpToolJson?.inputSchema, f.payload);
    const description = (tool?.description || f.description || f.title || 'viaSocket flow').trim();
    const enabled = f.status !== 'paused' && f.action !== 'paused';
    if (cur) {
      await q(`update action set name = $2, description = $3, input_schema = $4, via_flow_url = $5, enabled = $6 where key = $1`,
        [cur.key, f.title || cur.name, description, JSON.stringify(schema), f.webhookurl, enabled]);
      return this.get(cur.key);
    }
    const key = await freeKey(tool?.name || f.title || 'flow');
    // New flows need approval until someone decides they're safe to run on their own.
    await q(`insert into action (key, name, description, kind, input_schema, requires_approval, source, builtin, enabled, via_flow_id, via_flow_url)
             values ($1, $2, $3, 'write', $4, true, 'viasocket_flow', false, $5, $6, $7)`,
      [key, f.title || key, description, JSON.stringify(schema), enabled, f.id, f.webhookurl]);
    return this.get(key);
  }
}
