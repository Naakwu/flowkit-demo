import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';

import { principalFromRequest } from '../auth/principal.adapters';
import { FlowkitDemoConsumer, newLeaveFlowId } from '../flow/flowkit-demo.consumer';
import { leaveRequestSchema } from '../leave/leave.types';

@Controller('leave')
export class LeaveController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Post()
  async create(@Body() body: unknown, @Req() req: any) {
    const user = req.user ?? principalFromRequest(req, { id: 'employee-1', role: 'employee' });
    const id = newLeaveFlowId();
    const request = leaveRequestSchema.parse({ ...(body as object), employeeId: user.subjectId });
    const flowId = `flow-${id}`;
    const state = await this.consumer.start({
      flowId,
      subject: { id, metadata: request },
      actor: { id: user.subjectId, roles: [user.role] },
      operationId: `${id}:start`,
    });
    return { id, flowId, ...request, state: state.state, sequence: state.sequence };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const request = await this.consumer.repository.getRequest(id);
    if (!request) return { error: 'not_found' };
    const state = await this.consumer.getFlow(request.flow_id);
    return { ...request, state: state.state, sequence: state.sequence };
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @Req() req: any) {
    const user = req.user ?? principalFromRequest(req, { id: 'employee-1', role: 'employee' });
    const request = await this.requireRequest(id);
    return this.consumer.act({ flowId: request.flow_id, action: 'submit', actor: { id: user.subjectId, roles: [user.role] }, operationId: `${request.flow_id}:submit` });
  }

  @Post(':id/action')
  async action(@Param('id') id: string, @Body() body: { action?: string; comment?: string } | undefined, @Req() req: any) {
    if (!body?.action) throw new BadRequestException('action is required');
    const user = req.user ?? principalFromRequest(req, { id: 'manager-1', role: 'manager' });
    const request = await this.requireRequest(id);
    return this.consumer.act({ flowId: request.flow_id, action: body.action, comment: body.comment, actor: { id: user.subjectId, roles: [user.role] }, operationId: `${request.flow_id}:${body.action}` });
  }

  private async requireRequest(id: string) {
    const request = await this.consumer.repository.getRequest(id);
    if (!request) throw new BadRequestException('leave_not_found');
    return request;
  }
}
