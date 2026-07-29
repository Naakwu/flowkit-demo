import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from '../config';
import { join } from 'node:path';
export async function createDemoApp() { const app = await NestFactory.create(AppModule); app.enableShutdownHooks(); return app; }
if (import.meta.main) { const config = loadConfig(); const app = await createDemoApp() as NestExpressApplication; app.useStaticAssets(join(import.meta.dir, '../../public'), { index: 'index.html' }); await app.listen(config.FLOWKIT_DEMO_PORT); process.stdout.write(`flowkit-demo listening on ${config.FLOWKIT_DEMO_PORT}\n`); }
