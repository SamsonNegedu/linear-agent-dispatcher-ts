import { spawn } from 'child_process';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import React from 'react';
import { ThemeProvider } from './theme-context';
import { App } from './App';
import { loadEnv, dispatcherDir } from './utils/env';

async function main(): Promise<void> {
  let rendererInstance: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

  const handleShutdown = (): void => {
    if (rendererInstance) {
      rendererInstance.destroy();
    }
    process.exit(0);
  };

  const mountApp = async (): Promise<void> => {
    rendererInstance = await createCliRenderer({ useMouse: true });
    const root = createRoot(rendererInstance);
    root.render(
      <ThemeProvider>
        <App
          onExit={handleShutdown}
          onRunRelayScript={(script, args) => runRelayScript(rendererInstance!, script, args)}
        />
      </ThemeProvider>,
    );
  };

  const runRelayScript = (
    renderer: Awaited<ReturnType<typeof createCliRenderer>>,
    script: 'connect-relay' | 'update-relay',
    args: string[],
  ): void => {
    renderer.destroy();
    console.log(`\n> pnpm ${script} ${args.join(' ')}\n`);

    const child = spawn('pnpm', [script, ...args], {
      stdio: 'inherit',
      cwd: dispatcherDir,
    });

    child.on('exit', () => {
      loadEnv();
      console.log('\nPress Enter to return to the dashboard...');
      process.stdin.resume();
      process.stdin.once('data', () => {
        void mountApp();
      });
    });

    child.on('error', (error) => {
      console.error(`Failed to run ${script}:`, error);
      void mountApp();
    });
  };

  await mountApp();

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

main().catch((error) => {
  console.error('Failed to start monitor:', error);
  process.exitCode = 1;
});
