import React, { useEffect, useRef, useState } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import type { SelectRenderable } from '@opentui/core';
import { useTheme } from './theme-context';
import { fetchMonitorSnapshot } from './services/monitor-api.service';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { TAB, TAB_NAMES, POLL_INTERVAL_MS, type TabName } from './constants';
import type { AppProps, MonitorSummary, RelayHealth, Run } from './types';
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
  const [relayHealth, setRelayHealth] = useState<RelayHealth | null>(null);
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
    let isFirstFetch = true;
    const fetchData = async (): Promise<void> => {
      try {
        const snapshot = await fetchMonitorSnapshot({ refreshRelay: isFirstFetch });
        isFirstFetch = false;

        setSummary(snapshot.summary);
        setActiveRuns(snapshot.activeRuns);
        setQueueRuns(snapshot.queueRuns);
        setCompletedRuns(snapshot.completedRuns);
        setFailedRuns(snapshot.failedRuns);
        setRelayHealth(snapshot.relayHealth);
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
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  useGlobalShortcuts({
    onExit,
    onRestartStart: () => {
      setError('Restarting server...');
      setLoading(true);
    },
    onRestartSettled: () => {
      setError(null);
      setLoading(false);
    },
  });

  useKeyboard((key) => {
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

  const tabCounts: Record<TabName, string | null> = summary
    ? {
      Dashboard: null,
      Logs: null,
      Relay: null,
      Runs: `${summary.counts.running}/${summary.counts.pending}`,
      Completed: `${summary.counts.succeeded}`,
      Failed: `${summary.counts.failed}`,
    }
    : { Dashboard: null, Logs: null, Relay: null, Runs: null, Completed: null, Failed: null };

  const sidebarOptions = TAB_NAMES.map((name) => ({
    name: tabCounts[name] !== null ? `${name} (${tabCounts[name]})` : name,
    description: '',
  }));

  const switchHint = `↑↓/1-${TAB_NAMES.length} switch · q quit · Ctrl+R restart`;

  const footerHint = (): string => {
    if (relayMode !== 'idle') return "Enter confirm · Esc cancel";
    if (currentTab === TAB.Relay) return `c connect · u update · ${switchHint}`;
    return switchHint;
  };

  const contentReady = !loading && !error && summary !== null;

  return (
    <box style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
      <box style={{ border: true, borderColor: colors.accent, paddingLeft: 1, paddingRight: 1 }}>
        <text attributes={1}>DISPATCHER MONITOR</text>
      </box>
      <box style={{ flexDirection: 'row', height: contentHeight }}>
        <box
          style={{ width: 22, height: contentHeight, border: true, borderColor: colors.accent, flexDirection: 'column', paddingLeft: 1, paddingRight: 1 }}
          onMouseDown={() => {
            if (!contentReady || relayMode !== 'idle') return;
            sidebarRef.current?.focus();
          }}
        >
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
        <box
          style={{ flexDirection: 'column', width: '100%', height: contentHeight }}
          onMouseDown={() => sidebarRef.current?.blur()}
        >
          {!contentReady ? (
            <text fg={error ? colors.failed : colors.muted}>{error ? `Error: ${error}` : 'Loading...'}</text>
          ) : (
            <>
              {currentTab === TAB.Dashboard && <Dashboard summary={summary} relayHealth={relayHealth} />}
              {currentTab === TAB.Logs && <LogsTab />}
              {currentTab === TAB.Relay && (
                <RelayTab
                  onRunScript={onRunRelayScript}
                  mode={relayMode}
                  setMode={setRelayMode}
                  relayHealth={relayHealth}
                />
              )}
              {currentTab === TAB.Runs && <RunsTab activeRuns={activeRuns} queueRuns={queueRuns} />}
              {currentTab === TAB.Completed && <CompletedTab runs={completedRuns} />}
              {currentTab === TAB.Failed && <FailedTab runs={failedRuns} />}
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
