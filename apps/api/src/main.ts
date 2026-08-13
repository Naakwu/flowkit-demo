import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';

import { loadConfig } from '@flowkit-demo/domain';

import { AppModule } from './app.module';
export async function createDemoApp() { const app = await NestFactory.create(AppModule); app.enableShutdownHooks(); return app; }
if (import.meta.main) { const config = loadConfig(); const app = await createDemoApp() as NestExpressApplication; app.useStaticAssets(join(import.meta.dir, '../../web/src'), { index: 'index.html' }); await app.listen(config.FLOWKIT_DEMO_PORT); process.stdout.write(`flowkit-demo listening on ${config.FLOWKIT_DEMO_PORT}\n`); }
