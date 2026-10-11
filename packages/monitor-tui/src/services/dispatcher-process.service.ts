import { spawn, type ChildProcess } from 'child_process';

const RESTART_TIMEOUT_MS = 60_000;

/**
 * Asks the supervising monitor.js process (SIGUSR2) to restart the dispatcher server, then
 * waits until the server answers again. `onSettled` gets an Error if that could not be done.
 * Only a supervisor that identified itself via MONITOR_SUPERVISOR_PID is ever signalled; when
 * the TUI was started on its own, the server is not ours to restart.
 */
export function restartDispatcherServer(
  healthUrl: string,
  onSettled: (error?: Error) => void,
  supervisorPid: string | undefined = process.env.MONITOR_SUPERVISOR_PID,
): void {
  const pid = Number(supervisorPid);
  if (!Number.isInteger(pid) || pid <= 0) {
    onSettled(new Error('Server was not started by `pnpm monitor`; restart it manually'));
    return;
  }

  try {
    process.kill(pid, 'SIGUSR2');
  } catch (error) {
    onSettled(error instanceof Error ? error : new Error(String(error)));
    return;
  }

  void waitForServer(healthUrl).then((up) =>
    onSettled(up ? undefined : new Error('Server did not come back after restart')),
  );
}

// The old server goes down, then the new one comes up. If it is never seen down (a very fast
// restart between polls), accept it answering after a short grace period.
async function waitForServer(healthUrl: string): Promise<boolean> {
  const started = Date.now();
  let sawDown = false;
  await new Promise((resolve) => setTimeout(resolve, 500));

  while (Date.now() - started < RESTART_TIMEOUT_MS) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok && (sawDown || Date.now() - started > 5_000)) return true;
    } catch {
      sawDown = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

export type RelayScript = 'connect-relay' | 'update-relay';

export function runRelayScript(
  script: RelayScript,
  args: string[],
  options: { cwd: string; onExit: () => void; onError: (error: Error) => void },
): ChildProcess {
  const child = spawn('pnpm', [script, ...args], {
    stdio: 'inherit',
    cwd: options.cwd,
  });

  child.on('exit', options.onExit);
  child.on('error', options.onError);

  return child;
}
