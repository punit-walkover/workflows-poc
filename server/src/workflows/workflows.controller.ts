import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { q } from '../db';
import { VARIABLES } from '../types';
import { TEMPLATES } from './templates';
import * as svc from './workflows.service';

@Controller()
export class WorkflowsController {
  @Get('workflows') list() { return svc.listWorkflows(); }
  @Get('workflows/templates') templates() { return TEMPLATES.map(({ key, name, when_to_use }) => ({ key, name, when_to_use })); }
  @Get('variables') variables() { return VARIABLES; }
  @Post('workflows') create(@Body() b: { template?: string; name?: string }) { return svc.createWorkflow(b ?? {}); }
  @Get('workflows/:id') get(@Param('id') id: string) { return svc.getWorkflow(id); }
  @Put('workflows/:id') save(@Param('id') id: string, @Body() b: any) { return svc.saveWorkflow(id, b); }
  @Post('workflows/:id/publish') publish(@Param('id') id: string) { return svc.publishWorkflow(id); }
  @Patch('workflows/:id') patch(@Param('id') id: string, @Body() b: any) { return svc.patchWorkflow(id, b); }
  @Delete('workflows/:id') archive(@Param('id') id: string) { return svc.archiveWorkflow(id); }

  @Get('orders') orders() { return q('select *, (current_date - delivered_at) as days_since_delivery from shop_order order by id'); }

  // Demo helper: undo refunds so scenarios can be replayed.
  @Post('demo/reset-orders')
  async resetOrders() { await q('update shop_order set refunded_minor = 0'); return { ok: true }; }
}
