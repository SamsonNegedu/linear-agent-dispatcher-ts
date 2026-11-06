import { describe, expect, test } from 'bun:test';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import type { Run, ScannerReport } from '../types';
import { TABS } from '../tabs';

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

const scanner: ScannerReport = {
  enabled: true,
  intervalSec: 60,
  lastScanAt: new Date().toISOString(),
  durationMs: 120,
  scopes: [
    {
      name: 'team:DLA',
      maxConcurrent: 2,
      inFlight: 1,
      watches: [
        {
          label: 'agent-triage',
          states: ['Triage'],
          issues: [
            {
              identifier: 'DLA-1',
              title: 'A',
              skill: 'triage',
              outcome: 'active',
              detail: 'running',
            },
            {
              identifier: 'DLA-2',
              title: 'B',
              skill: 'triage',
              outcome: 'exhausted',
              detail: '2 failed runs',
            },
            { identifier: 'DLA-3', title: 'C', outcome: 'skipped', detail: 'no repo label' },
          ],
        },
      ],
    },
  ],
};

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
  scanner,
};

describe('TABS', () => {
  test('names are unique and in tab-bar order', () => {
    const names = TABS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['Overview', 'Runs', 'Scanner', 'Logs']);
  });

  test('Runs counts active runs and Scanner counts the runs it has going; no other tab has one', () => {
    const counts = Object.fromEntries(TABS.map((t) => [t.name, t.count?.(snapshot) ?? null]));
    expect(counts).toEqual({
      Overview: null,
      Runs: '3',
      Scanner: '1',
      Logs: null,
    });
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
    expect(TABS.filter((t) => t.alert).map((t) => t.name)).toEqual(['Runs', 'Scanner']);
    // The scanner flags issues it gave up on or that wait for an answer.
    expect(TABS.find((t) => t.name === 'Scanner')!.alert?.(snapshot)).toBe(1);
  });

  test('every tab can produce copy text', () => {
    for (const tab of TABS) expect(typeof tab.text(snapshot)).toBe('string');
  });

  test('every tab documents its keys', () => {
    expect(TABS.find((t) => t.name === 'Overview')!.hints.map(([key]) => key)).toEqual(['c', 'u']);
    expect(TABS.find((t) => t.name === 'Runs')!.hints.map(([key]) => key)).toEqual([
      '↑↓',
      '⏎',
      'f',
      'x',
    ]);
    expect(TABS.find((t) => t.name === 'Logs')!.hints.map(([key]) => key)).toEqual([
      '↑↓',
      '⏎',
      'esc',
      'l',
      'f',
    ]);
  });

  test('fallback copy text carries the run details and the overview mappings', () => {
    const text = (name: string) => TABS.find((t) => t.name === name)!.text(snapshot);
    expect(text('Runs')).toContain('Question:\nStop rule: which token?');
    expect(text('Runs')).toContain('Error:\nboom');
    expect(text('Overview')).toContain('agent-implement -> /implement');
    expect(text('Scanner')).toContain('DLA-2\tB\t/triage\tGAVE UP (2 failed runs)');
  });
});
