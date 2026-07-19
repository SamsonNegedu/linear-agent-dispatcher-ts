import React from 'react';
import { ROW_COLUMNS } from '../constants';
import { formatTime } from '../utils/format';
import type { Run } from '../types';
import { RunTable } from './RunTable';

export function CompletedTab({ runs }: { runs: Run[] }): React.ReactNode {
  const rows = runs.map((run) => {
    const elapsed =
      run.finishedAt && run.startedAt
        ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
        : 0;
    const finishedAt = run.finishedAt
      ? new Date(run.finishedAt).toLocaleTimeString([], { hour12: false })
      : '—';
    return [
      run.domainLabel,
      run.issueIdentifier || '—',
      run.issueTitle || '(no title)',
      run.skill,
      formatTime(elapsed),
      finishedAt,
    ];
  });
  return (
    <RunTable columns={ROW_COLUMNS.completed} rows={rows} status="succeeded" emptyLabel="No completed runs yet" />
  );
}
