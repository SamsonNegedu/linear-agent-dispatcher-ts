import React, { useEffect, useRef, useState } from 'react';
import { spawn } from 'child_process';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import type { SelectRenderable } from '@opentui/core';
import { useTheme } from './theme-context';
import { PORT } from './utils/env';
import { TAB_NAMES } from './constants';
import type { AppProps, MonitorSummary, Run } from './types';
import { Dashboard } from './components/Dashboard';
import { LogsTab } from './components/LogsTab';
import { RelayTab } from './components/RelayTab';
import { RunsTab } from './components/RunsTab';
import { CompletedTab } from './components/CompletedTab';
import { FailedTab } from './components/FailedTab';

export function App({ onExit, onRunRelayScript }: AppProps): React.ReactNode {
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
  const { height: terminalHeight } = useTerminalDimensions();
  const HEADER_ROWS = 3;
  const FOOTER_ROWS = 1;
  const contentHeight = Math.max(1, terminalHeight - HEADER_ROWS - FOOTER_ROWS);

  useEffect(() => {
    if (!loading) {
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
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to fetch data');
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
    if (key.ctrl && key.name === 'r') {
      setError('Restarting server...');
      setLoading(true);
      const child = spawn('pkill', ['-f', 'ts-node.*dispatcher-service/src/main.ts']);
      child.on('error', () => {
        setError(null);
        setLoading(false);
      });
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
      sidebarRef.current?.focus();
    }
  });

  const tabCounts: Array<string | null> = summary
    ? [
      null,
      null,
      null,
      `${summary.counts.running}/${summary.counts.pending}`,
      `${summary.counts.succeeded}`,
      `${summary.counts.failed}`,
    ]
    : [null, null, null, null, null, null];

  const sidebarOptions = TAB_NAMES.map((name, i) => ({
    name: tabCounts[i] !== null ? `${name} (${tabCounts[i]})` : name,
    description: '',
  }));

  const switchHint = `↑↓/1-${TAB_NAMES.length} switch · q quit · Ctrl+R restart`;

  const footerHint = (): string => {
    if (relayMode !== 'idle') return "Enter confirm · Esc cancel";
    if (currentTab === 2) return `c connect · u update · ${switchHint}`;
    return switchHint;
  };

  const contentReady = !loading && !error && summary !== null;

  return (
    <box style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
      <box style={{ border: true, borderColor: colors.accent, paddingLeft: 1, paddingRight: 1 }}>
        <text attributes={1}>DISPATCHER MONITOR</text>
      </box>
      <box style={{ flexDirection: 'row', height: contentHeight }}>
        <box style={{ width: 22, height: contentHeight, border: true, borderColor: colors.accent, flexDirection: 'column', paddingLeft: 1, paddingRight: 1 }}>
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
        <box style={{ flexDirection: 'column', width: '100%', height: contentHeight }}>
          {!contentReady ? (
            <text fg={error ? colors.failed : colors.muted}>{error ? `Error: ${error}` : 'Loading...'}</text>
          ) : (
            <>
              {currentTab === 0 && <Dashboard summary={summary} />}
              {currentTab === 1 && <LogsTab />}
              {currentTab === 2 && (
                <RelayTab onRunScript={onRunRelayScript} mode={relayMode} setMode={setRelayMode} />
              )}
              {currentTab === 3 && <RunsTab activeRuns={activeRuns} queueRuns={queueRuns} />}
              {currentTab === 4 && <CompletedTab runs={completedRuns} />}
              {currentTab === 5 && <FailedTab runs={failedRuns} />}
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
