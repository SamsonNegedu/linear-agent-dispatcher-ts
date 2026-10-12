import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { statusColor, type RunStatus } from '../theme';
import { useTheme } from '../theme-context';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import { getConfig } from '../utils/config';
import { columnWidths, fit } from '../utils/format';
import { relayConnectionStatus } from '../utils/relay-status';
import { Panel } from './ui';

// Room kept for the status text after a skill ("✗ not found in repo").
const STATUS_W = 20;

const TILES: ReadonlyArray<{
  label: string;
  status: RunStatus;
  count: (s: MonitorSnapshot) => number;
}> = [
  { label: 'Running', status: 'running', count: (s) => s.summary.counts.running },
  { label: 'Queued', status: 'pending', count: (s) => s.summary.counts.pending },
  { label: 'Needs input', status: 'needs_input', count: (s) => s.summary.counts.needs_input },
  { label: 'Failed', status: 'failed', count: (s) => s.summary.counts.failed },
  { label: 'Done', status: 'succeeded', count: (s) => s.summary.counts.succeeded },
];

export function OverviewView({ snapshot }: { snapshot: MonitorSnapshot }): React.ReactNode {
  const colors = useTheme();
  const { width } = useTerminalDimensions();
  const { relayEnabled, relayUrl, dispatcherUrl } = getConfig();
  const relay = relayConnectionStatus(relayEnabled, snapshot.relayHealth, colors);
  const narrow = width < 100;
  const [repoW, labelW, skillW] = columnWidths(width - 6, [
    narrow ? 16 : 22,
    narrow ? 16 : 22,
    'flex',
  ]);

  return (
    <box style={{ flexDirection: 'column', flexGrow: 1 }}>
      <box style={{ flexDirection: 'row', height: 4 }}>
        {TILES.map((tile) => {
          const count = tile.count(snapshot);
          return (
            <box
              key={tile.label}
              style={{
                flexGrow: 1,
                flexDirection: 'column',
                alignItems: 'center',
                border: true,
                borderStyle: 'rounded',
                borderColor: count > 0 ? statusColor(colors, tile.status) : colors.border,
              }}
            >
              <text fg={count > 0 ? statusColor(colors, tile.status) : colors.muted} attributes={1}>
                {String(count)}
              </text>
              <text fg={colors.muted}>{tile.label}</text>
            </box>
          );
        })}
      </box>

      <Panel title="Relay" grow={false}>
        <text wrapMode="none" truncate>
          <span fg={relay.color}>● {relay.label}</span>
          <span fg={colors.muted}>{'   '}relay </span>
          {relayUrl || '(not set)'}
          <span fg={colors.muted}>{'   '}dispatcher </span>
          {dispatcherUrl || '(not tracked)'}
        </text>
      </Panel>

      <Panel title="Repositories">
        <text fg={colors.muted} wrapMode="none" truncate>
          {fit('REPO', repoW)} {fit('LABEL', labelW)} SKILL
        </text>
        {snapshot.summary.repos.map((repo) => {
          const mappings = repo.issueLabelToSkill;
          const rows = mappings.length ? mappings : [null];
          return (
            <box key={repo.repoPath} style={{ flexDirection: 'column', marginTop: 1 }}>
              {rows.map((mapping, i) => (
                <text key={mapping?.label ?? 'none'} wrapMode="none" truncate>
                  {i === 0 ? (
                    <>
                      <span attributes={1}>{fit(repo.domainLabel, repoW - 4)}</span>
                      <span fg={repo.runningCount > 0 ? colors.running : colors.muted}>
                        {fit(repo.runningCount > 0 ? `● ${repo.runningCount}` : '', 4)}
                      </span>
                    </>
                  ) : (
                    fit('', repoW)
                  )}
                  {'  '}
                  {mapping ? (
                    <>
                      {fit(mapping.label, labelW)}
                      {'  '}
                      <span fg={colors.muted}>→ </span>
                      {fit(`/${mapping.skill}`, Math.max(8, skillW - 2 - STATUS_W))}
                      {mapping.skillFound === true ? (
                        <span fg={colors.succeeded}> ✓</span>
                      ) : mapping.skillFound === false ? (
                        <span fg={colors.failed}> ✗ not found in repo</span>
                      ) : (
                        <span fg={colors.muted}> plugin</span>
                      )}
                    </>
                  ) : (
                    <span fg={colors.failed}>no skills exposed (see routing.config.json)</span>
                  )}
                </text>
              ))}
              <text fg={colors.muted} wrapMode="none" truncate>
                {repo.repoPath}
              </text>
            </box>
          );
        })}
      </Panel>
    </box>
  );
}
