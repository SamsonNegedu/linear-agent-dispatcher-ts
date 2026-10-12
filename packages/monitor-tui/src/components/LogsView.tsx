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
  const [raw, setRaw] = useState<string[]>(() => readLogTail());
  const [level, setLevel] = useState<LevelFilter>('all');
  const [follow, setFollow] = useState(true);
  const scroll = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    const timer = setInterval(() => setRaw(readLogTail()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    else if (key.name === 'up' || key.name === 'k') scrollBy(-1);
    else if (key.name === 'down' || key.name === 'j') scrollBy(1);
    else if (key.name === 'pageup') scrollBy(-15);
    else if (key.name === 'pagedown') scrollBy(15);
    else if (key.name === 'end') setFollow(true);
  });

  const levelColor: Record<LogLevel, string> = {
    ERROR: colors.failed,
    WARN: colors.pending,
    LOG: colors.muted,
    DEBUG: colors.muted,
    VERBOSE: colors.muted,
    OTHER: colors.muted,
  };

  return (
    <Panel title={`Logs · ${FILTER_LABEL[level]} · ${follow ? 'following' : 'paused'}`} focused>
      {lines.length === 0 ? (
        <text fg={colors.muted}>
          {raw.length === 0
            ? 'No log output yet. Server logs stream here when started via `pnpm monitor` or `pnpm dev:up`.'
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
                <span fg={colors.muted}>{(line.time ?? '').padEnd(11)} </span>
                <span fg={levelColor[line.level]} attributes={line.level === 'ERROR' ? 1 : 0}>
                  {line.level === 'OTHER' ? '    ' : line.level.padEnd(5).slice(0, 5)}{' '}
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
  );
}
