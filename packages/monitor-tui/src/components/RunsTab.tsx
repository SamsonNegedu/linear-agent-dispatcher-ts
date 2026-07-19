import React from 'react';
import { ROW_COLUMNS } from '../constants';
import { formatTime } from '../utils/format';
import type { Run } from '../types';
import { RunTable } from './RunTable';

export function RunsTab({ activeRuns, queueRuns }: { activeRuns: Run[]; queueRuns: Run[] }): React.ReactNode {
  const activeRows = activeRuns.map((run) => [
    run.domainLabel,
    run.issueIdentifier || '—',
    run.issueTitle || '(no title)',
    run.skill,
    formatTime(Date.now() - new Date(run.startedAt).getTime()),
  ]);
  const queueRows = queueRuns.map((run) => [
    run.domainLabel,
    run.issueIdentifier || '—',
    run.issueTitle || '(no title)',
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
