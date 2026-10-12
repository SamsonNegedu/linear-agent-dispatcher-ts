import React from 'react';
import { statusColor, type RunStatus } from '../theme';
import { useTheme } from '../theme-context';
import { pad } from '../utils/format';
import { FILTER_LABEL, STATUS_LABEL, type RunFilter } from '../utils/runs';

/** A solid, fixed-width status pill: ` RUNNING `. */
export function Badge({ status }: { status: RunStatus }): React.ReactNode {
  const colors = useTheme();
  return (
    <span fg={colors.selectedFg} bg={statusColor(colors, status)} attributes={1}>
      {` ${pad(STATUS_LABEL[status], 7)} `}
    </span>
  );
}

/** Footer key hints: a dim keycap followed by what it does. */
export function KeyHints({
  hints,
}: {
  hints: ReadonlyArray<readonly [string, string]>;
}): React.ReactNode {
  const colors = useTheme();
  return (
    <text wrapMode="none" truncate>
      {hints.map(([key, label]) => (
        <React.Fragment key={key + label}>
          <span fg={colors.text} bg={colors.border}>{` ${key} `}</span>
          <span fg={colors.muted}>{` ${label}   `}</span>
        </React.Fragment>
      ))}
    </text>
  );
}

/** A titled, rounded panel with a quiet outline (or the accent when `focused`). */
export function Panel({
  title,
  focused = false,
  height,
  grow = true,
  children,
}: {
  title?: string;
  focused?: boolean;
  height?: number;
  grow?: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const colors = useTheme();
  return (
    <box
      title={title ? ` ${title} ` : undefined}
      titleColor={focused ? colors.accent : colors.muted}
      style={{
        border: true,
        borderStyle: 'rounded',
        borderColor: focused ? colors.accent : colors.border,
        flexDirection: 'column',
        flexGrow: grow ? 1 : 0,
        paddingLeft: 1,
        paddingRight: 1,
        ...(height ? { height } : {}),
      }}
    >
      {children}
    </box>
  );
}

/** The filter bar of the Runs view: `All 11  Active 2  [Needs input 1]  Failed 1  Done 7`. */
export function FilterChips({
  counts,
  active,
}: {
  counts: Record<RunFilter, number>;
  active: RunFilter;
}): React.ReactNode {
  const colors = useTheme();
  return (
    <text wrapMode="none" truncate>
      {(Object.keys(FILTER_LABEL) as RunFilter[]).map((filter) => {
        const label = ` ${FILTER_LABEL[filter]} ${counts[filter]} `;
        return filter === active ? (
          <span key={filter} fg={colors.selectedFg} bg={colors.accent} attributes={1}>
            {label}
          </span>
        ) : (
          <span key={filter} fg={colors.muted}>
            {label}
          </span>
        );
      })}
    </text>
  );
}
