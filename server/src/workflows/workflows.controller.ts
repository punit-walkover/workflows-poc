import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { VARIABLES } from '../types';
import * as svc from './workflows.service';

@Controller()
export class WorkflowsController {
  @Get('workflows') list() { return svc.listWorkflows(); }
  @Get('variables') variables() { return VARIABLES; }
  @Post('workflows') create(@Body() b: { name?: string }) { return svc.createWorkflow(b ?? {}); }
  @Get('workflows/:id') get(@Param('id') id: string) { return svc.getWorkflow(id); }
  @Put('workflows/:id') save(@Param('id') id: string, @Body() b: any) { return svc.saveWorkflow(id, b); }
  @Post('workflows/:id/publish') publish(@Param('id') id: string) { return svc.publishWorkflow(id); }
  @Post('workflows/:id/canvas') canvas(@Param('id') id: string) { return svc.toCanvas(id); }
  @Patch('workflows/:id') patch(@Param('id') id: string, @Body() b: any) { return svc.patchWorkflow(id, b); }
  @Delete('workflows/:id') archive(@Param('id') id: string) { return svc.archiveWorkflow(id); }
}
