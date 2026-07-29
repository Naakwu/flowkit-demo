import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '@flowkit/auth';

import { DemoSessionGuard } from '../auth/demo-session.guard';
import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';

@Controller('notifications')
@UseGuards(DemoSessionGuard)
export class NotificationsController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Get()
  async list(@Req() req: { principal: AuthenticatedPrincipal }) {
    const userId = req.principal.subjectId;
    const [inbox, deliveries] = await Promise.all([
      this.consumer.inbox.forUser(userId),
      this.consumer.outbox.listForRecipient(userId),
    ]);
    return { inbox, deliveries };
  }
}
