import { createHmac, timingSafeEqual } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@flowkit/auth';
import type { Sql } from 'postgres';

import { loadConfig } from '../config';
import { createDemoDatabaseClient } from '../db/client';
import { principal } from './principal.adapters';
import { roleRegistry, type DemoRole } from './role-registry';

const sessionLifetimeMs = 24 * 60 * 60 * 1000;

type SessionPayload = { userId: string; role: DemoRole; expiresAt: string };
type UserRow = { id: string; role_key: string };

export type DemoSessionDependencies = {
  config: () => ReturnType<typeof loadConfig>;
  createDatabaseClient: (databaseUrl: string) => Sql;
  now: () => Date;
};

export const DEMO_SESSION_DEPENDENCIES = Symbol('DEMO_SESSION_DEPENDENCIES');

@Injectable()
export class DemoSessionService {
  private readonly dependencies: DemoSessionDependencies;

  constructor(@Optional() @Inject(DEMO_SESSION_DEPENDENCIES) dependencies?: Partial<DemoSessionDependencies>) {
    this.dependencies = {
      config: loadConfig,
      createDatabaseClient: createDemoDatabaseClient,
      now: () => new Date(),
      ...dependencies,
    };
  }

  async create(userId: string): Promise<{ token: string; principal: AuthenticatedPrincipal }> {
    const config = this.dependencies.config();
    if (!['development', 'test'].includes(config.NODE_ENV)) {
      throw new ForbiddenException('Demo sessions are available only in development and test environments.');
    }

    const sql = this.dependencies.createDatabaseClient(config.DATABASE_URL);
    try {
      const [user] = await sql<UserRow[]>`
        SELECT u.id, r.role_key
        FROM users u
        JOIN roles r ON r.role_key = u.role_key
        WHERE u.id = ${userId}
        LIMIT 1
      `;
      if (!user) throw new NotFoundException('Demo user not found.');
      if (!(user.role_key in roleRegistry.definitions)) {
        throw new UnauthorizedException('Demo user has an unrecognized role.');
      }

      const role = user.role_key as DemoRole;
      const expiresAt = new Date(this.dependencies.now().getTime() + sessionLifetimeMs).toISOString();
      return { token: this.sign({ userId: user.id, role, expiresAt }, config.BETTER_AUTH_SECRET), principal: principal(user.id, role) };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    const config = this.dependencies.config();
    const payload = this.read(token, config.BETTER_AUTH_SECRET);
    if (!payload || new Date(payload.expiresAt).getTime() <= this.dependencies.now().getTime()) {
      throw new UnauthorizedException('Demo session is invalid or expired.');
    }
    return principal(payload.userId, payload.role);
  }

  private sign(payload: SessionPayload, secret: string): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private read(token: string, secret: string): SessionPayload | null {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) return null;
    const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;

    try {
      const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
      if (typeof value.userId !== 'string' || typeof value.expiresAt !== 'string' || typeof value.role !== 'string') return null;
      if (!(value.role in roleRegistry.definitions) || Number.isNaN(new Date(value.expiresAt).getTime())) return null;
      return value as SessionPayload;
    } catch {
      return null;
    }
  }
}
