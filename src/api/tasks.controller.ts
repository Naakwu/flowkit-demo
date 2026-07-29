import { Controller, Get, Param, Post, Req } from '@nestjs/common';

import { principalFromRequest } from '../auth/principal.adapters';
import { FlowkitDemoConsumer } from '../flow/flowkit-demo.consumer';

@Controller('tasks')
export class TasksController {
  constructor(private readonly consumer: FlowkitDemoConsumer) {}

  @Get()
  list(@Req() req: any) {
    const user = req.user ?? principalFromRequest(req, { id: 'manager-1', role: 'manager' });
    return this.consumer.tasks.list({ actor: { id: user.subjectId, roles: [user.role] } });
  }

  @Post(':id/claim')
  async claim(@Param('id') id: string, @Req() req: any) {
    const user = req.user ?? principalFromRequest(req, { id: 'manager-1', role: 'manager' });
    const task = await this.consumer.repository.tasks.get(id);
    if (!task) return { error: 'not_found' };
    return this.consumer.tasks.claim({
      taskId: task.id,
      expectedRevision: task.revision,
      actor: { id: user.subjectId, roles: [user.role] },
      operationId: `claim:${task.id}:${user.subjectId}`,
    });
  }
}
