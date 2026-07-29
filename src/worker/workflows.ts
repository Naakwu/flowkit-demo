import { createFlowkitWorkflow } from '@flowkit/temporal/workflow';
import { leaveDefinition, leavePolicies, leaveGuards } from '../leave/leave.definition';
export const leaveWorkflow = createFlowkitWorkflow({ registries: { policies: leavePolicies, guards: leaveGuards, rules: {}, steps: {} } as any, activityTaskQueue: 'flowkit-demo' });
