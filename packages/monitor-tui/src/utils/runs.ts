import type { RunStatus } from '../theme';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import type { Run } from '../types';
import { formatTime } from './format';

export type RunFilter = 'all' | 'active' | 'needs_input' | 'failed' | 'done';

export const RUN_FILTERS: readonly RunFilter[] = ['all', 'active', 'needs_input', 'failed', 'done'];

export const FILTER_LABEL: Record<RunFilter, string> = {
  all: 'All',
  active: 'Active',
  needs_input: 'Needs input',
  failed: 'Failed',
  done: 'Done',
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'RUNNING',
  pending: 'QUEUED',
  needs_input: 'INPUT',
  failed: 'FAILED',
  succeeded: 'DONE',
};

const FILTER_STATUSES: Record<RunFilter, readonly RunStatus[] | null> = {
  all: null,
  active: ['running', 'pending'],
  needs_input: ['needs_input'],
  failed: ['failed'],
  done: ['succeeded'],
};

/** Every run in the snapshot, most urgent first: running, queued, needs input, failed, done. */
export const allRuns = (s: MonitorSnapshot): Run[] => [
  ...s.activeRuns,
  ...s.queueRuns,
  ...s.needsInputRuns,
  ...s.failedRuns,
  ...s.completedRuns,
];

export const filterRuns = (runs: Run[], filter: RunFilter): Run[] => {
  const statuses = FILTER_STATUSES[filter];
  return statuses ? runs.filter((r) => statuses.includes(r.status)) : runs;
};

export const filterCounts = (runs: Run[]): Record<RunFilter, number> =>
  Object.fromEntries(RUN_FILTERS.map((f) => [f, filterRuns(runs, f).length])) as Record<
    RunFilter,
    number
  >;

export const nextFilter = (current: RunFilter, step = 1): RunFilter =>
  RUN_FILTERS[(RUN_FILTERS.indexOf(current) + step + RUN_FILTERS.length) % RUN_FILTERS.length];

/** Time spent (finished runs) or elapsed so far (running ones), in ms. */
export const runDuration = (run: Run, now: number): number => {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  return Math.max(0, end - new Date(run.startedAt).getTime());
};

/** When a run last moved: finish time for ended runs, start time otherwise. */
export const runAge = (run: Run, now: number): number =>
  Math.max(0, now - new Date(run.finishedAt ?? run.startedAt).getTime());

/** What the reason text means for this status. */
export const reasonLabel = (status: RunStatus): string =>
  status === 'needs_input' ? 'Question' : status === 'failed' ? 'Error' : 'Note';

/** All of a run's details as plain text (for copying). */
export const runDetailText = (run: Run, now: number): string =>
  [
    `${run.issueIdentifier || '—'}  ${run.issueTitle || '(no title)'}`,
    `Status:  ${STATUS_LABEL[run.status]}`,
    `Repo:    ${run.domainLabel} (${run.repoPath})`,
    `Skill:   /${run.skill}`,
    `Run ID:  ${run.id}`,
    `Started: ${new Date(run.startedAt).toLocaleString()}`,
    `${run.finishedAt ? 'Took:   ' : 'Running:'} ${formatTime(runDuration(run, now))}`,
    ...(run.errorSnippet ? ['', `${reasonLabel(run.status)}:`, run.errorSnippet] : []),
  ].join('\n');
