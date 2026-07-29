import { createFlowkitWorkflow } from '@flowkit/temporal/workflow';
import { loadConfig } from '../config';
import { leavePolicies, leaveGuards } from '../leave/leave.definition';

const { TEMPORAL_TASK_QUEUE } = loadConfig();

export const leaveWorkflow = createFlowkitWorkflow({
  registries: { policies: leavePolicies, guards: leaveGuards, rules: {} },
  activityTaskQueue: TEMPORAL_TASK_QUEUE,
});
