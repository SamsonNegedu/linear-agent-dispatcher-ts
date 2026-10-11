import React from 'react';
import { useTheme } from '../theme-context';
import type { Run } from '../types';
import { Dot } from './Dot';

// Runs where the agent stopped on purpose to ask something (its final reply began with "Stop rule:").
// The question is also posted on the Linear issue; answer it there and re-trigger the run.
export function NeedsInputTab({ runs }: { runs: Run[] }): React.ReactNode {
  const colors = useTheme();
  return (
    <box style={{ border: true, borderStyle: 'rounded', borderColor: colors.accent, flexDirection: 'column', flexGrow: 1 }}>
      {runs.length === 0 ? (
        <text fg={colors.muted}>Nothing waiting on you</text>
      ) : (
        <scrollbox style={{ flexGrow: 1 }}>
          {runs.map((run) => (
            <box key={run.id} style={{ flexDirection: 'column', marginBottom: 1 }}>
              <text>
                <Dot status="needs_input" />{' '}
                <span fg={colors.needs_input} attributes={1}>
                  {run.domainLabel}
                </span>{' '}
                | {run.issueIdentifier}: {run.issueTitle || '(no title)'} <span fg={colors.muted}>/{run.skill}</span>
              </text>
              {run.errorSnippet ? (
                <text fg={colors.muted} wrapMode="word">
                  {'    '}
                  {run.errorSnippet}
                </text>
              ) : null}
            </box>
          ))}
        </scrollbox>
      )}
    </box>
  );
}
