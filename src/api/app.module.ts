import { Module } from '@nestjs/common';

import { DemoSessionGuard } from '../auth/demo-session.guard';
import { RuntimeHealthRepository } from '../db/runtime-health.repository';
import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';
import { AuthModule } from './auth.module';
import { FlowController } from './flow.controller';
import { HealthController } from './health.controller';
import { NotificationsController } from './notifications.controller';
import { RuntimeController } from './runtime.controller';
import { TasksController } from './tasks.controller';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, FlowController, TasksController, NotificationsController, RuntimeController],
  providers: [FlowkitDemoConsumer, RuntimeHealthRepository, DemoSessionGuard],
})
export class AppModule {}
