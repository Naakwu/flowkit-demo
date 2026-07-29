import { describe, expect, it } from 'bun:test';
import { LeaveService } from '../src/leave/leave.service';

describe('reference leave workflow', () => {
  it('submits an eligible short leave and records task plus notification projections', async () => {
    const service = new LeaveService();
    const leave = await service.create({ managerId: 'manager-1', startDate: '2026-08-03', endDate: '2026-08-03', businessDays: 1, reason: 'Personal appointment', balanceDays: 10 }, 'employee-1');
    await service.command(leave.id, { action: 'submit' }, { id: 'employee-1', roles: ['employee'] });
    expect((await service.get(leave.id))?.state.stage).toBe('policy_evaluation');
    await service.command(leave.id, { action: 'auto_approve' }, { id: 'system', roles: ['system'] });
    await service.command(leave.id, { action: 'complete' }, { id: 'system', roles: ['system'] });
    expect((await service.get(leave.id))?.state.stage).toBe('approved');
    expect((await service.tasks.history((await service.tasks.inbox({ view: 'all' })).items[0]!.id)).length).toBeGreaterThan(0);
    expect((await service.listNotifications('employee-1')).length).toBeGreaterThan(0);
  });
});
