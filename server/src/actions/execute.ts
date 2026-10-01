import { one, q, tx } from '../db';
import { runAppAction } from '../integrations/viasocket';
import { renderTemplate } from '../integrations/template';
import { ActionRow } from '../types';

export async function getAction(key: string): Promise<ActionRow | null> {
  return one<ActionRow>('select * from action where key = $1', [key]);
}

// Required fields present and of the right type; numeric strings are coerced for integer fields.
export function validateArgs(action: ActionRow, raw: Record<string, unknown> | undefined) {
  const args: Record<string, unknown> = { ...(raw ?? {}) };
  for (const [name, spec] of Object.entries(action.input_schema.properties)) {
    const v = args[name];
    if (v === undefined || v === null || v === '') { delete args[name]; continue; }
    if (spec.type === 'integer') {
      const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
      if (!Number.isInteger(n)) return { ok: false as const, error: `${name} must be an integer` };
      args[name] = n;
    } else if (spec.type === 'string') args[name] = String(v);
  }
  const missing = (action.input_schema.required ?? []).filter((r) => args[r] === undefined);
  if (missing.length) return { ok: false as const, error: `missing ${missing.join(', ')}` };
  return { ok: true as const, args };
}

export type ExecResult = { ok: true; result: any; actionRunId: string } | { ok: false; error: string; actionRunId?: string };

// Runs an action once per idempotency key ('<runId>:<nodeId>:<visit>'); a repeat returns the stored result.
export async function executeAction(action: ActionRow, args: Record<string, any>, ctx: {
  runId: string; nodeId: string; mode: 'auto' | 'approved'; taskId?: string; visit: number;
}): Promise<ExecResult> {
  const key = `${ctx.runId}:${ctx.nodeId}:${ctx.visit}`;
  await q(`insert into action_run (action_key, run_id, node_id, idempotency_key, mode, approval_task_id, args, subject_ref, amount_minor, visit)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (idempotency_key) do nothing`,
    [action.key, ctx.runId, ctx.nodeId, key, ctx.mode, ctx.taskId ?? null, JSON.stringify(args),
     action.subject_field ? String(args[action.subject_field] ?? '') : null,
     action.amount_field ? args[action.amount_field] ?? null : null, ctx.visit]);
  const prior = await one('select id, status, result from action_run where idempotency_key = $1', [key]);
  if (prior.status === 'succeeded') return { ok: true, result: prior.result, actionRunId: prior.id };
  // A retry after failure may carry corrected args.
  if (prior.status === 'failed') await q(`update action_run set args = $2, status = 'running' where id = $1`, [prior.id, JSON.stringify(args)]);

  try {
    const result = await tx(async (c) => {
      const locked = (await c.query('select status, result from action_run where id = $1 for update', [prior.id])).rows[0];
      if (locked.status === 'succeeded') return locked.result;
      const out = action.source === 'viasocket' ? await runViaSocket(action, args) : await HANDLERS[action.key]?.(c, args);
      if (!out) throw new Error(`no handler for ${action.key}`);
      await c.query(`update action_run set status = 'succeeded', result = $2, error = null, finished_at = now() where id = $1`, [prior.id, JSON.stringify(out)]);
      return out;
    });
    return { ok: true, result, actionRunId: prior.id };
  } catch (e: any) {
    await q(`update action_run set status = 'failed', error = $2, finished_at = now() where id = $1`, [prior.id, e.message]);
    return { ok: false, error: e.message, actionRunId: prior.id };
  }
}

// Mock shop handlers (viaSocket flows in the real product). They run inside the action_run lock.
const HANDLERS: Record<string, (c: any, args: any) => Promise<any>> = {
  async lookup_order(c, args) {
    const o = (await c.query(`select *, to_char(delivered_at, 'YYYY-MM-DD') as delivered_on,
                                (current_date - delivered_at) as days_since_delivery from shop_order where id = $1`,
      [String(args.order_id).replace(/^#/, '')])).rows[0];
    if (!o) return { found: false, reason: 'No order with that ID' };
    if (args.email && o.customer_email.toLowerCase() !== String(args.email).toLowerCase())
      return { found: false, reason: 'Order ID and email do not match' };
    return {
      found: true, order_id: o.id, customer_name: o.customer_name, delivered_at: o.delivered_on,
      days_since_delivery: Number(o.days_since_delivery), currency: o.currency, items: o.items,
      total_minor: Number(o.total_minor), refunded_minor: Number(o.refunded_minor),
      refundable_minor: Number(o.total_minor) - Number(o.refunded_minor),
    };
  },
  async refund_order(c, args) {
    const r = await c.query(`update shop_order set refunded_minor = refunded_minor + $2
                             where id = $1 and refunded_minor + $2 <= total_minor returning total_minor, refunded_minor, currency`,
      [String(args.order_id), args.amount_minor]);
    if (!r.rowCount) throw new Error('Refund exceeds the refundable amount');
    return { refund_id: `re_${Math.random().toString(36).slice(2, 8)}`, order_id: String(args.order_id),
             amount_minor: args.amount_minor, currency: r.rows[0].currency };
  },
};

// A viaSocket-backed action: fill its input template with the args and run the app action.
export async function runViaSocket(action: ActionRow, args: Record<string, unknown>) {
  const inputData = renderTemplate(action.input_template ?? {}, args) as Record<string, unknown>;
  const out: any = await runAppAction(action.via_service_id!, action.via_action_version_id!, inputData);
  if (out && typeof out === 'object' && out.success === false && !Array.isArray(out.data)) throw new Error(out.message || 'app action failed');
  return out ?? {};
}
