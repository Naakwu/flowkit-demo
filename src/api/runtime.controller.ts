import { Controller, Get, UseGuards } from '@nestjs/common';

import { DemoSessionGuard } from '../auth/demo-session.guard';
import { RuntimeHealthRepository } from '../db/runtime-health.repository';

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
      flowkitRuntime: { ready: flowkitRuntime.ready, checkedAt: flowkitRuntime.checkedAt },
      delivery: { ready: delivery.ready, checkedAt: delivery.checkedAt },
    };
  }
}
