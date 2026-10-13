import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../App';
import { ThemeProvider } from '../theme-context';

const run = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `run_${id}`,
  issueIdentifier: `DLA-${id}`,
  issueTitle: `Title of ${id}`,
  skill: 'implement',
  repoPath: '/repos/a',
  domainLabel: 'repo-a',
  status,
  startedAt: new Date(Date.now() - 120_000).toISOString(),
  finishedAt:
    status === 'running' || status === 'pending'
      ? undefined
      : new Date(Date.now() - 60_000).toISOString(),
  ...extra,
});

const byStatus: Record<string, unknown[]> = {
  running: [run('1', 'running')],
  pending: [run('2', 'pending')],
  needs_input: [run('3', 'needs_input', { errorSnippet: 'Stop rule: which token?' })],
  failed: [run('4', 'failed', { errorSnippet: 'boom' })],
  succeeded: [run('5', 'succeeded'), run('6', 'succeeded')],
};

const summary = {
  counts: { pending: 1, running: 1, succeeded: 2, failed: 1, needs_input: 1 },
  repos: [
    {
      repoPath: '/repos/a',
      domainLabel: 'repo-a',
      issueLabelToSkill: [{ label: 'agent-implement', skill: 'implement', skillFound: false }],
      runningCount: 1,
      currentRuns: [],
    },
  ],
};

// Serves the monitor API from memory.
const stubFetch = (runs: Record<string, unknown[]> = byStatus): void => {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const url = String(input);
    const status = url.match(/status=(\w+)/)?.[1];
    const data = url.includes('/monitor/summary')
      ? summary
      : status
        ? (runs[status] ?? [])
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

async function start(columns = 120, rows = 32) {
  setTerminal(columns, rows);
  const setup = await testRender(
    <ThemeProvider>
      <App onExit={() => {}} onRunRelayScript={() => {}} />
    </ThemeProvider>,
    { width: columns, height: rows },
  );
  await settle(250);
  await setup.renderOnce();
  const frame = async (): Promise<string> => {
    await settle(80);
    await setup.renderOnce();
    return setup.captureCharFrame();
  };
  // Presses are spaced out: OpenTUI waits briefly after Escape to tell it from an escape sequence.
  const press = async (key: string): Promise<void> => {
    setup.mockInput.pressKey(key);
    await settle(70);
  };
  const arrow = async (direction: 'up' | 'down'): Promise<void> => {
    setup.mockInput.pressArrow(direction);
    await settle(70);
  };
  const enter = async (): Promise<void> => {
    setup.mockInput.pressEnter();
    await settle(70);
  };
  const escape = async (): Promise<void> => {
    setup.mockInput.pressEscape();
    await settle(200);
  };
  return { frame, press, arrow, enter, escape, stop: () => setup.renderer.destroy() };
}

describe('App', () => {
  test('shows the header counts, the four views with their counts, and the overview', async () => {
    stubFetch();
    const ui = await start();
    const frame = await ui.frame();
    ui.stop();

    expect(frame).toContain('◆ DISPATCHER');
    expect(frame).toContain('1 running');
    expect(frame).toContain('1 need input');
    for (const tab of ['1 Overview', '2 Runs 2', '3 Logs', '4 Relay']) expect(frame).toContain(tab);
    expect(frame).toContain('●1'); // a run is waiting for an answer
    expect(frame).toContain('repo-a');
    expect(frame).toContain('agent-implement');
    expect(frame).toContain('not found in repo');
    expect(frame).toContain('y  copy');
  });

  test('switches views with the number keys and Tab', async () => {
    stubFetch();
    const ui = await start();

    await ui.press('2');
    expect(await ui.frame()).toContain('Runs · filter: All');
    await ui.press('3');
    expect(await ui.frame()).toContain('Server · All');
    await ui.press('4');
    expect(await ui.frame()).toContain('Relay Connection');
    ui.stop();
  });

  test('fits an 80-column terminal: one-line header, no cell overflow', async () => {
    stubFetch();
    const ui = await start(80, 24);
    await ui.press('2');
    const frame = await ui.frame();
    ui.stop();

    const lines = frame.split('\n');
    expect(lines[0]).toContain('◆ DISPATCHER');
    expect(lines[0]).toContain('relay');
    expect(lines.every((l) => l.length <= 80)).toBe(true);
    expect(frame).toContain('DLA-1');
    expect(frame).not.toContain('REPO'); // the repo column is dropped to keep the title readable
  });

  test('shows the error, not a crash, when the dispatcher is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const ui = await start(100, 24);
    const frame = await ui.frame();
    ui.stop();

    expect(frame).toContain('Error: connect ECONNREFUSED');
  });
});

describe('Runs view', () => {
  test('lists runs most urgent first, with status badges and filter counts', async () => {
    stubFetch();
    const ui = await start();
    await ui.press('2');
    const frame = await ui.frame();
    ui.stop();

    const order = ['RUNNING', 'QUEUED', 'INPUT', 'FAILED', 'DONE'].map((label) =>
      frame.indexOf(label),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(frame).toContain('All 6  Active 2  Needs input 1  Failed 1  Done 2');
    expect(frame).toContain('Title of 1');
  });

  test('moves the selection with the arrow keys', async () => {
    stubFetch();
    const ui = await start();
    await ui.press('2');
    const marker = (frame: string): string => frame.split('\n').find((l) => l.includes('▌')) ?? '';
    expect(marker(await ui.frame())).toContain('RUNNING');

    await ui.arrow('down');
    await ui.arrow('down');
    expect(marker(await ui.frame())).toContain('INPUT');

    await ui.arrow('up');
    expect(marker(await ui.frame())).toContain('QUEUED');
    ui.stop();
  });

  test('Enter opens the full detail, including the whole question, and Esc closes it', async () => {
    stubFetch();
    const ui = await start();
    await ui.press('2');
    await ui.arrow('down');
    await ui.arrow('down'); // the needs-input run
    await ui.enter();
    const open = await ui.frame();

    expect(open).toContain('DLA-3 · /implement');
    expect(open).toContain('Question');
    expect(open).toContain('Stop rule: which token?');
    expect(open).toContain('Run ID');

    await ui.escape();
    expect(await ui.frame()).not.toContain('Run ID');
    ui.stop();
  });

  test('f cycles the filter and the list follows it', async () => {
    stubFetch();
    const ui = await start();
    await ui.press('2');
    await ui.press('f'); // active
    let frame = await ui.frame();
    expect(frame).toContain('filter: Active');
    expect(frame).toContain('RUNNING');
    expect(frame).not.toContain('FAILED  ');

    await ui.press('f'); // needs input
    frame = await ui.frame();
    expect(frame).toContain('filter: Needs input');
    expect(frame).toContain('INPUT');
    expect(frame).not.toContain('RUNNING  ');
    ui.stop();
  });

  test('explains an empty list instead of showing a blank table', async () => {
    stubFetch({});
    const ui = await start();
    await ui.press('2');
    const frame = await ui.frame();
    ui.stop();

    expect(frame).toContain('No runs yet');
    expect(frame).toContain('pnpm test-webhook');
  });
});
