import React, { useEffect, useRef, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { useTheme } from '../theme-context';
import { readLogTail } from '../utils/logs';
import {
  matchesLevel,
  nextLevelFilter,
  parseLogLine,
  type LevelFilter,
  type LogLevel,
} from '../utils/log-lines';
import { listRunLogs, readRunLogTail, type RunLogEntry } from '../utils/run-log';
import { ago, fit } from '../utils/format';
import { useNow } from '../hooks/useClock';
import { Panel } from './ui';

const FILTER_LABEL: Record<LevelFilter, string> = {
  all: 'All',
  warn: 'Warnings+',
  error: 'Errors',
};

export function LogsView({
  registerCopy,
}: {
  registerCopy: (copy: () => string) => void;
}): React.ReactNode {
  const colors = useTheme();
  const now = useNow(1000);
  const [runs, setRuns] = useState<RunLogEntry[]>(() => listRunLogs());
  // 'server' or a run log path; followed by path so new runs don't move the cursor.
  const [selected, setSelected] = useState<string>('server');
  const [focus, setFocus] = useState<'list' | 'log'>('list');
  const read = (): string[] => (selected === 'server' ? readLogTail() : readRunLogTail(selected));
  const [raw, setRaw] = useState<string[]>(() => read());
  const [level, setLevel] = useState<LevelFilter>('all');
  const [follow, setFollow] = useState(true);
  const scroll = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    setRaw(read());
    setFollow(true);
    const timer = setInterval(() => {
      setRaw(read());
      setRuns(listRunLogs());
    }, 1000);
    return () => clearInterval(timer);
  }, [selected]);

  const ids = ['server', ...runs.map((r) => r.path)];
  const index = Math.max(0, ids.indexOf(selected));
  const select = (to: number): void => setSelected(ids[Math.max(0, Math.min(ids.length - 1, to))]);
  const selectedRun = runs.find((r) => r.path === selected);

  const lines = raw.map(parseLogLine).filter((l) => matchesLevel(l, level));
  registerCopy(() => raw.join('\n'));

  const scrollBy = (rows: number): void => {
    setFollow(false);
    if (scroll.current) scroll.current.scrollTop = Math.max(0, scroll.current.scrollTop + rows);
  };

  useKeyboard((key) => {
    if (key.ctrl || key.meta) return;
    if (key.name === 'l') setLevel(nextLevelFilter);
    else if (key.name === 'f') setFollow((f) => !f);
    else if (focus === 'list') {
      if (key.name === 'up' || key.name === 'k') select(index - 1);
      else if (key.name === 'down' || key.name === 'j') select(index + 1);
      else if (key.name === 'home') select(0);
      else if (key.name === 'end') select(ids.length - 1);
      else if (key.name === 'return' || key.name === 'enter' || key.name === 'right')
        setFocus('log');
    } else {
      if (key.name === 'up' || key.name === 'k') scrollBy(-1);
      else if (key.name === 'down' || key.name === 'j') scrollBy(1);
      else if (key.name === 'pageup') scrollBy(-15);
      else if (key.name === 'pagedown') scrollBy(15);
      else if (key.name === 'end') setFollow(true);
      else if (key.name === 'escape' || key.name === 'left') setFocus('list');
    }
  });

  const levelColor: Record<LogLevel, string> = {
    ERROR: colors.failed,
    WARN: colors.pending,
    LOG: colors.muted,
    DEBUG: colors.muted,
    VERBOSE: colors.muted,
    OTHER: colors.muted,
  };

  const title = selectedRun ? `${selectedRun.issue} · /${selectedRun.skill}` : 'Server';

  return (
    <box style={{ flexDirection: 'row', flexGrow: 1 }}>
      <box style={{ width: 36, flexDirection: 'column' }}>
        <Panel title="Sources" focused={focus === 'list'}>
          {ids.map((id) => {
            const run = runs.find((r) => r.path === id);
            const on = id === selected;
            return (
              <box
                key={id}
                style={{ height: 1, backgroundColor: on ? colors.rowSelected : undefined }}
              >
                <text wrapMode="none" truncate>
                  <span fg={colors.accent}>{on ? '▌ ' : '  '}</span>
                  {run ? (
                    <>
                      <span fg={run.active ? colors.running : colors.muted}>
                        {run.active ? '● ' : '○ '}
                      </span>
                      <span attributes={1}>{fit(run.issue, 9)}</span>{' '}
                      <span fg={colors.muted}>
                        {fit(`/${run.skill}`, 10)} {ago(Math.max(0, now - run.mtime))}
                      </span>
                    </>
                  ) : (
                    <span attributes={1}>Server</span>
                  )}
                </text>
              </box>
            );
          })}
        </Panel>
      </box>
      <Panel
        title={`${title} · ${FILTER_LABEL[level]} · ${follow ? 'following' : 'paused'}`}
        focused={focus === 'log'}
      >
        {lines.length === 0 ? (
          <text fg={colors.muted}>
            {raw.length === 0
              ? selectedRun
                ? 'Nothing logged for this run yet.'
                : 'No log output yet. Server logs stream here when started via `pnpm monitor` or `pnpm dev:up`.'
              : 'No lines at this level. Press l to change it.'}
          </text>
        ) : (
          <scrollbox
            ref={scroll}
            style={{
              width: '100%',
              height: '100%',
              viewportOptions: { minHeight: 0, minWidth: 0 },
              contentOptions: { minHeight: 0, minWidth: 0 },
            }}
            stickyScroll={follow}
            stickyStart="bottom"
          >
            {lines.map((line, i) => {
              const attention = /\[NEEDS_ATTENTION\]|\[ERROR\]|\[INPUT_NEEDED\]/.test(line.message);
              return (
                <text key={i} wrapMode="none" truncate>
                  <span fg={colors.muted}>{(line.time ?? '').padEnd(selectedRun ? 0 : 11)} </span>
                  <span fg={levelColor[line.level]} attributes={line.level === 'ERROR' ? 1 : 0}>
                    {selectedRun
                      ? ''
                      : line.level === 'OTHER'
                        ? '    '
                        : line.level.padEnd(5).slice(0, 5)}{' '}
                  </span>
                  {line.context ? (
                    <span fg={colors.accent}>{line.context.padEnd(18).slice(0, 18)} </span>
                  ) : null}
                  <span fg={attention ? colors.needs_input : undefined}>{line.message || ' '}</span>
                </text>
              );
            })}
          </scrollbox>
        )}
      </Panel>
    </box>
  );
}
