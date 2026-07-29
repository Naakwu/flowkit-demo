import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { HealthController } from './health.controller';
import { LeaveController } from './leave.controller';
import { TasksController } from './tasks.controller';
import { NotificationsController } from './notifications.controller';
import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';
@Module({ imports: [AuthModule], controllers: [HealthController, LeaveController, TasksController, NotificationsController], providers: [FlowkitDemoConsumer] }) export class AppModule {}
