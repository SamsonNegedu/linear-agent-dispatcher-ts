import React from 'react';
import type { RunStatus } from '../theme';
import { useTheme } from '../theme-context';
import { pad } from '../utils/format';
import type { RowColumn } from '../types';
import { Dot } from './Dot';

export function RunTable({
  columns,
  rows,
  status,
  emptyLabel,
}: {
  columns: RowColumn[];
  rows: string[][];
  status: RunStatus;
  emptyLabel: string;
}): React.ReactNode {
  const colors = useTheme();
  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1 }}>
      <text fg={colors.muted} attributes={1} wrapMode="none" truncate>
        {'  '}
        {columns.map((c) => pad(c.label, c.width)).join('  ')}
      </text>
      {rows.length === 0 ? (
        <text fg={colors.muted}>{emptyLabel}</text>
      ) : (
        <scrollbox style={{ flexGrow: 1 }}>
          {rows.map((row, i) => (
            <box key={i} style={{ flexDirection: 'row' }}>
              <text wrapMode="none" truncate>
                <Dot status={status} /> {row.map((cell, j) => pad(cell, columns[j].width)).join('  ')}
              </text>
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  );
}
