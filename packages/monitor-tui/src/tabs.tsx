import React from 'react';
import type { MonitorSnapshot } from './services/monitor-api.service';
import type { RelayTabProps } from './types';
import { OverviewView } from './components/OverviewView';
import { RelayTab } from './components/RelayTab';
import { RunsView } from './components/RunsView';
import { LogsView } from './components/LogsView';
import { readLogTail } from './utils/logs';
import { allRuns, runDetailText } from './utils/runs';

export type Hint = readonly [key: string, label: string];

export interface TabContext {
  snapshot: MonitorSnapshot;
  relay: Pick<RelayTabProps, 'onRunScript' | 'mode' | 'setMode'>;
  /** A view calls this while rendering to say what `y` should copy for it. */
  registerCopy: (copy: () => string) => void;
}

interface Tab {
  name: string;
  /** Shown after the name in the tab bar, e.g. "Runs (2)". */
  count?: (snapshot: MonitorSnapshot) => string | null;
  /** Needs-attention marker after the count (orange), e.g. runs waiting for an answer. */
  alert?: (snapshot: MonitorSnapshot) => number;
  /** Footer key hints while this tab is open. */
  hints: readonly Hint[];
  view: (context: TabContext) => React.ReactNode;
  /** Plain text for the `y` (copy) key when the view doesn't register its own. */
  text: (snapshot: MonitorSnapshot) => string;
}

// One entry per tab, in order. Adding a tab is adding an entry here.
export const TABS: readonly Tab[] = [
  {
    name: 'Overview',
    hints: [],
    view: ({ snapshot }) => <OverviewView snapshot={snapshot} />,
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
  {
    name: 'Runs',
    count: ({ summary }) => {
      const active = summary.counts.running + summary.counts.pending;
      return active > 0 ? String(active) : null;
    },
    alert: ({ summary }) => summary.counts.needs_input,
    hints: [
      ['↑↓', 'select'],
      ['⏎', 'details'],
      ['f', 'filter'],
    ],
    view: ({ snapshot, registerCopy }) => (
      <RunsView snapshot={snapshot} registerCopy={registerCopy} />
    ),
    text: (snapshot) =>
      allRuns(snapshot)
        .map((r) => runDetailText(r, Date.now()))
        .join('\n\n'),
  },
  {
    name: 'Logs',
    hints: [
      ['↑↓', 'select/scroll'],
      ['⏎', 'open'],
      ['esc', 'back'],
      ['l', 'level'],
      ['f', 'follow'],
    ],
    view: ({ registerCopy }) => <LogsView registerCopy={registerCopy} />,
    text: () => readLogTail().join('\n'),
  },
  {
    name: 'Relay',
    hints: [
      ['c', 'connect'],
      ['u', 'update'],
    ],
    view: ({ snapshot, relay }) => <RelayTab {...relay} relayHealth={snapshot.relayHealth} />,
    text: ({ relayHealth }) => JSON.stringify(relayHealth, null, 2),
  },
];
