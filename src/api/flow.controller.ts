import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ZodError } from 'zod';

import type { AuthenticatedPrincipal } from '@flowkit/auth';
import type { FlowkitConsumerView } from '@flowkit/consumer';

import { DemoSessionGuard } from '../auth/demo-session.guard';
import type { LeaveRequestRow } from '../db/leave-flow.repository';
import { FlowkitDemoConsumer, newLeaveFlowId } from '../flow/flowkit-demo.consumer';
import { leaveRequestSchema } from '../leave/leave.types';
import { asFlowkitHttpException } from './flowkit-http.errors';

type SessionRequest = { principal: AuthenticatedPrincipal };
type ActionBody = { action?: unknown; comment?: unknown };
const supportedActions = new Set(['submit', 'withdraw', 'approve', 'reject', 'return']);

@Controller('flows')
@UseGuards(DemoSessionGuard)
export class FlowController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Post()
  async create(@Body() body: unknown, @Req() req: SessionRequest) {
    const current = req.principal;
    if (current.role !== 'employee' || current.readOnly) throw new ForbiddenException('Only an employee can create a leave flow.');
    try {
      const request = leaveRequestSchema.parse({ ...(body as object), employeeId: current.subjectId });
      const id = newLeaveFlowId();
      const flowId = `flow-${id}`;
      const state = await this.consumer.start({
        flowId,
        subject: { id, metadata: request },
        actor: { id: current.subjectId, roles: [current.role] },
        operationId: `${id}:start:${randomUUID()}`,
      });
      return await this.project(id, state);
    } catch (error) {
      if (error instanceof ZodError) throw new BadRequestException(error.flatten());
      throw asFlowkitHttpException(error);
    }
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: SessionRequest) {
    const request = await this.requireVisibleRequest(id, req.principal);
    try {
      return await this.project(id, await this.consumer.getFlow(request.flow_id), request);
    } catch (error) {
      throw asFlowkitHttpException(error);
    }
  }

  /**
   * Every flow response uses one shape so the browser never has to know whether it created or
   * reloaded the flow. Keys mirror the persisted projection row, not the parsed request body.
   */
  private async project(id: string, state: FlowkitConsumerView, known?: LeaveRequestRow) {
    const request = known ?? await this.consumer.repository.getRequest(id);
    if (!request) throw new NotFoundException('Flow not found.');
    return {
      ...request,
      definitionHash: request.definition_hash,
      state: state.state,
      sequence: state.sequence,
      nextActions: state.nextActions,
      activities: await this.consumer.repository.listActivities(id),
    };
  }

  @Post(':id/actions')
  async action(@Param('id') id: string, @Body() body: ActionBody | undefined, @Req() req: SessionRequest) {
    if (typeof body?.action !== 'string' || !supportedActions.has(body.action)) {
      throw new BadRequestException('A supported Flowkit action is required.');
    }
    if (body.comment !== undefined && typeof body.comment !== 'string') throw new BadRequestException('Action comment must be a string.');

    const request = await this.requireVisibleRequest(id, req.principal);
    await this.authorizeAction(body.action, request, req.principal);
    try {
      return await this.consumer.act({
        flowId: request.flow_id,
        action: body.action,
        comment: body.comment,
        actor: { id: req.principal.subjectId, roles: [req.principal.role] },
        operationId: `${request.flow_id}:${body.action}:${randomUUID()}`,
      });
    } catch (error) {
      throw asFlowkitHttpException(error);
    }
  }

  private async requireVisibleRequest(id: string, current: AuthenticatedPrincipal) {
    const request = await this.consumer.repository.getRequest(id);
    if (!request) throw new NotFoundException('Flow not found.');
    const canView = (current.role === 'employee' && request.employee_id === current.subjectId)
      || (current.role === 'manager' && request.manager_id === current.subjectId)
      || current.role === 'hr'
      || current.role === 'readonly_auditor';
    if (!canView) throw new ForbiddenException('You cannot access this flow.');
    return request;
  }

  private async authorizeAction(action: string, request: { id: string; flow_id: string; employee_id: string; manager_id: string }, current: AuthenticatedPrincipal) {
    if (action === 'submit' || action === 'withdraw') {
      if (current.role !== 'employee' || current.readOnly || request.employee_id !== current.subjectId) {
        throw new ForbiddenException('Only the requesting employee can perform this action.');
      }
      return;
    }
    if (current.role !== 'manager' || current.readOnly || request.manager_id !== current.subjectId) {
      throw new ForbiddenException('Only the assigned manager can perform this action.');
    }
    const task = await this.consumer.repository.tasks.find({
      namespace: 'flowkit-demo', flowId: request.flow_id, subjectType: 'leave', subjectId: request.id,
      stage: 'manager_review', role: 'manager',
    });
    if (!task || task.status !== 'claimed' || task.assigneeId !== current.subjectId) {
      throw new ForbiddenException('The manager review task must be claimed by the current manager.');
    }
  }
}
