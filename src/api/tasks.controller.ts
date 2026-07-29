import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '@flowkit/auth';

import { DemoSessionGuard } from '../auth/demo-session.guard';
import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';
import { asFlowkitHttpException } from './flowkit-http.errors';

type SessionRequest = { principal: AuthenticatedPrincipal };

@Controller('tasks')
@UseGuards(DemoSessionGuard)
export class TasksController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Get()
  async list(@Req() req: SessionRequest) {
    try {
      return (await this.consumer.tasks.list({ actor: { id: req.principal.subjectId, roles: [req.principal.role] } })).items;
    } catch (error) {
      throw asFlowkitHttpException(error);
    }
  }

  @Post(':id/claim')
  async claim(@Param('id') id: string, @Body() body: { expectedRevision?: unknown } | undefined, @Req() req: SessionRequest) {
    const expectedRevision = body?.expectedRevision;
    if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new BadRequestException('expectedRevision must be a non-negative integer.');
    }
    const task = await this.consumer.repository.tasks.get(id);
    if (!task) throw new NotFoundException('Task not found.');
    try {
      return await this.consumer.tasks.claim({
        taskId: task.id,
        expectedRevision,
        actor: { id: req.principal.subjectId, roles: [req.principal.role] },
        operationId: `claim:${task.id}:${req.principal.subjectId}:${randomUUID()}`,
      });
    } catch (error) {
      throw asFlowkitHttpException(error);
    }
  }
}
