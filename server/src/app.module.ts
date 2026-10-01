import { Module } from '@nestjs/common';
import { ActionsController } from './actions/actions.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { PlaygroundController } from './playground/playground.controller';
import { WidgetController } from './playground/widget.controller';
import { RunsController } from './runner/runs.controller';
import { WorkflowsController } from './workflows/workflows.controller';

@Module({ controllers: [WorkflowsController, ActionsController, IntegrationsController, PlaygroundController, WidgetController, RunsController] })
export class AppModule {}
