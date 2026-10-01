import { BadRequestException, Controller, Get } from '@nestjs/common';
import { builderToken } from './viasocket';

const fail = (e: any): never => { throw new BadRequestException(e?.message ?? String(e)); };

@Controller('integrations')
export class IntegrationsController {
  // For viaSocket's tool builder (window.openViasocket): connections and tools are managed inside it.
  @Get('builder-token') builder() { try { return { token: builderToken() }; } catch (e) { return fail(e); } }
}
