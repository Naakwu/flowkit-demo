import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '@flowkit/auth';

import { DemoSessionGuard } from '../auth/demo-session.guard';
import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';

@Controller('notifications')
@UseGuards(DemoSessionGuard)
export class NotificationsController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Get()
  list(@Req() req: { principal: AuthenticatedPrincipal }) {
    return this.consumer.outbox.listForRecipient(req.principal.subjectId);
  }
}
