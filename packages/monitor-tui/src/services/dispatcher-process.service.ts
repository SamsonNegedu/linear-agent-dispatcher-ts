import { spawn, type ChildProcess } from 'child_process';

const SERVER_PROCESS_PATTERN = 'ts-node.*dispatcher-service/src/main.ts';

export function restartDispatcherServer(onError: (error: Error) => void): ChildProcess {
  const child = spawn('pkill', ['-f', SERVER_PROCESS_PATTERN]);
  child.on('error', onError);
  return child;
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
