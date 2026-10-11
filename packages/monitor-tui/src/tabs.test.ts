import { describe, expect, test } from 'bun:test';
import type { MonitorSnapshot } from './services/monitor-api.service';
import type { Run } from './types';
import { TABS } from './tabs';

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run_1',
  issueIdentifier: 'DLA-1',
  issueTitle: 'Fix the thing',
  skill: 'implement',
  repoPath: '/repos/a',
  domainLabel: 'repo-a',
  status: 'running',
  startedAt: new Date(Date.now() - 90_000).toISOString(),
  ...overrides,
});

const snapshot: MonitorSnapshot = {
  summary: {
    counts: { pending: 1, running: 2, succeeded: 3, failed: 4, needs_input: 5 },
    repos: [
      {
        repoPath: '/repos/a',
        domainLabel: 'repo-a',
        issueLabelToSkill: [{ label: 'agent-implement', skill: 'implement', skillFound: true }],
        runningCount: 0,
        currentRuns: [],
      },
    ],
  },
  activeRuns: [run()],
  queueRuns: [run({ id: 'run_2', status: 'pending' })],
  completedRuns: [run({ status: 'succeeded' })],
  failedRuns: [run({ status: 'failed', errorSnippet: 'boom' })],
  needsInputRuns: [run({ status: 'needs_input', errorSnippet: 'Stop rule: which token?' })],
  relayHealth: {
    enabled: true,
    configured: true,
    subscriberCheck: 'verified',
    lastCheckedAt: null,
  },
};

describe('TABS', () => {
  test('names are unique and in sidebar order', () => {
    const names = TABS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      'Dashboard',
      'Logs',
      'Relay',
      'Runs',
      'Needs input',
      'Completed',
      'Failed',
    ]);
  });

  test('sidebar counts come from the summary', () => {
    const counts = Object.fromEntries(TABS.map((t) => [t.name, t.count?.(snapshot) ?? null]));
    expect(counts).toEqual({
      Dashboard: null,
      Logs: null,
      Relay: null,
      Runs: '2/1',
      'Needs input': '5',
      Completed: '3',
      Failed: '4',
    });
  });

  test('Needs input shows no count when nothing is waiting', () => {
    const empty = {
      ...snapshot,
      summary: { ...snapshot.summary, counts: { ...snapshot.summary.counts, needs_input: 0 } },
    };
    expect(TABS.find((t) => t.name === 'Needs input')?.count?.(empty)).toBeNull();
  });

  test('every tab can produce copy text', () => {
    for (const tab of TABS) expect(typeof tab.text(snapshot)).toBe('string');
  });

  test('copy text carries the run details and the reason for failed / needs-input runs', () => {
    const text = (name: string) => TABS.find((t) => t.name === name)!.text(snapshot);
    expect(text('Failed')).toBe('repo-a\tDLA-1\tFix the thing\timplement\n  boom');
    expect(text('Needs input')).toContain('Stop rule: which token?');
    expect(text('Runs')).toContain('queued');
    expect(text('Dashboard')).toContain('agent-implement -> /implement');
  });
});
