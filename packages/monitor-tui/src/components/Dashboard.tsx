import React from 'react';
import { useTheme } from '../theme-context';
import { getConfig } from '../utils/config';
import { pad } from '../utils/format';
import { relayConnectionStatus } from '../utils/relay-status';
import type { MonitorSummary, RelayHealth } from '../types';

const LABEL_WIDTH = 16;

export function Dashboard({
  summary,
  relayHealth,
}: {
  summary: MonitorSummary;
  relayHealth: RelayHealth | null;
}): React.ReactNode {
  const colors = useTheme();
  const { relayEnabled, relayUrl, dispatcherUrl } = getConfig();
  const status = relayConnectionStatus(relayEnabled, relayHealth, colors);

  return (
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <text fg={colors.accent} attributes={1}>
        Connectivity
      </text>
      <text wrapMode="none" truncate>
        {'  '}
        <span fg={colors.muted}>{pad('Relay:', LABEL_WIDTH)}</span>
        <span fg={status.color}>● {status.label}</span>
      </text>
      {relayEnabled ? (
        <>
          <text wrapMode="none" truncate>
            {'  '}
            <span fg={colors.muted}>{pad('Relay server:', LABEL_WIDTH)}</span>
            {relayUrl || '(not set)'}
          </text>
          <text wrapMode="none" truncate>
            {'  '}
            <span fg={colors.muted}>{pad('Dispatcher URL:', LABEL_WIDTH)}</span>
            {dispatcherUrl || '(not tracked)'}
          </text>
        </>
      ) : (
        <text fg={colors.muted} wrapMode="none" truncate>
          {' '.repeat(LABEL_WIDTH + 2)}see Relay tab to connect
        </text>
      )}
      <text> </text>

      <text fg={colors.accent} attributes={1}>
        Repo Status
      </text>
      <box style={{ flexDirection: 'column', flexGrow: 1 }}>
        {summary.repos.map((repo) => (
          <box key={repo.repoPath} style={{ flexDirection: 'column', marginBottom: 1 }}>
            <text wrapMode="none" truncate>
              {'  '}
              <span fg={colors.muted}>{pad('Domain:', LABEL_WIDTH)}</span>
              <span attributes={1}>{repo.domainLabel}</span>{' '}
              <span fg={repo.runningCount > 0 ? colors.running : colors.muted}>({repo.runningCount} running)</span>
            </text>
            <text wrapMode="none" truncate>
              {'  '}
              <span fg={colors.muted}>{pad('Repo path:', LABEL_WIDTH)}</span>
              {repo.repoPath}
            </text>
            {repo.issueLabelToSkill.length > 0 ? (
              <text wrapMode="none" truncate>
                {'  '}
                <span fg={colors.muted}>{pad('Issue label:', LABEL_WIDTH)}</span>
                {repo.issueLabelToSkill.map((m, i) => (
                  <span key={m.label}>
                    {i > 0 ? '  ' : ''}
                    {m.label} <span fg={colors.muted}>→ invokes skill</span> {m.skill}
                  </span>
                ))}
              </text>
            ) : (
              <text fg={colors.muted} wrapMode="none" truncate>
                {'  '}
                <span>{pad('Issue label:', LABEL_WIDTH)}</span>
                none configured
              </text>
            )}
          </box>
        ))}
      </box>
    </box>
  );
}
