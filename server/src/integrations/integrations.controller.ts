import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { one } from '../db';
import { setupSheetsDemo } from './sheets-demo';
import { catalog, embedToken, KNOWN_APPS, listConnections, listOptions, removeConnection, saveConnection } from './viasocket';

const fail = (e: any): never => { throw new BadRequestException(e?.message ?? String(e)); };

@Controller('integrations')
export class IntegrationsController {
  @Get('apps')
  async apps() {
    const conns = await listConnections();
    const demo = await one<{ value: unknown }>(`select value from app_setting where key = 'sheets_demo'`);
    const known = KNOWN_APPS.map((a) => ({ ...a, connected: conns.some((c) => c.service_id === a.service_id) }));
    const other = conns.filter((c) => !KNOWN_APPS.some((a) => a.service_id === c.service_id)).map((c) => ({ service_id: c.service_id, name: c.app_name, connected: true }));
    return { apps: [...known, ...other], sheets_demo: demo?.value ?? null };
  }

  // The browser needs this to open viaSocket's connect popup; signed server-side.
  @Get('token') async token() { return { token: await embedToken().catch(fail) }; }

  @Post('connections')
  async connect(@Body() b: { service_id: string; auth_id: string; app_name?: string }) {
    if (!b.service_id || !b.auth_id) throw new BadRequestException('service_id and auth_id are required');
    await saveConnection(b.service_id, b.auth_id, b.app_name || KNOWN_APPS.find((a) => a.service_id === b.service_id)?.name || b.service_id).catch(fail);
    return this.apps();
  }

  @Delete('connections/:serviceId')
  async disconnect(@Param('serviceId') serviceId: string) { await removeConnection(serviceId).catch(fail); return this.apps(); }

  @Get('apps/:serviceId/actions') actions(@Param('serviceId') serviceId: string) { return catalog(serviceId).catch(fail); }

  // Choices for one field of an app action, scoped by the values already filled in.
  @Post('options')
  options(@Body() b: { service_id: string; action_version_id: string; field_key: string; existing_fields?: Record<string, unknown> }) {
    return listOptions(b.service_id, b.action_version_id, b.field_key, b.existing_fields ?? {}).catch(fail);
  }

  @Post('sheets-demo') demo() { return setupSheetsDemo().catch(fail); }
}
