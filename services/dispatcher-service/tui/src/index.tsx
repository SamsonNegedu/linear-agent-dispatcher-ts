import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { createCliRenderer, type SelectRenderable } from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';
import React, { useEffect, useRef, useState } from 'react';
import { statusColor, type RunStatus } from './theme';
import { ThemeProvider, useTheme } from './theme-context';

const dispatcherDir = path.join(import.meta.dir, '..', '..');
const envLocalPath = path.join(dispatcherDir, '.env.local');
const envPath = fs.existsSync(envLocalPath) ? envLocalPath : path.join(dispatcherDir, '.env');

// `override: true` is required here: dotenv normally refuses to overwrite keys
// already present in process.env, but this gets called again after
// connect-relay/update-relay rewrite the file on disk, and without override
// the stale in-memory values (e.g. RELAY_ENABLED) would never pick up the change.
const loadEnv = (): void => {
  dotenv.config({ path: envPath, override: true });
};

loadEnv();

const PORT = process.env.PORT || '3000';
const serverLogPath = path.join(dispatcherDir, 'logs', 'server.log');
const LOG_TAIL_BYTES = 65536;
const LOG_MAX_LINES = 200;

// eslint-disable-next-line no-control-regex
const ansiPattern = /\x1b\[[0-9;]*m/g;
const stripAnsi = (line: string): string => line.replace(ansiPattern, '');

const readLogTail = (): string[] => {
  try {
    const stat = fs.statSync(serverLogPath);
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const fd = fs.openSync(serverLogPath, 'r');
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    const lines = buffer.toString('utf-8').split('\n').map(stripAnsi);
    return lines.slice(-LOG_MAX_LINES);
  } catch {
    return [];
  }
};

interface Run {
  id: string;
  issueIdentifier: string;
  issueTitle?: string;
  skill: string;
  repoPath: string;
  domainLabel: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
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
    description?: string;
    modes: Array<{ label: string; skill: string }>;
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

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const pad = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)} ` : text.padEnd(width);

function Dot({ status }: { status: RunStatus }): React.ReactNode {
  const colors = useTheme();
  return <span fg={statusColor(colors, status)}>●</span>;
}

interface RowColumn {
  label: string;
  width: number;
}

const ROW_COLUMNS = {
  active: [
    { label: 'Repo', width: 13 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 24 },
    { label: 'Skill', width: 11 },
    { label: 'Elapsed', width: 8 },
  ] satisfies RowColumn[],
  queue: [
    { label: 'Repo', width: 13 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 32 },
    { label: 'Skill', width: 11 },
  ] satisfies RowColumn[],
  completed: [
    { label: 'Repo', width: 13 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 24 },
    { label: 'Duration', width: 8 },
  ] satisfies RowColumn[],
};

function RunTable({
  columns,
  rows,
  status,
  emptyLabel,
}: {
  columns: RowColumn[];
  rows: string[][];
  status: RunStatus;
  emptyLabel: string;
}): React.ReactNode {
  const colors = useTheme();
  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1 }}>
      <text fg={colors.muted} attributes={1} wrapMode="none" truncate>
        {'  '}
        {columns.map((c) => pad(c.label, c.width)).join('')}
      </text>
      {rows.length === 0 ? (
        <text fg={colors.muted}>{emptyLabel}</text>
      ) : (
        <scrollbox style={{ flexGrow: 1 }}>
          {rows.map((row, i) => (
            <box key={i} style={{ flexDirection: 'row' }}>
              <text wrapMode="none" truncate>
                <Dot status={status} /> {row.map((cell, j) => pad(cell, columns[j].width)).join('')}
              </text>
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  );
}

function Dashboard({ summary }: { summary: MonitorSummary }): React.ReactNode {
  const colors = useTheme();
  const relayEnabled = process.env.RELAY_ENABLED === 'true';
  const relayUrl = process.env.RELAY_URL || '';
  const dispatcherUrl = process.env.RELAY_DISPATCHER_URL || '';

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <box style={{ height: 5, flexDirection: 'column' }}>
        <text attributes={1}>Connectivity</text>
        <text wrapMode="none" truncate>
          {'Relay: '}
          <span fg={relayEnabled ? colors.succeeded : colors.failed}>
            {relayEnabled ? '● Connected' : '● Not connected'}
          </span>
        </text>
        {relayEnabled ? (
          <>
            <text fg={colors.muted} wrapMode="none" truncate>
              {`  Relay server: ${relayUrl || '(not set)'}`}
            </text>
            <text fg={colors.muted} wrapMode="none" truncate>
              {`  Dispatcher URL: ${dispatcherUrl || '(not tracked)'}`}
            </text>
          </>
        ) : (
          <text fg={colors.muted} wrapMode="none" truncate>
            {'  See Relay tab to connect'}
          </text>
        )}
      </box>
      <text> </text>
      <text attributes={1}>Repo Status</text>
      <text> </text>
      <box style={{ flexDirection: 'column', flexGrow: 1 }}>
        {summary.repos.map((repo) => (
          <box key={repo.repoPath} style={{ flexDirection: 'column', marginBottom: 1 }}>
            <text>
              System/Domain Label: <span attributes={1}>{repo.domainLabel}</span>{' '}
              <span fg={repo.runningCount > 0 ? colors.running : colors.muted}>({repo.runningCount} running)</span>
            </text>
            <text fg={colors.accent}>  Repo Path: {repo.repoPath}</text>
            {repo.modes.length > 0 ? (
              <text>
                {'  '}
                <span fg={colors.accent}>Agent Handoff Label:</span>{' '}
                {repo.modes.map((m, i) => (
                  <span key={m.label}>
                    {i > 0 ? '  ' : ''}
                    {m.label} → Repo skill: {m.skill}
                  </span>
                ))}
              </text>
            ) : (
              <text fg={colors.muted}>  Modes: none configured</text>
            )}
          </box>
        ))}
      </box>
    </box>
  );
}

function RunsTab({ activeRuns, queueRuns }: { activeRuns: Run[]; queueRuns: Run[] }): React.ReactNode {
  const activeRows = activeRuns.map((run) => [
    run.domainLabel,
    run.issueIdentifier,
    truncate(run.issueTitle || '(no title)', 22),
    run.skill,
    formatTime(Date.now() - new Date(run.startedAt).getTime()),
  ]);
  const queueRows = queueRuns.map((run) => [
    run.domainLabel,
    run.issueIdentifier,
    truncate(run.issueTitle || '(no title)', 30),
    run.skill,
  ]);

  return (
    <box style={{ flexDirection: 'column', flexGrow: 1 }}>
      <text attributes={1}>Active ({activeRuns.length})</text>
      <RunTable columns={ROW_COLUMNS.active} rows={activeRows} status="running" emptyLabel="No active runs" />
      <text> </text>
      <text attributes={1}>Queue ({queueRuns.length})</text>
      <RunTable columns={ROW_COLUMNS.queue} rows={queueRows} status="pending" emptyLabel="Queue is empty" />
    </box>
  );
}

function CompletedTab({ runs }: { runs: Run[] }): React.ReactNode {
  const rows = runs.map((run) => {
    const elapsed =
      run.finishedAt && run.startedAt
        ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
        : 0;
    return [run.domainLabel, run.issueIdentifier, truncate(run.issueTitle || '(no title)', 22), formatTime(elapsed)];
  });
  return (
    <RunTable columns={ROW_COLUMNS.completed} rows={rows} status="succeeded" emptyLabel="No completed runs yet" />
  );
}

function FailedTab({ runs }: { runs: Run[] }): React.ReactNode {
  const colors = useTheme();
  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1 }}>
      {runs.length === 0 ? (
        <text fg={colors.muted}>No failed runs</text>
      ) : (
        <scrollbox style={{ flexGrow: 1 }}>
          {runs.map((run) => (
            <box key={run.id} style={{ flexDirection: 'column', marginBottom: 1 }}>
              <text>
                <Dot status="failed" />{' '}
                <span fg={colors.failed} attributes={1}>
                  {run.domainLabel}
                </span>{' '}
                | {run.issueIdentifier}: {run.issueTitle || '(no title)'}
              </text>
              {run.errorSnippet ? (
                <text fg={colors.failed}>
                  {'    '}
                  {truncate(run.errorSnippet, 100)}
                </text>
              ) : null}
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  );
}

function LogsTab(): React.ReactNode {
  const colors = useTheme();
  const [lines, setLines] = useState<string[]>(() => readLogTail());

  useEffect(() => {
    const interval = setInterval(() => {
      setLines(readLogTail());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1 }}>
      {lines.length === 0 ? (
        <text fg={colors.muted}>
          No log output yet — server logs only stream here when started via `pnpm monitor`.
        </text>
      ) : (
        <scrollbox style={{ flexGrow: 1 }} stickyScroll stickyStart="bottom">
          {lines.map((line, i) => (
            <text key={i} wrapMode="none" truncate>
              {line || ' '}
            </text>
          ))}
        </scrollbox>
      )}
    </box>
  );
}

interface RelayFormField {
  key: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
}

function RelayForm({
  title,
  fields,
  onSubmit,
  onCancel,
}: {
  title: string;
  fields: RelayFormField[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}): React.ReactNode {
  const colors = useTheme();
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.key] = f.defaultValue || '';
    return initial;
  });
  const [current, setCurrent] = useState(fields[0]?.defaultValue || '');
  const [validationError, setValidationError] = useState<string | null>(null);

  useKeyboard((key) => {
    if (key.name === 'escape') onCancel();
  });

  const field = fields[stepIndex];

  const handleSubmitField = (value: string): void => {
    if (field.required && value.trim() === '') {
      setValidationError(`${field.label} is required`);
      return;
    }
    setValidationError(null);

    const updated = { ...values, [field.key]: value };
    setValues(updated);

    const nextIndex = stepIndex + 1;
    if (nextIndex < fields.length) {
      setStepIndex(nextIndex);
      setCurrent(fields[nextIndex]?.defaultValue || '');
    } else {
      onSubmit(updated);
    }
  };

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <text attributes={1}>{title}</text>
      <text fg={colors.muted}>(Esc to cancel)</text>
      <text> </text>
      {fields.map((f, i) => (
        <box key={f.key} style={{ flexDirection: 'column', marginBottom: i === stepIndex ? 0 : 1 }}>
          {i < stepIndex ? (
            <text fg={colors.succeeded}>
              ✓ {f.label}: {values[f.key] || '(none)'}
            </text>
          ) : null}
          {i === stepIndex ? (
            <box style={{ flexDirection: 'column' }}>
              <text fg={colors.accent}>{f.label}</text>
              <box style={{ border: true, borderColor: colors.accent, flexDirection: 'row' }}>
                <input
                  value={current}
                  focused
                  onInput={setCurrent}
                  {...({ onSubmit: handleSubmitField } as Record<string, unknown>)}
                  placeholder={f.required ? '(required)' : '(optional)'}
                  width={40}
                />
              </box>
            </box>
          ) : null}
        </box>
      ))}
      {validationError ? <text fg={colors.failed}>{validationError}</text> : null}
    </box>
  );
}

interface RelayTabProps {
  onRunScript: (script: 'connect-relay' | 'update-relay', args: string[]) => void;
  mode: 'idle' | 'connect' | 'update';
  setMode: (mode: 'idle' | 'connect' | 'update') => void;
}

function RelayTab({ onRunScript, mode, setMode }: RelayTabProps): React.ReactNode {
  const colors = useTheme();
  useKeyboard((key) => {
    if (mode !== 'idle') return;
    if (key.name === 'c') setMode('connect');
    if (key.name === 'u') setMode('update');
  });

  const relayEnabled = process.env.RELAY_ENABLED === 'true';
  const relayUrl = process.env.RELAY_URL || '';
  const dispatcherUrl = process.env.RELAY_DISPATCHER_URL || '';
  const subscriberId = process.env.RELAY_SUBSCRIBER_ID || '';
  const secret = process.env.RELAY_SUBSCRIBER_SECRET || '';
  const secretDisplay = secret ? `${secret.slice(0, 6)}...${secret.slice(-4)}` : '(none)';

  if (mode === 'connect') {
    return (
      <RelayForm
        title="Connect to Relay"
        fields={[
          { key: 'relayUrl', label: 'Relay URL', defaultValue: relayUrl, required: true },
          { key: 'localEndpoint', label: 'Public dispatcher URL (webhook target)', required: true },
          { key: 'port', label: 'Local OAuth callback port', defaultValue: '3333' },
        ]}
        onSubmit={(values) => {
          const args = [`--relay-url=${values.relayUrl}`, `--local-endpoint=${values.localEndpoint}`];
          if (values.port) args.push(`--port=${values.port}`);
          setMode('idle');
          onRunScript('connect-relay', args);
        }}
        onCancel={() => setMode('idle')}
      />
    );
  }

  if (mode === 'update') {
    return (
      <RelayForm
        title="Update Relay Endpoint"
        fields={[
          { key: 'localEndpoint', label: 'New public dispatcher URL', required: true },
          { key: 'relayUrl', label: 'Relay URL override', defaultValue: relayUrl },
        ]}
        onSubmit={(values) => {
          const args = [`--local-endpoint=${values.localEndpoint}`];
          if (values.relayUrl) args.push(`--relay-url=${values.relayUrl}`);
          setMode('idle');
          onRunScript('update-relay', args);
        }}
        onCancel={() => setMode('idle')}
      />
    );
  }

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <text>
        Status:{' '}
        <span fg={relayEnabled ? colors.succeeded : colors.muted}>
          ● {relayEnabled ? 'Connected' : 'Not connected'}
        </span>
      </text>
      <text> </text>
      <text fg={colors.muted}>Relay server (dispatcher subscribes to this):</text>
      <text>  {relayUrl || '(not set)'}</text>
      <text> </text>
      <text fg={colors.muted}>Public dispatcher URL (registered with the relay as the webhook target):</text>
      <text>  {dispatcherUrl || '(not tracked — run connect-relay or update-relay)'}</text>
      <text> </text>
      <text>Subscriber ID: {subscriberId || '(none)'}</text>
      <text>Secret: {secretDisplay}</text>
      <text> </text>
      <text fg={colors.muted}>Press &apos;c&apos; to connect, &apos;u&apos; to update endpoint</text>
    </box>
  );
}

const TAB_NAMES = ['Dashboard', 'Runs', 'Completed', 'Failed', 'Relay', 'Logs'] as const;

interface AppProps {
  onExit: () => void;
  onRunRelayScript: (script: 'connect-relay' | 'update-relay', args: string[]) => void;
}

function App({ onExit, onRunRelayScript }: AppProps): React.ReactNode {
  const colors = useTheme();
  const [currentTab, setCurrentTab] = useState(0);
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
  const [queueRuns, setQueueRuns] = useState<Run[]>([]);
  const [completedRuns, setCompletedRuns] = useState<Run[]>([]);
  const [failedRuns, setFailedRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relayMode, setRelayMode] = useState<'idle' | 'connect' | 'update'>('idle');
  const sidebarRef = useRef<SelectRenderable>(null);
  const renderer = useRenderer();

  useEffect(() => {
    if (!loading) {
      // Forces a full-buffer redraw after the loading -> loaded layout swap.
      // Without this, stray characters from the pre-load frame can bleed
      // into the first couple of content rows (OpenTUI diff-render artifact).
      renderer.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    }
  }, [loading, renderer]);

  useEffect(() => {
    const fetchData = async (): Promise<void> => {
      try {
        const [summaryRes, activeRes, queueRes, completedRes, failedRes] = await Promise.all([
          fetch(`http://localhost:${PORT}/monitor/summary`),
          fetch(`http://localhost:${PORT}/monitor/runs?status=running&limit=50`),
          fetch(`http://localhost:${PORT}/monitor/runs?status=pending&limit=50`),
          fetch(`http://localhost:${PORT}/monitor/runs?status=succeeded&limit=20`),
          fetch(`http://localhost:${PORT}/monitor/runs?status=failed&limit=20`),
        ]);

        const summaryBody = (await summaryRes.json()) as { data: MonitorSummary };
        const activeBody = (await activeRes.json()) as { data: Run[] };
        const queueBody = (await queueRes.json()) as { data: Run[] };
        const completedBody = (await completedRes.json()) as { data: Run[] };
        const failedBody = (await failedRes.json()) as { data: Run[] };

        setSummary(summaryBody.data);
        setActiveRuns(activeBody.data);
        setQueueRuns(queueBody.data);
        setCompletedRuns(completedBody.data);
        setFailedRuns(failedBody.data);
        setLoading(false);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
        setLoading(false);
      }
    };

    void fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      onExit();
      return;
    }
    if (relayMode !== 'idle') return;
    if (key.name === 'q') {
      onExit();
      return;
    }
    const tabNum = parseInt(key.name, 10);
    if (tabNum >= 1 && tabNum <= TAB_NAMES.length) {
      setCurrentTab(tabNum - 1);
      sidebarRef.current?.setSelectedIndex(tabNum - 1);
    }
  });

  const tabCounts: Array<string | null> = summary
    ? [
      null,
      `${summary.counts.running}/${summary.counts.pending}`,
      `${summary.counts.succeeded}`,
      `${summary.counts.failed}`,
      null,
      null,
    ]
    : [null, null, null, null, null, null];

  const sidebarOptions = TAB_NAMES.map((name, i) => ({
    name: tabCounts[i] !== null ? `${name} (${tabCounts[i]})` : name,
    description: '',
  }));

  const switchHint = `↑↓/1-${TAB_NAMES.length} switch · q quit`;

  const footerHint = (): string => {
    if (relayMode !== 'idle') return "Enter confirm · Esc cancel";
    if (currentTab === 4) return `c connect · u update · ${switchHint}`;
    return switchHint;
  };

  const contentReady = !loading && !error && summary !== null;

  return (
    <box style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
      <box style={{ border: true, borderColor: colors.accent, paddingLeft: 1, paddingRight: 1 }}>
        <text attributes={1}>DISPATCHER MONITOR</text>
      </box>
      <box style={{ flexDirection: 'row', flexGrow: 1 }}>
        <box style={{ width: 22 }}>
          <select
            ref={sidebarRef}
            focused={contentReady && relayMode === 'idle'}
            options={sidebarOptions}
            selectedIndex={currentTab}
            showDescription={false}
            selectedBackgroundColor={colors.selectedBg}
            selectedTextColor={colors.selectedFg}
            onChange={(index) => setCurrentTab(index)}
            style={{ flexGrow: 1 }}
          />
        </box>
        <box style={{ flexDirection: 'column', flexGrow: 1 }}>
          {!contentReady ? (
            <text fg={error ? colors.failed : colors.muted}>{error ? `Error: ${error}` : 'Loading...'}</text>
          ) : (
            <>
              {currentTab === 0 && <Dashboard summary={summary} />}
              {currentTab === 5 && <LogsTab />}
              {currentTab === 4 && (
                <RelayTab onRunScript={onRunRelayScript} mode={relayMode} setMode={setRelayMode} />
              )}
              {currentTab === 1 && <RunsTab activeRuns={activeRuns} queueRuns={queueRuns} />}
              {currentTab === 2 && <CompletedTab runs={completedRuns} />}
              {currentTab === 3 && <FailedTab runs={failedRuns} />}
            </>
          )}
        </box>
      </box>
      <box style={{ paddingLeft: 1 }}>
        <text fg={colors.muted}>{contentReady ? footerHint() : ''}</text>
      </box>
    </box>
  );
}

async function main(): Promise<void> {
  const handleShutdown = (): void => {
    process.exit(0);
  };

  const mountApp = async (): Promise<void> => {
    const renderer = await createCliRenderer({ useMouse: true });
    const root = createRoot(renderer);
    root.render(
      <ThemeProvider>
        <App
          onExit={handleShutdown}
          onRunRelayScript={(script, args) => runRelayScript(renderer, script, args)}
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

    child.on('error', (err) => {
      console.error(`Failed to run ${script}:`, err);
      void mountApp();
    });
  };

  await mountApp();

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

main().catch((err) => {
  console.error('Failed to start monitor:', err);
  process.exitCode = 1;
});
