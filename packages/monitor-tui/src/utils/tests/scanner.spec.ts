import { describe, expect, test } from 'bun:test';
import type { ScannerReport } from '../../types';
import {
  scanTiming,
  scannerAttention,
  scannerInFlight,
  scannerRows,
  scannerText,
} from '../scanner';

const report: ScannerReport = {
  enabled: true,
  intervalSec: 60,
  lastScanAt: '2026-11-06T22:00:00.000Z',
  durationMs: 230,
  scopes: [
    {
      name: 'team:DLA',
      maxConcurrent: 1,
      inFlight: 1,
      watches: [
        { label: 'agent-triage', states: ['Triage'], issues: [] },
        {
          label: 'agent-implement',
          states: ['Todo', 'Backlog'],
          issues: [
            { identifier: 'DLA-1', title: 'One', skill: 'implement', outcome: 'active' },
            { identifier: 'DLA-2', title: 'Two', outcome: 'needs_input' },
          ],
        },
      ],
    },
    { name: 'project:p', maxConcurrent: 1, inFlight: 0, error: 'boom', watches: [] },
  ],
};

describe('scannerRows', () => {
  test('lists scope, watch and issue lines in order, with a line for an empty watch', () => {
    expect(scannerRows(report).map((row) => row.kind)).toEqual([
      'scope',
      'gap',
      'watch',
      'empty',
      'gap',
      'watch',
      'issue',
      'issue',
      'gap',
      'scope',
    ]);
  });

  test('a scope shows its slots and its error', () => {
    const rows = scannerRows(report);
    const [first, last] = [rows[0], rows[rows.length - 1]];
    expect(first).toMatchObject({ text: 'team:DLA', slots: '1/1 running' });
    expect(last).toMatchObject({ text: 'project:p', error: 'boom' });
  });

  test('a watch names its label and every state', () => {
    expect(scannerRows(report)[5]).toEqual({
      kind: 'watch',
      text: 'agent-implement in Todo, Backlog',
    });
  });
});

describe('scanner counts', () => {
  test('runs in flight add up across scopes', () => {
    expect(scannerInFlight(report)).toBe(1);
  });

  test('attention counts gave-up and waiting-for-answer issues only', () => {
    expect(scannerAttention(report)).toBe(1);
  });
});

describe('scanTiming', () => {
  const at = (seconds: number) => new Date(report.lastScanAt!).getTime() + seconds * 1000;

  test('shows age, duration and the time to the next scan', () => {
    expect(scanTiming(report, at(12))).toBe('last scan 12s ago (230ms) · next in 48s');
  });

  test('never counts below zero when a scan is overdue', () => {
    expect(scanTiming(report, at(75))).toContain('next in 0s');
  });

  test('says so before the first scan', () => {
    expect(scanTiming({ enabled: true, scopes: [] }, Date.now())).toBe('no scan yet');
  });
});

describe('scannerText', () => {
  test('copies each issue with its outcome and detail', () => {
    expect(scannerText(report)).toContain('DLA-2\tTwo\t—\tINPUT');
    expect(scannerText(report)).toContain('project:p  0/1 running  ERROR: boom');
  });

  test('says how to turn it on when it is off', () => {
    expect(scannerText({ enabled: false, scopes: [] })).toContain('routing.config.json');
  });
});
