import { loadConfig } from '../config';
import { activities, validateWorkerRegistries } from './activities';
import { NativeConnection, Worker, bundleWorkflowCode } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';

export async function startWorker() {
  const config = loadConfig();
  validateWorkerRegistries();
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const workflowBundle = await bundleWorkflowCode({ workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)) });
  return Worker.create({ connection, namespace: config.TEMPORAL_NAMESPACE, taskQueue: config.TEMPORAL_TASK_QUEUE, workflowBundle, activities });
}

if (import.meta.main) {
  const worker = await startWorker();
  process.stdout.write('flowkit-demo Temporal worker ready\n');
  await worker.run();
}
