import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { LeaveService } from '../leave/leave.service';
import { principalFromRequest } from '../auth/principal.adapters';

@Controller('leave') export class LeaveController {
  constructor(private readonly service: LeaveService) {}
  @Post() create(@Body() body: unknown, @Req() req: any) { const user = req.user ?? principalFromRequest(req, { id: 'employee-1', role: 'employee' }); return this.service.create(body, user.subjectId); }
  @Get(':id') async get(@Param('id') id: string) { const record = await this.service.get(id); return record ?? { error: 'not_found' }; }
  @Post(':id/submit') submit(@Param('id') id: string, @Req() req: any) { const user = req.user ?? principalFromRequest(req, { id: 'employee-1', role: 'employee' }); return this.service.command(id, { action: 'submit' }, { id: user.subjectId, roles: [user.role] }); }
  @Post(':id/action') action(@Param('id') id: string, @Body() body: { action?: string; comment?: string } | undefined, @Req() req: any) { if (!body?.action) throw new BadRequestException('action is required'); const user = req.user ?? principalFromRequest(req, { id: 'manager-1', role: 'manager' }); return this.service.command(id, { action: body.action, comment: body.comment }, { id: user.subjectId, roles: [user.role] }); }
}
