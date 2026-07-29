import { Client, Connection } from '@temporalio/client';
import type { FlowRuntime } from '@flowkit/consumer';
import { createFlowkitTemporalRuntime } from '@flowkit/temporal';

import { loadConfig } from '../config';
import { leaveWorkflow } from '../worker/workflows';

const config = loadConfig();
const connection = Connection.lazy({ address: config.TEMPORAL_ADDRESS });
const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });

export const leaveRuntime: FlowRuntime = createFlowkitTemporalRuntime({
  client,
  taskQueue: config.TEMPORAL_TASK_QUEUE,
  workflowType: leaveWorkflow,
  async healthProbe() {
    const checkedAt = new Date().toISOString();

    try {
      await connection.ensureConnected();
      return { ready: true, checkedAt };
    } catch {
      return { ready: false, checkedAt };
    }
  },
});
