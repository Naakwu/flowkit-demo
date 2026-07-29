import { describe, expect, it } from 'bun:test';
import type { RuleContext } from '@flowkit/temporal';

import { leaveRules } from '../src/leave/leave.registries';

describe('reference leave workflow automatic routing', () => {
  it('routes a short leave through the Flowkit rule without an HTTP system action', () => {
    const action = leaveRules.routeLeaveRequest.run({
      subject: { businessDays: 1 },
    } as unknown as RuleContext);

    expect(action).toBe('auto_approve');
    expect(leaveRules.completeFulfillment.run()).toBe('complete');
  });
});
