import {
  All,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Module,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthError } from '@naakwu/flowkit-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';

import { auth } from './auth.config';
import {
  resolveOrganizationContext,
  type BetterAuthSession,
  type OrganizationContext,
} from './organization-context';

const betterAuthHandler = toNodeHandler(auth);

@Controller('api/auth')
export class BetterAuthController {
  @All('*path')
  handle(@Req() request: Request, @Res() response: Response) {
    return betterAuthHandler(request, response);
  }
}

type AuthenticatedRequest = Request & {
  principal?: OrganizationContext['principal'];
  organizationContext?: OrganizationContext;
};

export const ORGANIZATION_CONTEXT_PROVIDER = Symbol('ORGANIZATION_CONTEXT_PROVIDER');

export type OrganizationContextProvider = {
  resolve(headers: Headers): Promise<OrganizationContext | null>;
};

const organizationContextProvider: OrganizationContextProvider = {
  async resolve(headers) {
    const session = await auth.api.getSession({ headers });
    return session ? resolveOrganizationContext(session as BetterAuthSession) : null;
  },
};

@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(
    @Inject(ORGANIZATION_CONTEXT_PROVIDER)
    private readonly contexts: OrganizationContextProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    try {
      const organizationContext = await this.contexts.resolve(fromNodeHeaders(request.headers));
      if (!organizationContext) throw new UnauthorizedException('Authentication required.');
      request.organizationContext = organizationContext;
      request.principal = organizationContext.principal;
      return true;
    } catch (error) {
      if (error instanceof AuthError && error.code === 'unauthenticated') {
        throw new UnauthorizedException(error.message);
      }
      if (error instanceof AuthError) throw new ForbiddenException(error.message);
      throw error;
    }
  }
}

@Module({
  controllers: [BetterAuthController],
  providers: [
    OrganizationContextGuard,
    { provide: ORGANIZATION_CONTEXT_PROVIDER, useValue: organizationContextProvider },
  ],
  exports: [OrganizationContextGuard],
})
export class AuthModule {}
