import { createFlowkitWorkflow } from '@flowkit/temporal/workflow';
import { loadConfig } from '../config';
import { leaveGuards, leavePolicies, leaveRules } from '../leave/leave.registries';

const { TEMPORAL_TASK_QUEUE } = loadConfig();

export const leaveWorkflow = createFlowkitWorkflow({
  registries: { policies: leavePolicies, guards: leaveGuards, rules: leaveRules },
  activityTaskQueue: TEMPORAL_TASK_QUEUE,
});
