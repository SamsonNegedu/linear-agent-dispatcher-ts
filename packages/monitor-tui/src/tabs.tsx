import React from 'react';
import type { MonitorSnapshot } from './services/monitor-api.service';
import type { RelayTabProps, Run } from './types';
import { formatTime } from './utils/format';
import { readLogTail } from './utils/logs';
import { CompletedTab } from './components/CompletedTab';
import { Dashboard } from './components/Dashboard';
import { FailedTab } from './components/FailedTab';
import { LogsTab } from './components/LogsTab';
import { NeedsInputTab } from './components/NeedsInputTab';
import { RelayTab } from './components/RelayTab';
import { RunsTab } from './components/RunsTab';

export interface TabContext {
  snapshot: MonitorSnapshot;
  relay: Pick<RelayTabProps, 'onRunScript' | 'mode' | 'setMode'>;
}

interface Tab {
  name: string;
  /** Shown after the name in the sidebar, e.g. "Failed (3)". */
  count?: (snapshot: MonitorSnapshot) => string | null;
  /** Extra footer hint while this tab is open. */
  hint?: string;
  view: (context: TabContext) => React.ReactNode;
  /** Plain text for the `y` (copy) key. */
  text: (snapshot: MonitorSnapshot) => string;
}

const runLine = (run: Run, ...extra: string[]): string =>
  [
    run.domainLabel,
    run.issueIdentifier || '—',
    run.issueTitle || '(no title)',
    run.skill,
    ...extra,
  ].join('\t');

const withReason = (run: Run): string =>
  [runLine(run), run.errorSnippet].filter(Boolean).join('\n  ');

// One entry per sidebar tab, in order. Adding a tab is adding an entry here.
export const TABS: readonly Tab[] = [
  {
    name: 'Dashboard',
    view: ({ snapshot }) => (
      <Dashboard summary={snapshot.summary} relayHealth={snapshot.relayHealth} />
    ),
    text: ({ summary }) =>
      summary.repos
        .map((repo) =>
          [
            `${repo.domainLabel}\t${repo.repoPath}`,
            ...repo.issueLabelToSkill.map((m) => `  ${m.label} -> /${m.skill}`),
          ].join('\n'),
        )
        .join('\n'),
  },
  { name: 'Logs', view: () => <LogsTab />, text: () => readLogTail().join('\n') },
  {
    name: 'Relay',
    hint: 'c connect · u update',
    view: ({ snapshot, relay }) => <RelayTab {...relay} relayHealth={snapshot.relayHealth} />,
    text: ({ relayHealth }) => JSON.stringify(relayHealth, null, 2),
  },
  {
    name: 'Runs',
    count: ({ summary }) => `${summary.counts.running}/${summary.counts.pending}`,
    view: ({ snapshot }) => (
      <RunsTab activeRuns={snapshot.activeRuns} queueRuns={snapshot.queueRuns} />
    ),
    text: ({ activeRuns, queueRuns }) =>
      [
        ...activeRuns.map((r) =>
          runLine(r, formatTime(Date.now() - new Date(r.startedAt).getTime())),
        ),
        ...queueRuns.map((r) => runLine(r, 'queued')),
      ].join('\n'),
  },
  {
    name: 'Needs input',
    count: ({ summary }) =>
      summary.counts.needs_input > 0 ? `${summary.counts.needs_input}` : null,
    view: ({ snapshot }) => <NeedsInputTab runs={snapshot.needsInputRuns} />,
    text: ({ needsInputRuns }) => needsInputRuns.map(withReason).join('\n'),
  },
  {
    name: 'Completed',
    count: ({ summary }) => `${summary.counts.succeeded}`,
    view: ({ snapshot }) => <CompletedTab runs={snapshot.completedRuns} />,
    text: ({ completedRuns }) => completedRuns.map((r) => runLine(r)).join('\n'),
  },
  {
    name: 'Failed',
    count: ({ summary }) => `${summary.counts.failed}`,
    view: ({ snapshot }) => <FailedTab runs={snapshot.failedRuns} />,
    text: ({ failedRuns }) => failedRuns.map(withReason).join('\n'),
  },
];
