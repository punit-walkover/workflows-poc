import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { one, q } from '../db';
import { postCustomerMessage } from './conversations';

// Public API for the embeddable chat widget: only what a customer may see (no runs, events or approvals).
@Controller('widget')
export class WidgetController {
  @Post('conversations')
  start(@Body() b: { name?: string; email?: string }) {
    if (!b.email?.includes('@')) throw new BadRequestException('a valid email is required');
    return one(`insert into conversation (customer_name, customer_email, channel) values ($1, $2, 'widget') returning id, customer_name`,
      [b.name?.trim() || b.email.split('@')[0], b.email.trim().toLowerCase()]);
  }

  @Get('conversations/:id')
  async get(@Param('id') id: string) {
    const conversation = await one(`select id, customer_name from conversation where id = $1 and channel = 'widget'`, [id]);
    if (!conversation) throw new NotFoundException();
    const messages = await q(`select m.id, m.role, m.text, m.created_at,
                                coalesce(json_agg(json_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type))
                                  filter (where a.id is not null), '[]') as attachments
                              from message m left join attachment a on a.id = any(m.attachment_ids)
                              where m.conversation_id = $1 and m.role <> 'system' group by m.id order by m.created_at`, [id]);
    const run = await one<{ status: string }>('select status from workflow_run where conversation_id = $1 order by started_at desc limit 1', [id]);
    // "Typing" while the bot still owes a reply to the last customer message.
    const last = messages[messages.length - 1];
    const typing = last?.role === 'customer' && !['waiting_approval', 'escalated', 'paused'].includes(run?.status ?? '');
    return { conversation, messages, typing, waiting_approval: run?.status === 'waiting_approval' };
  }

  @Post('conversations/:id/messages')
  async send(@Param('id') id: string, @Body() b: { text?: string; attachment_ids?: string[] }) {
    if (!(await one(`select 1 from conversation where id = $1 and channel = 'widget'`, [id]))) throw new NotFoundException();
    const m = await postCustomerMessage(id, b);
    return { id: m.id };
  }
}
