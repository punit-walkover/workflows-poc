import { BadRequestException } from '@nestjs/common';
import { one, q } from '../db';
import { onCustomerMessage } from '../runner/run-control';

// A customer message from any channel (playground or widget). Routing / resuming runs in the background; screens poll.
export async function postCustomerMessage(conversationId: string, b: { text?: string; attachment_ids?: string[] }) {
  if (!b.text?.trim() && !b.attachment_ids?.length) throw new BadRequestException('empty message');
  const m = await one(`insert into message (conversation_id, role, text, attachment_ids) values ($1, 'customer', $2, $3) returning *`,
    [conversationId, b.text?.trim() ?? '', b.attachment_ids ?? []]);
  onCustomerMessage(conversationId, m.id).catch(async (e) => {
    await q(`insert into message (conversation_id, role, text) values ($1, 'system', $2)`, [conversationId, `Error: ${e.message}`]);
  });
  return m;
}
