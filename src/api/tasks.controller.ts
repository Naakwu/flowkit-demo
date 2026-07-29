import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { LeaveService } from '../leave/leave.service';
@Controller('tasks') export class TasksController { constructor(private readonly service: LeaveService) {} @Get() list() { return this.service.listTasks(); } @Post(':id/claim') async claim(@Param('id') id: string, @Req() req: any) { const task = await this.service.tasks.get(id); if (!task) return { error: 'not_found' }; if (task.role !== 'manager') return { error: 'task_role_ineligible' }; return this.service.claim(task, req.user?.subjectId ?? 'manager-1'); } }
