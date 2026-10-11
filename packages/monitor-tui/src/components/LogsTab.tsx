import React, { useEffect, useState } from 'react';
import { useTheme } from '../theme-context';
import { readLogTail } from '../utils/logs';

export function LogsTab(): React.ReactNode {
  const colors = useTheme();
  const [lines, setLines] = useState<string[]>(() => readLogTail());

  useEffect(() => {
    const interval = setInterval(() => {
      setLines(readLogTail());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <box
      style={{
        border: true,
        borderStyle: 'rounded',
        borderColor: colors.accent,
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
    >
      {lines.length === 0 ? (
        <text fg={colors.muted}>
          No log output yet — server logs only stream here when started via `pnpm monitor`.
        </text>
      ) : (
        <scrollbox
          style={{
            width: '100%',
            height: '100%',
            viewportOptions: { minHeight: 0, minWidth: 0 },
            contentOptions: { minHeight: 0, minWidth: 0 },
          }}
          stickyScroll
          stickyStart="bottom"
        >
          {lines.map((line, i) => <text key={i}>{line || ' '}</text>)}
        </scrollbox>
      )}
    </box>
  );
}
