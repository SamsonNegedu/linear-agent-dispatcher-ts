import React from 'react';
import { ROW_COLUMNS } from '../constants';
import { formatTime, truncate } from '../utils/format';
import type { Run } from '../types';
import { RunTable } from './RunTable';

export function CompletedTab({ runs }: { runs: Run[] }): React.ReactNode {
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
