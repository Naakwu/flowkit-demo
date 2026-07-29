import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() { return { status: 'ok', service: 'flowkit-demo' }; }

  @Get('ready')
  ready() { return { status: 'ready', definition: 'leave-approval-demo@1' }; }
}
