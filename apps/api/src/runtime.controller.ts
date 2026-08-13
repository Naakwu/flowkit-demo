import { Controller, Get, UseGuards } from '@nestjs/common';

import { DemoSessionGuard } from './auth/demo-session.guard';
import { loadConfig } from '@flowkit-demo/domain';
import { RuntimeHealthRepository } from '@flowkit-demo/database';

@Controller('runtime')
@UseGuards(DemoSessionGuard)
export class RuntimeController {
  constructor(private readonly health: RuntimeHealthRepository) {}

  @Get()
  async status() {
    const [flowkitRuntime, delivery] = await Promise.all([
      this.health.health('flowkit-runtime'),
      this.health.health('delivery-worker'),
    ]);
    return {
      mailpitUrl: loadConfig().MAILPIT_URL,
      flowkitRuntime: {
        ready: flowkitRuntime.ready,
        heartbeatAt: flowkitRuntime.heartbeatAt,
        checkedAt: flowkitRuntime.checkedAt,
      },
      delivery: {
        ready: delivery.ready,
        heartbeatAt: delivery.heartbeatAt,
        checkedAt: delivery.checkedAt,
      },
    };
  }
}
