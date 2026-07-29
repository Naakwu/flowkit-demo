import { Controller, Get, Req } from '@nestjs/common';

import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Get()
  list(@Req() req: any) {
    return this.consumer.outbox.listForRecipient(req.user?.subjectId ?? 'employee-1');
  }
}
