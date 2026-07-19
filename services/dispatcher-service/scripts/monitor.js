// Boots the dispatcher server with its logs redirected to a file, waits for it
// to become healthy, then execs the OpenTUI monitor with the real inherited
// terminal. Running both under `concurrently` instead corrupts the TUI: it
// pipes child stdout through a non-tty stream, and OpenTUI needs raw terminal
// control that a piped stream can't provide.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dispatcherDir = path.join(__dirname, '..');
const tuiDir = path.join(dispatcherDir, '..', '..', 'packages', 'monitor-tui');
const logsDir = path.join(dispatcherDir, 'logs');
const logFile = path.join(logsDir, 'server.log');
const port = process.env.PORT || '3000';

fs.mkdirSync(logsDir, { recursive: true });
const logFd = fs.openSync(logFile, 'a');

console.log(`Starting dispatcher server (logs: ${logFile})...`);

const server = spawn('npx', ['ts-node', 'src/main.ts'], {
  cwd: dispatcherDir,
  stdio: ['ignore', logFd, logFd],
});

let tui = null;
let shuttingDown = false;

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (tui && !tui.killed) tui.kill();
  if (server && !server.killed) server.kill();
  process.exit(code);
};

server.on('exit', (code) => {
  if (!tui) {
    console.error(`Server exited before becoming healthy (code ${code}). Check ${logFile}`);
    process.exit(code ?? 1);
  } else if (!shuttingDown) {
    console.error(`Server exited unexpectedly (code ${code}). Check ${logFile}`);
    shutdown(code ?? 1);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const waitForHealthy = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/monitor/summary`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

(async () => {
  const healthy = await waitForHealthy();
  if (!healthy) {
    console.error(`Server did not become healthy within 30s. Check ${logFile}`);
    shutdown(1);
    return;
  }

  tui = spawn('bun', ['src/index.tsx'], {
    cwd: tuiDir,
    stdio: 'inherit',
    env: process.env,
  });

  tui.on('exit', (code) => shutdown(code ?? 0));
})();
