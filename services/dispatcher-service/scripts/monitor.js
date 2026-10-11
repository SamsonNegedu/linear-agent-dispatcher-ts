// Boots the dispatcher server with its logs redirected to a file, waits for it
// to become healthy, then execs the OpenTUI monitor with the real inherited
// terminal. Running both under `concurrently` instead corrupts the TUI: it
// pipes child stdout through a non-tty stream, and OpenTUI needs raw terminal
// control that a piped stream can't provide.
//
// This process also supervises the server: the TUI's Ctrl+R sends it SIGUSR2, which
// restarts the server in place while the TUI stays up.
const { spawn } = require('child_process');
const path = require('path');

const dispatcherDir = path.join(__dirname, '..');
const tuiDir = path.join(dispatcherDir, '..', '..', 'packages', 'monitor-tui');
const logFile = path.join(dispatcherDir, 'logs', 'server.log');
const port = process.env.PORT || '3000';
const healthUrl = `http://localhost:${port}/monitor/summary`;

(async () => {
  // Shared with scripts/dev-up.mjs: starts a service in its own process group so that
  // stopping it also stops the node process under `npx` (killing only the wrapper
  // would leave the server running and holding the port).
  const { startService, killGroup, waitForHttp, waitForHttpDown } = await import(
    '../../../scripts/lib/stack.mjs'
  );

  console.log(`Starting dispatcher server (logs: ${logFile})...`);

  let tui = null;
  let server = null;
  let shuttingDown = false;
  let restarting = false;

  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (tui && !tui.killed) tui.kill();
    killGroup(server);
    process.exit(code);
  };

  const launchServer = () => {
    const child = startService({
      command: 'npx',
      args: ['ts-node', 'src/main.ts'],
      cwd: dispatcherDir,
      logFile,
      onExit: (code) => {
        if (child !== server || restarting || shuttingDown) return; // expected stop
        if (!tui) {
          console.error(`Server exited before becoming healthy (code ${code}). Check ${logFile}`);
          process.exit(code ?? 1);
        }
        console.error(`Server exited unexpectedly (code ${code}). Check ${logFile}`);
        shutdown(code ?? 1);
      },
    });
    server = child;
    return child;
  };

  const waitHealthy = () =>
    waitForHttp(healthUrl, {
      timeoutMs: 30_000,
      accept: (res) => res.ok,
      isAlive: () => !shuttingDown,
    });

  const restartServer = async () => {
    if (restarting || shuttingDown) return;
    restarting = true;
    try {
      const old = server;
      killGroup(old);
      // The port must be free before the new server binds it; escalate if it lingers.
      if (!(await waitForHttpDown(healthUrl, { timeoutMs: 10_000 }))) {
        killGroup(old, 'SIGKILL');
        await waitForHttpDown(healthUrl, { timeoutMs: 5_000 });
      }
      launchServer();
      if (!(await waitHealthy())) {
        console.error(`Server did not become healthy after restart. Check ${logFile}`);
        shutdown(1);
      }
    } finally {
      restarting = false;
    }
  };

  launchServer();

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGUSR2', () => void restartServer());

  if (!(await waitHealthy())) {
    console.error(`Server did not become healthy within 30s. Check ${logFile}`);
    shutdown(1);
    return;
  }

  tui = spawn('bun', ['src/index.tsx'], {
    cwd: tuiDir,
    stdio: 'inherit',
    // Tells the TUI which process may be asked to restart the server (see Ctrl+R).
    env: { ...process.env, MONITOR_SUPERVISOR_PID: String(process.pid) },
  });

  tui.on('exit', (code) => shutdown(code ?? 0));
})();
