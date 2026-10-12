import { describe, expect, test } from 'bun:test';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import type { Run } from '../types';
import {
  allRuns,
  filterCounts,
  filterRuns,
  nextFilter,
  runAge,
  runDetailText,
  runDuration,
} from './runs';

const run = (id: string, status: Run['status'], extra: Partial<Run> = {}): Run => ({
  id,
  issueIdentifier: `DLA-${id}`,
  issueTitle: `Title ${id}`,
  skill: 'implement',
  repoPath: '/repos/a',
  domainLabel: 'repo-a',
  status,
  startedAt: '2026-10-11T10:00:00.000Z',
  ...extra,
});

const snapshot = {
  activeRuns: [run('1', 'running')],
  queueRuns: [run('2', 'pending')],
  needsInputRuns: [run('3', 'needs_input')],
  failedRuns: [run('4', 'failed')],
  completedRuns: [run('5', 'succeeded'), run('6', 'succeeded')],
} as unknown as MonitorSnapshot;

describe('runs', () => {
  test('orders runs most urgent first', () => {
    expect(allRuns(snapshot).map((r) => r.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  test('filters by status group', () => {
    const runs = allRuns(snapshot);
    expect(filterRuns(runs, 'all')).toHaveLength(6);
    expect(filterRuns(runs, 'active').map((r) => r.id)).toEqual(['1', '2']);
    expect(filterRuns(runs, 'needs_input').map((r) => r.id)).toEqual(['3']);
    expect(filterRuns(runs, 'failed').map((r) => r.id)).toEqual(['4']);
    expect(filterRuns(runs, 'done').map((r) => r.id)).toEqual(['5', '6']);
  });

  test('counts each filter', () => {
    expect(filterCounts(allRuns(snapshot))).toEqual({
      all: 6,
      active: 2,
      needs_input: 1,
      failed: 1,
      done: 2,
    });
  });

  test('cycles the filter both ways and wraps', () => {
    expect(nextFilter('all')).toBe('active');
    expect(nextFilter('done')).toBe('all');
    expect(nextFilter('all', -1)).toBe('done');
  });

  test('duration is fixed for finished runs and ticks for running ones', () => {
    const start = new Date('2026-10-11T10:00:00.000Z').getTime();
    expect(
      runDuration(
        run('a', 'succeeded', { finishedAt: '2026-10-11T10:02:00.000Z' }),
        start + 999_999,
      ),
    ).toBe(120_000);
    expect(runDuration(run('b', 'running'), start + 5_000)).toBe(5_000);
    expect(runDuration(run('c', 'running'), start - 5_000)).toBe(0); // clock skew never goes negative
  });

  test('age counts from the finish time when there is one', () => {
    const finished = new Date('2026-10-11T10:02:00.000Z').getTime();
    expect(
      runAge(run('a', 'succeeded', { finishedAt: '2026-10-11T10:02:00.000Z' }), finished + 30_000),
    ).toBe(30_000);
  });

  test('detail text includes the question or error', () => {
    const text = runDetailText(
      run('3', 'needs_input', { errorSnippet: 'Stop rule: which token?' }),
      Date.now(),
    );
    expect(text).toContain('DLA-3  Title 3');
    expect(text).toContain('Question:\nStop rule: which token?');
    expect(text).toContain('Run ID:  3');
    expect(runDetailText(run('4', 'failed', { errorSnippet: 'boom' }), Date.now())).toContain(
      'Error:\nboom',
    );
  });
});
