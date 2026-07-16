import React from 'react';
import { statusColor, type RunStatus } from '../theme';
import { useTheme } from '../theme-context';

export function Dot({ status }: { status: RunStatus }): React.ReactNode {
  const colors = useTheme();
  return <span fg={statusColor(colors, status)}>●</span>;
}
