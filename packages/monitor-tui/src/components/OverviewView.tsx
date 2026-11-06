import React from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { statusColor, type RunStatus } from '../theme';
import { useTheme } from '../theme-context';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import { getConfig } from '../utils/config';
import { columnWidths, fit, pad } from '../utils/format';
import { relayConnectionStatus } from '../utils/relay-status';
import type { RelayActions } from '../types';
import { RelayActionForm } from './RelayActionForm';
import { Panel } from './ui';

// Width of the label column in the Relay panel.
const RELAY_LABEL_W = 12;

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

export function OverviewView({
  snapshot,
  relay: relayActions,
}: {
  snapshot: MonitorSnapshot;
  relay: RelayActions;
}): React.ReactNode {
  const colors = useTheme();
  const { width } = useTerminalDimensions();
  const {
    relayEnabled,
    relayUrl,
    dispatcherUrl,
    relaySubscriberId: subscriberId,
    relaySubscriberSecret: secret,
  } = getConfig();
  const secretDisplay = secret ? `${secret.slice(0, 6)}...${secret.slice(-4)}` : '(none)';
  const { mode, setMode } = relayActions;
  useKeyboard((key) => {
    if (mode !== 'idle') return;
    if (key.name === 'c') setMode('connect');
    if (key.name === 'u') setMode('update');
  });
  const relay = relayConnectionStatus(relayEnabled, snapshot.relayHealth, colors);
  if (mode !== 'idle') return <RelayActionForm {...relayActions} />;

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

      <Panel title="Relay · c connect · u update" grow={false}>
        <text wrapMode="none" truncate>
          <span fg={relay.color}>● {relay.label}</span>
        </text>
        {(
          [
            ['Relay', relayUrl || '(not set)'],
            ['Dispatcher', dispatcherUrl || '(not tracked)'],
            ['Subscriber', subscriberId || '(none)'],
            ['Secret', secretDisplay],
          ] as const
        ).map(([label, value]) => (
          <text key={label} wrapMode="none" truncate>
            <span fg={colors.muted}>{pad(`${label}`, RELAY_LABEL_W)}</span>
            {value}
          </text>
        ))}
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
