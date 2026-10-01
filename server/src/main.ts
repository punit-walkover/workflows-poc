import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { AppModule } from './app.module';
import { config } from './config';
import { seedWorkflows } from './workflows/workflows.service';
import './runner/workflow'; // registers the DBOS workflow before launch

async function bootstrap() {
  // DBOS keeps its checkpoints in the same Postgres database (schema "dbos"); launch recovers unfinished runs.
  DBOS.setConfig({ name: 'workflows-poc', systemDatabaseUrl: config.databaseUrl, applicationVersion: 'poc-v1' });
  await DBOS.launch();
  await seedWorkflows();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '8mb' });
  app.enableCors({ origin: config.corsOrigins });
  await app.listen(config.port, '0.0.0.0');
  console.log(`workflows-poc server on http://localhost:${config.port}`);
}

bootstrap();
