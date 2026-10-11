import type { TabName } from '../constants';
import type { MonitorSummary, RelayHealth, Run } from '../types';
import { formatTime } from './format';
import { readLogTail } from './logs';

export interface TabData {
  summary: MonitorSummary | null;
  activeRuns: Run[];
  queueRuns: Run[];
  completedRuns: Run[];
  failedRuns: Run[];
  needsInputRuns: Run[];
  relayHealth: RelayHealth | null;
}

const runLine = (run: Run, extra: string[] = []): string =>
  [run.domainLabel, run.issueIdentifier || '—', run.issueTitle || '(no title)', run.skill, ...extra].join('\t');

/** Plain-text version of a tab, for the `y` (copy) key. */
export function tabText(tab: TabName, data: TabData): string {
  switch (tab) {
    case 'Dashboard':
      return (data.summary?.repos ?? [])
        .map((repo) =>
          [
            `${repo.domainLabel}\t${repo.repoPath}`,
            ...repo.issueLabelToSkill.map((m) => `  ${m.label} -> /${m.skill}`),
          ].join('\n'),
        )
        .join('\n');
    case 'Logs':
      return readLogTail().join('\n');
    case 'Relay':
      return data.relayHealth ? JSON.stringify(data.relayHealth, null, 2) : '';
    case 'Runs':
      return [
        ...data.activeRuns.map((r) => runLine(r, [formatTime(Date.now() - new Date(r.startedAt).getTime())])),
        ...data.queueRuns.map((r) => runLine(r, ['queued'])),
      ].join('\n');
    case 'Needs input':
      return data.needsInputRuns
        .map((r) => [runLine(r), r.errorSnippet ?? ''].filter(Boolean).join('\n  '))
        .join('\n');
    case 'Completed':
      return data.completedRuns.map((r) => runLine(r)).join('\n');
    case 'Failed':
      return data.failedRuns.map((r) => [runLine(r), r.errorSnippet ?? ''].filter(Boolean).join('\n  ')).join('\n');
  }
}

