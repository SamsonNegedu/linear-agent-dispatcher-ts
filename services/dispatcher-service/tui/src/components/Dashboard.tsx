import React from 'react';
import { useTheme } from '../theme-context';
import type { MonitorSummary } from '../types';

export function Dashboard({ summary }: { summary: MonitorSummary }): React.ReactNode {
  const colors = useTheme();
  const relayEnabled = process.env.RELAY_ENABLED === 'true';
  const relayUrl = process.env.RELAY_URL || '';
  const dispatcherUrl = process.env.RELAY_DISPATCHER_URL || '';

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <box style={{ height: 5, flexDirection: 'column' }}>
        <text attributes={1}>Connectivity</text>
        <text wrapMode="none" truncate>
          {'  Relay: '}
          <span fg={relayEnabled ? colors.succeeded : colors.failed}>
            {relayEnabled ? '● Connected' : '● Not connected'}
          </span>
        </text>
        {relayEnabled ? (
          <>
            <text fg={colors.muted} wrapMode="none" truncate>
              {`  Relay server: ${relayUrl || '(not set)'}`}
            </text>
            <text fg={colors.muted} wrapMode="none" truncate>
              {`  Dispatcher URL: ${dispatcherUrl || '(not tracked)'}`}
            </text>
          </>
        ) : (
          <text fg={colors.muted} wrapMode="none" truncate>
            {'  See Relay tab to connect'}
          </text>
        )}
      </box>
      <text> </text>
      <text attributes={1}>Repo Status</text>
      <box style={{ flexDirection: 'column', flexGrow: 1 }}>
        {summary.repos.map((repo) => (
          <box key={repo.repoPath} style={{ flexDirection: 'column', marginBottom: 1 }}>
            <text>
              {'  '}System/Domain Label: <span attributes={1}>{repo.domainLabel}</span>{' '}
              <span fg={repo.runningCount > 0 ? colors.running : colors.muted}>({repo.runningCount} running)</span>
            </text>
            <text fg={colors.accent}>  Repo Path:
              <span fg={colors.muted}>{repo.repoPath}</span>
            </text>
            {repo.modes.length > 0 ? (
              <text>
                {'  '}
                <span fg={colors.accent}>Agent Handoff Label:</span>{' '}
                {repo.modes.map((m, i) => (
                  <span key={m.label}>
                    {i > 0 ? '  ' : ''}
                    {m.label} → Repo skill: {m.skill}
                  </span>
                ))}
              </text>
            ) : (
              <text fg={colors.muted}>  Modes: none configured</text>
            )}
          </box>
        ))}
      </box>
    </box>
  );
}
