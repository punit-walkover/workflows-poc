import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, createReadStream } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { one, q } from '../db';
import { postCustomerMessage } from './conversations';

const UPLOADS = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
mkdirSync(UPLOADS, { recursive: true });

@Controller()
export class PlaygroundController {
  @Get('conversations')
  list() {
    return q(`select c.*, (select status from workflow_run r where r.conversation_id = c.id order by started_at desc limit 1) as run_status,
                     (select text from message m where m.conversation_id = c.id and m.role <> 'system' order by created_at desc limit 1) as last_text,
                     (select count(*)::int from approval_task t where t.conversation_id = c.id and t.status = 'pending') as pending_approvals
              from conversation c order by c.created_at desc`);
  }

  @Post('conversations')
  create(@Body() b: { customer_name?: string; customer_email?: string }) {
    return one(`insert into conversation (customer_name, customer_email) values ($1, $2) returning *`,
      [b.customer_name?.trim() || 'Alex Kim', b.customer_email?.trim() || 'alex@example.com']);
  }

  // Everything the playground screen shows, in one poll.
  @Get('conversations/:id')
  async get(@Param('id') id: string) {
    const conversation = await one('select * from conversation where id = $1', [id]);
    if (!conversation) throw new NotFoundException();
    const messages = await q(`select m.*, coalesce(json_agg(json_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type))
                                filter (where a.id is not null), '[]') as attachments
                              from message m left join attachment a on a.id = any(m.attachment_ids)
                              where m.conversation_id = $1 group by m.id order by m.created_at`, [id]);
    const runs = await q(`select r.*, v.name as workflow_name, v.version, v.steps from workflow_run r
                          join workflow_version v on v.id = r.workflow_version_id
                          where r.conversation_id = $1 order by r.started_at desc`, [id]);
    const events = runs[0] ? await q('select * from run_event where run_id = $1 order by id', [runs[0].id]) : [];
    const approvals = await q(`select * from approval_task where conversation_id = $1 order by created_at desc`, [id]);
    const actionRuns = runs[0] ? await q('select * from action_run where run_id = $1 order by started_at', [runs[0].id]) : [];
    return { conversation, messages, runs, events, approvals, action_runs: actionRuns };
  }

  @Post('conversations/:id/messages')
  send(@Param('id') id: string, @Body() b: { text?: string; attachment_ids?: string[] }) {
    return postCustomerMessage(id, b);
  }

  // A teammate writes in the chat. It is part of the transcript but does not wake the run.
  @Post('conversations/:id/team-messages')
  async teamSend(@Param('id') id: string, @Body() b: { text?: string }) {
    if (!b.text?.trim()) throw new BadRequestException('empty message');
    return one(`insert into message (conversation_id, role, text) values ($1, 'team', $2) returning *`, [id, b.text.trim()]);
  }

  @Post('attachments')
  async upload(@Body() b: { conversation_id: string; file_name: string; mime_type: string; data_base64: string }) {
    const data = Buffer.from(b.data_base64 ?? '', 'base64');
    if (!data.length || data.length > 5_000_000) throw new BadRequestException('file must be 1 byte to 5 MB');
    const row = await one(`insert into attachment (conversation_id, file_name, mime_type, size_bytes, sha256, path)
                           values ($1, $2, $3, $4, $5, '') returning id`,
      [b.conversation_id, b.file_name, b.mime_type, data.length, createHash('sha256').update(data).digest('hex')]);
    const path = join(UPLOADS, row.id);
    writeFileSync(path, data);
    await q('update attachment set path = $2 where id = $1', [row.id, path]);
    return { id: row.id, file_name: b.file_name, mime_type: b.mime_type };
  }

  @Get('attachments/:id')
  async file(@Param('id') id: string, @Res() res: Response) {
    const a = await one('select * from attachment where id = $1', [id]);
    if (!a) throw new NotFoundException();
    res.setHeader('Content-Type', a.mime_type);
    createReadStream(a.path).pipe(res);
  }
}
