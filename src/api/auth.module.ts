import { BadRequestException, Body, Controller, Module, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { DemoSessionService } from '../auth/demo-session.service';

@Controller('auth')
export class DemoAuthController {
  constructor(private readonly sessions: DemoSessionService) {}

  @Post('login')
  async login(@Body() body: { userId?: unknown }, @Res({ passthrough: true }) response: Response) {
    if (typeof body?.userId !== 'string' || !body.userId) throw new BadRequestException('A demo user id is required.');
    const session = await this.sessions.create(body.userId);
    response.cookie('flowkit_demo_session', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    return { principal: session.principal };
  }
}

@Module({ controllers: [DemoAuthController], providers: [DemoSessionService], exports: [DemoSessionService] })
export class AuthModule {}
