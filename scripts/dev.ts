import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { assertDisposableLocalDatabase } from './lib/local-database-guard';
import { redactSensitive, superviseProcesses } from './lib/process-supervisor';

const ROOT = resolve(import.meta.dir, '..');
const DEFAULT_DATABASE_URL = 'postgresql://flowkit_demo:flowkit_demo@localhost:5441/flowkit_demo';

interface RegistryConfigInput {
  npmrc: string;
  environment: Record<string, string | undefined>;
}

export function validatePackageRegistryConfig(input: RegistryConfigInput): void {
  const lines = input.npmrc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.includes('@naakwu:registry=https://npm.pkg.github.com')) {
    throw new Error('.npmrc must configure the exact @naakwu GitHub Packages registry.');
  }
  if (!lines.includes('//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}')) {
    throw new Error('.npmrc must read the registry credential from the NODE_AUTH_TOKEN variable.');
  }
  if (!lines.includes('always-auth=true')) {
    throw new Error('.npmrc must enable always-auth for the private package scope.');
  }

  const token = input.environment.NODE_AUTH_TOKEN;
  if (!token || token === 'replace-with-github-packages-read-token') {
    throw new Error('NODE_AUTH_TOKEN is required and must contain a GitHub Packages read credential.');
  }
}

async function runRequired(command: readonly string[], environment: Record<string, string | undefined>): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command[0]} ${command[1] ?? ''} exited with code ${code}.`);
}

function terminationSignal() {
  let onInterrupt!: () => void;
  let onTerminate!: () => void;
  const promise = new Promise<'SIGINT' | 'SIGTERM'>((resolveSignal) => {
    onInterrupt = () => resolveSignal('SIGINT');
    onTerminate = () => resolveSignal('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
  });
  return {
    promise,
    dispose: () => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    },
  };
}

async function main(): Promise<number> {
  const runtimeEnvironment = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    FLOWKIT_DEMO_ALLOW_SEED: 'true',
    FLOWKIT_DEMO_MIGRATION_APPROVED: 'true',
    FLOWKIT_DEMO_PERSISTENCE: 'true',
    DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    FLOWKIT_DEMO_PORT: process.env.FLOWKIT_DEMO_PORT ?? '3011',
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? 'flowkit-demo',
    TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? 'flowkit-demo',
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'flowkit-demo-local-secret-change-me-32-characters',
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
    SMTP_HOST: process.env.SMTP_HOST ?? 'localhost',
    SMTP_PORT: process.env.SMTP_PORT ?? '1025',
    MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
  };

  if (runtimeEnvironment.NODE_ENV !== 'development') {
    throw new Error('The local development orchestrator requires NODE_ENV=development.');
  }
  if (!Bun.which('docker')) throw new Error('Docker is required for the local dependency stack.');

  const npmrc = await readFile(resolve(ROOT, '.npmrc'), 'utf8');
  validatePackageRegistryConfig({ npmrc, environment: runtimeEnvironment });

  await runRequired(
    ['docker', 'compose', '-p', 'flowkit_demo', '-f', 'docker-compose.yml', 'up', '-d', '--wait'],
    runtimeEnvironment,
  );
  await assertDisposableLocalDatabase({ databaseUrl: runtimeEnvironment.DATABASE_URL });
  await runRequired(['bun', 'run', 'db:migrate'], runtimeEnvironment);
  await runRequired(['bun', 'run', 'db:seed'], runtimeEnvironment);

  const signals = terminationSignal();
  try {
    return await superviseProcesses({
      dependencies: [{
        name: 'disposable-postgres',
        check: async () => {
          try {
            await assertDisposableLocalDatabase({ databaseUrl: runtimeEnvironment.DATABASE_URL });
            return true;
          } catch {
            return false;
          }
        },
      }],
      children: [
        { name: 'api', command: ['bun', 'run', 'dev:api'], cwd: ROOT, env: runtimeEnvironment },
        { name: 'worker', command: ['bun', 'run', 'dev:worker'], cwd: ROOT, env: runtimeEnvironment },
        { name: 'notify', command: ['bun', 'run', 'dev:notify'], cwd: ROOT, env: runtimeEnvironment },
        { name: 'web', command: ['bun', 'run', 'dev:web'], cwd: ROOT, env: runtimeEnvironment },
      ],
      dependencyTimeoutMs: 10_000,
      termination: signals.promise,
      onStarted: () => {
        process.stdout.write([
          'FlowKit development services started:',
          '  Web:     http://localhost:5173/',
          '  API:     http://localhost:3011/health/ready',
          '  Mailpit: http://localhost:8025/',
          'Press Ctrl-C to stop application processes; dependency volumes are preserved.',
          '',
        ].join('\n'));
      },
    });
  } finally {
    signals.dispose();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const environment = [process.env];
    process.stderr.write(`${redactSensitive(error instanceof Error ? error.message : String(error), environment)}\n`);
    process.exitCode = 1;
  }
}
