import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from './App';
import { ThemeProvider } from './theme-context';

const summary = {
  counts: { pending: 1, running: 2, succeeded: 3, failed: 4, needs_input: 5 },
  repos: [
    {
      repoPath: '/repos/a',
      domainLabel: 'repo-a',
      issueLabelToSkill: [{ label: 'agent-implement', skill: 'implement', skillFound: false }],
      runningCount: 0,
      currentRuns: [],
    },
  ],
};

// Serves the monitor API from memory.
const stubFetch = (): void => {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const url = String(input);
    const data = url.includes('/monitor/summary')
      ? summary
      : url.includes('/monitor/runs')
        ? []
        : {
            relay: {
              enabled: false,
              configured: false,
              subscriberCheck: null,
              lastCheckedAt: null,
            },
          };
    return new Response(JSON.stringify({ data }));
  }) as unknown as typeof fetch;
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

// App sizes the renderer from the real terminal; give the test one.
const setTerminal = (columns: number, rows: number): void => {
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
};

const render = async (columns: number, rows: number) => {
  setTerminal(columns, rows);
  const setup = await testRender(
    <ThemeProvider>
      <App onExit={() => {}} onRunRelayScript={() => {}} />
    </ThemeProvider>,
    { width: columns, height: rows },
  );
  await settle();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  setup.renderer.destroy();
  return frame;
};

describe('App', () => {
  test('renders the header counts, every tab with its count, and the dashboard repos', async () => {
    stubFetch();
    const frame = await render(130, 32);

    expect(frame).toContain('DISPATCHER MONITOR');
    expect(frame).toContain('2 running');
    expect(frame).toContain('5 need input');
    for (const tab of [
      'Dashboard',
      'Logs',
      'Relay',
      'Runs (2/1)',
      'Needs input (5)',
      'Completed (3)',
      'Failed (4)',
    ]) {
      expect(frame).toContain(tab);
    }
    expect(frame).toContain('repo-a');
    expect(frame).toContain('agent-implement');
    expect(frame).toContain('skill not found in repo');
    expect(frame).toContain('y copy');
  });

  test('keeps the title on one line in a narrow terminal instead of breaking the border', async () => {
    stubFetch();
    const frame = await render(80, 24);

    expect(frame.split('\n')[1]).toContain('DISPATCHER MONITOR');
    expect(frame.split('\n')[2]).toMatch(/^╰─+╯$/);
  });

  test('shows the error, not a crash, when the dispatcher is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;

    expect(await render(100, 24)).toContain('Error: connect ECONNREFUSED');
  });
});
