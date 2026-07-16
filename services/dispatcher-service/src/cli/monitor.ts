import { bootstrapServer } from '../bootstrap';
import { Logger, INestApplication } from '@nestjs/common';

const logger = new Logger('Monitor');

interface Run {
  id: string;
  issueIdentifier: string;
  issueTitle?: string;
  skill: string;
  repoPath: string;
  domainLabel: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  errorSnippet?: string;
}

interface MonitorSummary {
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  repos: Array<{
    repoPath: string;
    domainLabel: string;
    runningCount: number;
    currentRuns: Array<{ issueIdentifier: string; issueTitle?: string }>;
  }>;
}

const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const renderDashboard = (summary: MonitorSummary): string => {
  const lines: string[] = [
    `Queue Status: Pending: ${summary.counts.pending} | Running: ${summary.counts.running} | Completed: ${summary.counts.succeeded} | Failed: ${summary.counts.failed}`,
    '',
    'Repo Status:',
    ...summary.repos.map((repo) => `  ${repo.domainLabel}: ${repo.runningCount} running`),
  ];
  return lines.join('\n');
};

const renderActiveTab = (runs: Run[]): string => {
  const lines: string[] = ['Active Runs:'];
  if (runs.length === 0) {
    lines.push('  (none)');
  } else {
    for (const run of runs) {
      const elapsed = Date.now() - new Date(run.startedAt).getTime();
      lines.push(
        `  ${run.domainLabel} | ${run.issueIdentifier}: ${run.issueTitle || '(no title)'} | ${run.skill} | ${formatTime(elapsed)}`
      );
    }
  }
  return lines.join('\n');
};

const renderQueueTab = (runs: Run[]): string => {
  const lines: string[] = ['Pending Queue:'];
  if (runs.length === 0) {
    lines.push('  (none)');
  } else {
    for (const run of runs) {
      lines.push(
        `  ${run.domainLabel} | ${run.issueIdentifier}: ${run.issueTitle || '(no title)'} | ${run.skill}`,
      );
    }
  }
  return lines.join('\n');
};

const renderCompletedTab = (runs: Run[]): string => {
  const lines: string[] = ['Completed Runs:'];
  if (runs.length === 0) {
    lines.push('  (none)');
  } else {
    for (const run of runs) {
      const elapsed =
        run.finishedAt && run.startedAt
          ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
          : 0;
      lines.push(
        `  ${run.domainLabel} | ${run.issueIdentifier}: ${run.issueTitle || '(no title)'} | ${formatTime(elapsed)}`
      );
    }
  }
  return lines.join('\n');
};

const renderFailedTab = (runs: Run[]): string => {
  const lines: string[] = ['Failed Runs:'];
  if (runs.length === 0) {
    lines.push('  (none)');
  } else {
    for (const run of runs) {
      lines.push(`  ${run.domainLabel} | ${run.issueIdentifier}: ${run.issueTitle || '(no title)'}`);
      if (run.errorSnippet) {
        lines.push(`    Error: ${run.errorSnippet.substring(0, 100)}...`);
      }
    }
  }
  return lines.join('\n');
};

async function main(): Promise<void> {
  const result = await bootstrapServer();
  const app: INestApplication = result.app;
  const port: number = result.port;

  logger.log(`Monitor TUI starting, server on port ${port}`);

  let currentTab = 0;
  const tabs = ['Dashboard', 'Active', 'Queue', 'Completed', 'Failed'];

  const fetchAndRender = async () => {
    try {
      const summaryRes = await fetch(`http://localhost:${port}/monitor/summary`);
      const summary = (await summaryRes.json()) as MonitorSummary;

      const activeRes = await fetch(`http://localhost:${port}/monitor/runs?status=running&limit=50`);
      const activeRuns = (await activeRes.json()) as Run[];

      const queueRes = await fetch(`http://localhost:${port}/monitor/runs?status=pending&limit=50`);
      const queueRuns = (await queueRes.json()) as Run[];

      const completedRes = await fetch(`http://localhost:${port}/monitor/runs?status=succeeded&limit=20`);
      const completedRuns = (await completedRes.json()) as Run[];

      const failedRes = await fetch(`http://localhost:${port}/monitor/runs?status=failed&limit=20`);
      const failedRuns = (await failedRes.json()) as Run[];

      const tabDisplay = tabs.map((t, i) => (i === currentTab ? `[${t}]` : t)).join(' | ');

      let content = '';
      switch (currentTab) {
        case 0:
          content = renderDashboard(summary);
          break;
        case 1:
          content = renderActiveTab(activeRuns);
          break;
        case 2:
          content = renderQueueTab(queueRuns);
          break;
        case 3:
          content = renderCompletedTab(completedRuns);
          break;
        case 4:
          content = renderFailedTab(failedRuns);
          break;
      }

      console.clear();
      console.log('┌─ DISPATCHER MONITOR (1-5 to switch tabs, q or Ctrl+C to exit) ────────────┐');
      console.log(`│ ${tabDisplay}`);
      console.log('├────────────────────────────────────────────────────────────────────────────┤');
      console.log(content);
      console.log('└────────────────────────────────────────────────────────────────────────────┘');
    } catch (err) {
      console.clear();
      console.log(`Error: ${err instanceof Error ? err.message : 'Failed to fetch data'}`);
    }
  };

  await fetchAndRender();
  const interval = setInterval(() => {
    void fetchAndRender();
  }, 1000);

  const handleShutdown = async (): Promise<void> => {
    clearInterval(interval);
    logger.log('Shutting down...');
    await app.close();
    process.exit(0);
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key: Buffer) => {
      const char = key.toString();
      const firstByte = key[0];

      // Handle Ctrl+C (byte 3) and Ctrl+Z (byte 26)
      if (firstByte === 3 || firstByte === 26 || char === 'q' || char === 'Q') {
        void handleShutdown();
      } else {
        // Number keys 1-5 to switch tabs
        const tabNum = parseInt(char, 10);
        if (tabNum >= 1 && tabNum <= 5) {
          currentTab = tabNum - 1;
        }
      }
    });
  }

  // Also handle standard signals for redundancy
  process.on('SIGINT', () => {
    void handleShutdown();
  });

  process.on('SIGTERM', () => {
    void handleShutdown();
  });
}

main().catch((err) => {
  console.error('Failed to start monitor:', err);
  process.exitCode = 1;
});
