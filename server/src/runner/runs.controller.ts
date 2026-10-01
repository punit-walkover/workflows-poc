import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { one, q } from '../db';
import { signal } from './run-control';

@Controller()
export class RunsController {
  // Teammate controls on a run: pause | resume | cancel | retry.
  @Post('runs/:id/:op')
  async control(@Param('id') id: string, @Param('op') op: string, @Body() b: { by?: string }) {
    const type = ({ pause: 'pause', resume: 'resume', cancel: 'cancel', retry: 'retry_step' } as const)[op as 'pause'];
    if (!type) throw new BadRequestException('unknown operation');
    await signal(id, { type, by: b?.by || 'teammate' }, `${op}:${id}:${Date.now()}`);
    return { ok: true };
  }

  // DBOS's own checkpoint history for a run (engineering view).
  @Get('runs/:id/dbos-steps')
  async dbosSteps(@Param('id') id: string) {
    const steps = await DBOS.listWorkflowSteps(`run:${id}`);
    return (steps ?? []).map((s: any) => ({ function_id: s.functionID, name: s.name, error: s.error ? String(s.error) : null,
      output: s.output, started_at: s.startedAtEpochMs, completed_at: s.completedAtEpochMs }));
  }

  @Get('approvals')
  approvals(@Query('status') status = 'pending') {
    return q(`select t.*, c.customer_name, c.customer_email, v.name as workflow_name,
                     coalesce((select json_agg(json_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type))
                               from attachment a where a.id::text in (select jsonb_array_elements_text(t.evidence->'attachment_ids'))), '[]') as attachments
              from approval_task t join conversation c on c.id = t.conversation_id
              join workflow_run r on r.id = t.run_id join workflow_version v on v.id = r.workflow_version_id
              where ($1 = 'all' or t.status = $1) order by t.created_at desc`, [status]);
  }

  @Post('approvals/:id/decide')
  async decide(@Param('id') id: string, @Body() b: { approved: boolean; note?: string; by?: string }) {
    const t = await one(`update approval_task set status = $2, decided_by = coalesce($3, 'Team'), decided_at = now(),
                           decision_note = $4 where id = $1 and status = 'pending' returning *`,
      [id, b.approved ? 'approved' : 'rejected', b.by?.trim() || null, b.note ?? null]);
    if (!t) throw new NotFoundException('task not pending');
    await signal(t.run_id, { type: 'approval_decision', taskId: id, approved: !!b.approved, by: t.decided_by, note: b.note }, `task:${id}`);
    return t;
  }
}
