import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { DemoSessionService } from './demo-session.service';

function sessionToken(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('flowkit_demo_session='));
  return match ? decodeURIComponent(match.slice('flowkit_demo_session='.length)) : null;
}

@Injectable()
export class DemoSessionGuard implements CanActivate {
  constructor(private readonly sessions: DemoSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers?: { cookie?: string }; principal?: unknown }>();
    const token = sessionToken(request.headers?.cookie);
    if (!token) throw new UnauthorizedException('A valid demo session is required.');
    request.principal = await this.sessions.verify(token);
    return true;
  }
}
