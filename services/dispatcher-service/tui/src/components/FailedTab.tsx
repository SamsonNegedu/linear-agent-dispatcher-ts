import React from 'react';
import { useTheme } from '../theme-context';
import { truncate } from '../utils/format';
import type { Run } from '../types';
import { Dot } from './Dot';

export function FailedTab({ runs }: { runs: Run[] }): React.ReactNode {
  const colors = useTheme();
  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1 }}>
      {runs.length === 0 ? (
        <text fg={colors.muted}>No failed runs</text>
      ) : (
        <scrollbox style={{ flexGrow: 1 }}>
          {runs.map((run) => (
            <box key={run.id} style={{ flexDirection: 'column', marginBottom: 1 }}>
              <text>
                <Dot status="failed" />{' '}
                <span fg={colors.failed} attributes={1}>
                  {run.domainLabel}
                </span>{' '}
                | {run.issueIdentifier}: {run.issueTitle || '(no title)'}
              </text>
              {run.errorSnippet ? (
                <text fg={colors.failed}>
                  {'    '}
                  {truncate(run.errorSnippet, 100)}
                </text>
              ) : null}
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  );
}
