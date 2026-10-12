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
  test('names are unique and in tab-bar order', () => {
    const names = TABS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['Overview', 'Runs', 'Logs', 'Relay']);
  });

  test('the Runs count is active runs (running + queued), and only it has one', () => {
    const counts = Object.fromEntries(TABS.map((t) => [t.name, t.count?.(snapshot) ?? null]));
    expect(counts).toEqual({ Overview: null, Runs: '3', Logs: null, Relay: null });
  });

  test('Runs shows no count when nothing is active, and flags runs waiting for an answer', () => {
    const idle = {
      ...snapshot,
      summary: {
        ...snapshot.summary,
        counts: { ...snapshot.summary.counts, running: 0, pending: 0 },
      },
    };
    const runs = TABS.find((t) => t.name === 'Runs')!;
    expect(runs.count?.(idle)).toBeNull();
    expect(runs.alert?.(snapshot)).toBe(5);
    expect(TABS.filter((t) => t.alert).map((t) => t.name)).toEqual(['Runs']);
  });

  test('every tab can produce copy text', () => {
    for (const tab of TABS) expect(typeof tab.text(snapshot)).toBe('string');
  });

  test('every tab documents its keys', () => {
    expect(TABS.find((t) => t.name === 'Runs')!.hints.map(([key]) => key)).toEqual([
      '↑↓',
      '⏎',
      'f',
    ]);
    expect(TABS.find((t) => t.name === 'Logs')!.hints.map(([key]) => key)).toEqual([
      'l',
      'f',
      '↑↓',
    ]);
  });

  test('fallback copy text carries the run details and the overview mappings', () => {
    const text = (name: string) => TABS.find((t) => t.name === name)!.text(snapshot);
    expect(text('Runs')).toContain('Question:\nStop rule: which token?');
    expect(text('Runs')).toContain('Error:\nboom');
    expect(text('Overview')).toContain('agent-implement -> /implement');
  });
});
