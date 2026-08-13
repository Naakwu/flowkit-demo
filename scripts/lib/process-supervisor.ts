export type ProcessSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

export const EXIT_REQUIRED_CHILD = 1;
export const EXIT_DEPENDENCY_TIMEOUT = 70;

export interface ChildProcessSpec {
  name: string;
  command: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  required?: boolean;
}

export interface ChildProcessHandle {
  exited: Promise<number>;
  kill(signal: ProcessSignal): void;
}

export interface DependencySpec {
  name: string;
  check: () => Promise<boolean>;
}

export interface SupervisorOptions {
  children: readonly ChildProcessSpec[];
  dependencies?: readonly DependencySpec[];
  dependencyTimeoutMs?: number;
  pollIntervalMs?: number;
  spawn?: (spec: ChildProcessSpec) => ChildProcessHandle;
  sleep?: (milliseconds: number) => Promise<void>;
  termination?: Promise<'SIGINT' | 'SIGTERM'>;
  log?: (message: string) => void;
  onStarted?: () => void;
}

const SENSITIVE_ENV_KEY = /(TOKEN|SECRET|PASSWORD|COOKIE)/i;

function defaultSpawn(spec: ChildProcessSpec): ChildProcessHandle {
  const child = Bun.spawn([...spec.command], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return {
    exited: child.exited,
    kill: (signal) => child.kill(signal),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function redactSensitive(value: string, environments: readonly (Record<string, string | undefined> | undefined)[] = []): string {
  let redacted = value.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1[REDACTED]@');
  for (const environment of environments) {
    for (const [key, secret] of Object.entries(environment ?? {})) {
      if (SENSITIVE_ENV_KEY.test(key) && secret) redacted = redacted.split(secret).join('[REDACTED]');
    }
  }
  return redacted;
}

async function dependenciesAreHealthy(options: SupervisorOptions): Promise<boolean> {
  const timeout = options.dependencyTimeoutMs ?? 30_000;
  const interval = Math.max(1, options.pollIntervalMs ?? 250);
  const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));

  for (const dependency of options.dependencies ?? []) {
    let waited = 0;
    while (!(await dependency.check())) {
      if (waited >= timeout) return false;
      await sleep(Math.min(interval, timeout - waited));
      waited += interval;
    }
  }
  return true;
}

export async function superviseProcesses(options: SupervisorOptions): Promise<number> {
  const log = options.log ?? ((message) => process.stderr.write(`${message}\n`));
  const environments = options.children.map((child) => child.env);

  try {
    if (!(await dependenciesAreHealthy(options))) {
      log('A required dependency did not become healthy before the timeout.');
      return EXIT_DEPENDENCY_TIMEOUT;
    }
  } catch (error) {
    log(redactSensitive(`Dependency health check failed: ${errorText(error)}`, environments));
    return EXIT_DEPENDENCY_TIMEOUT;
  }

  const running: Array<{ spec: ChildProcessSpec; handle: ChildProcessHandle }> = [];
  try {
    for (const spec of options.children) running.push({ spec, handle: (options.spawn ?? defaultSpawn)(spec) });
  } catch (error) {
    log(redactSensitive(`Unable to start a required process: ${errorText(error)}`, environments));
    for (const child of running) child.handle.kill('SIGTERM');
    await Promise.allSettled(running.map((child) => child.handle.exited));
    return EXIT_REQUIRED_CHILD;
  }

  if (running.length === 0) return 0;
  options.onStarted?.();

  const requiredExit = Promise.race(
    running
      .filter(({ spec }) => spec.required !== false)
      .map(async (child) => ({ child, code: await child.handle.exited })),
  );
  const termination = options.termination?.then((signal) => ({ signal }));
  const outcome = await Promise.race([requiredExit, ...(termination ? [termination] : [])]);

  if ('signal' in outcome) {
    for (const child of running) child.handle.kill(outcome.signal);
    await Promise.allSettled(running.map((child) => child.handle.exited));
    return outcome.signal === 'SIGINT' ? 130 : 143;
  }

  for (const child of running) {
    if (child !== outcome.child) child.handle.kill('SIGTERM');
  }
  await Promise.allSettled(running.map((child) => child.handle.exited));
  return outcome.code === 0 ? EXIT_REQUIRED_CHILD : outcome.code;
}
