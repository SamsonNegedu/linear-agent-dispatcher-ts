import React, { useEffect, useState } from 'react';
import { render, Box, Text } from 'ink';
import { bootstrapServer } from '../bootstrap';
import { Logger } from '@nestjs/common';

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

interface DashboardProps {
  summary: MonitorSummary;
}

const Dashboard: React.FC<DashboardProps> = ({ summary }: DashboardProps) => (
  <Box flexDirection="column">
    <Text>
      Queue Status: Pending: {summary.counts.pending} | Running: {summary.counts.running} | Completed:{' '}
      {summary.counts.succeeded} | Failed: {summary.counts.failed}
    </Text>
    <Text> </Text>
    <Text>Repo Status:</Text>
    {summary.repos.map(
      (repo: MonitorSummary['repos'][number]) => (
        <Text key={repo.repoPath}>  {repo.domainLabel}: {repo.runningCount} running</Text>
      ),
    )}
  </Box>
);

interface ActiveTabProps {
  runs: Run[];
}

const ActiveTab: React.FC<ActiveTabProps> = ({ runs }: ActiveTabProps) => (
  <Box flexDirection="column">
    <Text>Active Runs:</Text>
    {runs.length === 0 ? (
      <Text>  (none)</Text>
    ) : (
      runs.map((run: Run) => {
        const elapsed = Date.now() - new Date(run.startedAt).getTime();
        return (
          <Text key={run.id}>
            {run.domainLabel} | {run.issueIdentifier}: {run.issueTitle || '(no title)'} | {run.skill} |{' '}
            {formatTime(elapsed)}
          </Text>
        );
      })
    )}
  </Box>
);

interface QueueTabProps {
  runs: Run[];
}

const QueueTab: React.FC<QueueTabProps> = ({ runs }: QueueTabProps) => (
  <Box flexDirection="column">
    <Text>Pending Queue:</Text>
    {runs.length === 0 ? (
      <Text>  (none)</Text>
    ) : (
      runs.map((run: Run) => (
        <Text key={run.id}>
          {run.domainLabel} | {run.issueIdentifier}: {run.issueTitle || '(no title)'} | {run.skill}
        </Text>
      ))
    )}
  </Box>
);

interface CompletedTabProps {
  runs: Run[];
}

const CompletedTab: React.FC<CompletedTabProps> = ({ runs }: CompletedTabProps) => (
  <Box flexDirection="column">
    <Text>Completed Runs:</Text>
    {runs.length === 0 ? (
      <Text>  (none)</Text>
    ) : (
      runs.map((run: Run) => {
        const elapsed =
          run.finishedAt && run.startedAt
            ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
            : 0;
        return (
          <Text key={run.id}>
            {run.domainLabel} | {run.issueIdentifier}: {run.issueTitle || '(no title)'} | {formatTime(elapsed)}
          </Text>
        );
      })
    )}
  </Box>
);

interface FailedTabProps {
  runs: Run[];
}

const FailedTab: React.FC<FailedTabProps> = ({ runs }: FailedTabProps) => (
  <Box flexDirection="column">
    <Text>Failed Runs:</Text>
    {runs.length === 0 ? (
      <Text>  (none)</Text>
    ) : (
      runs.map((run: Run) => (
        <Box key={run.id} flexDirection="column">
          <Text>
            {run.domainLabel} | {run.issueIdentifier}: {run.issueTitle || '(no title)'}
          </Text>
          {run.errorSnippet && <Text>    Error: {run.errorSnippet.substring(0, 100)}...</Text>}
        </Box>
      ))
    )}
  </Box>
);

interface AppProps {
  port: number;
  onExit: () => void;
}

const App: React.FC<AppProps> = ({ port, onExit }: AppProps) => {
  const [currentTab, setCurrentTab] = useState(0);
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
  const [queueRuns, setQueueRuns] = useState<Run[]>([]);
  const [completedRuns, setCompletedRuns] = useState<Run[]>([]);
  const [failedRuns, setFailedRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async (): Promise<void> => {
      try {
        const summaryRes = await fetch(`http://localhost:${port}/monitor/summary`);
        const summaryData = (await summaryRes.json()) as MonitorSummary;

        const activeRes = await fetch(`http://localhost:${port}/monitor/runs?status=running&limit=50`);
        const activeData = (await activeRes.json()) as Run[];

        const queueRes = await fetch(`http://localhost:${port}/monitor/runs?status=pending&limit=50`);
        const queueData = (await queueRes.json()) as Run[];

        const completedRes = await fetch(`http://localhost:${port}/monitor/runs?status=succeeded&limit=20`);
        const completedData = (await completedRes.json()) as Run[];

        const failedRes = await fetch(`http://localhost:${port}/monitor/runs?status=failed&limit=20`);
        const failedData = (await failedRes.json()) as Run[];

        setSummary(summaryData);
        setActiveRuns(activeData);
        setQueueRuns(queueData);
        setCompletedRuns(completedData);
        setFailedRuns(failedData);
        setLoading(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, 1000);

    return () => clearInterval(interval);
  }, [port]);

  const tabs = ['Dashboard', 'Active', 'Queue', 'Completed', 'Failed'];
  const tabDisplay = tabs.map((t, i) => (i === currentTab ? `[${t}]` : t)).join(' | ');

  if (loading) {
    return <Text>Loading...</Text>;
  }

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (!summary) {
    return <Text>No data</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold>DISPATCHER MONITOR (1-5 to switch tabs, q or Ctrl+C to exit)</Text>
      </Box>
      <Text>{tabDisplay}</Text>
      <Box borderStyle="round" borderColor="cyan">
        {currentTab === 0 && <Dashboard summary={summary} />}
        {currentTab === 1 && <ActiveTab runs={activeRuns} />}
        {currentTab === 2 && <QueueTab runs={queueRuns} />}
        {currentTab === 3 && <CompletedTab runs={completedRuns} />}
        {currentTab === 4 && <FailedTab runs={failedRuns} />}
      </Box>
    </Box>
  );
};

async function main(): Promise<void> {
  const result = await bootstrapServer();
  const app = result.app;
  const port = result.port;

  logger.log(`Monitor TUI starting, server on port ${port}`);

  let currentTab = 0;

  const { unmount } = render(<App port={port} onExit={() => {}} />);

  const handleShutdown = async (): Promise<void> => {
    unmount();
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

  // Handle standard signals
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
