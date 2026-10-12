import React, { useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { statusColor } from '../theme';
import { useTheme } from '../theme-context';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import { useNow } from '../hooks/useClock';
import { ago, columnWidths, fit, formatTime } from '../utils/format';
import {
  FILTER_LABEL,
  allRuns,
  filterCounts,
  filterRuns,
  nextFilter,
  reasonLabel,
  runAge,
  runDetailText,
  runDuration,
  type RunFilter,
} from '../utils/runs';
import { Badge, FilterChips, Panel } from './ui';

// Rows the app itself uses: header, tab bar, divider, footer.
const APP_ROWS = 4;

export function RunsView({
  snapshot,
  registerCopy,
}: {
  snapshot: MonitorSnapshot;
  registerCopy: (copy: () => string) => void;
}): React.ReactNode {
  const colors = useTheme();
  const { width, height } = useTerminalDimensions();
  const now = useNow(1000);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const offset = useRef(0);

  const runs = allRuns(snapshot);
  const counts = filterCounts(runs);
  const visible = filterRuns(runs, filter);
  // Follow the selected run by id, so a refresh that reorders the list doesn't move the cursor.
  const found = visible.findIndex((r) => r.id === selectedId);
  const index = found === -1 ? 0 : found;
  const selected = visible[index];

  // The detail panel is as tall as its text: borders(2), status, title, repo, run id and start
  // time (5), plus a blank line and the reason when there is one.
  const textWidth = Math.max(20, width - 8);
  const lines = (text: string): number => Math.max(1, Math.ceil(text.length / textWidth));
  const detailRows =
    detailOpen && selected
      ? 7 +
        lines(selected.issueTitle || '(no title)') -
        1 +
        (selected.errorSnippet ? 2 + lines(selected.errorSnippet) : 0)
      : 0;

  // chips(1) + panel borders(2) + column header(1)
  const listRows = Math.max(1, height - APP_ROWS - 4 - detailRows);
  if (index < offset.current) offset.current = index;
  else if (index >= offset.current + listRows) offset.current = index - listRows + 1;
  offset.current = Math.max(0, Math.min(offset.current, Math.max(0, visible.length - listRows)));
  const window = visible.slice(offset.current, offset.current + listRows);

  registerCopy(() =>
    detailOpen && selected
      ? runDetailText(selected, now)
      : visible
          .map(
            (r) =>
              `${r.domainLabel}\t${r.issueIdentifier || '—'}\t${r.issueTitle || '(no title)'}\t${r.skill}\t${r.status}`,
          )
          .join('\n'),
  );

  const move = (to: number): void => {
    const next = visible[Math.max(0, Math.min(visible.length - 1, to))];
    if (next) setSelectedId(next.id);
  };

  useKeyboard((key) => {
    if (key.ctrl || key.meta) return;
    if (key.name === 'down' || key.name === 'j') move(index + 1);
    else if (key.name === 'up' || key.name === 'k') move(index - 1);
    else if (key.name === 'pagedown') move(index + listRows);
    else if (key.name === 'pageup') move(index - listRows);
    else if (key.name === 'home' || key.name === 'g') move(0);
    else if (key.name === 'end' || (key.name === 'g' && key.shift)) move(visible.length - 1);
    else if (key.name === 'return' || key.name === 'enter') setDetailOpen((open) => !open);
    else if (key.name === 'escape') setDetailOpen(false);
    else if (key.name === 'f') {
      setFilter((f) => nextFilter(f, key.shift ? -1 : 1));
      setSelectedId(null);
      offset.current = 0;
    }
  });

  // Columns the terminal has room for: the title always stays; skill and repo drop out first.
  const showSkill = width >= 100;
  const showRepo = width >= 84;
  const [statusW, repoW, issueW, titleW, skillW, ageW] = columnWidths(
    width - 8,
    [9, showRepo ? 18 : 0, 9, 'flex', showSkill ? 14 : 0, 9],
    { gap: 2, minFlex: 16 },
  );
  const cell = (text: string, w: number, on: boolean): string => (on ? `${fit(text, w)}  ` : '');

  return (
    <box style={{ flexDirection: 'column', flexGrow: 1 }}>
      <Panel title={`Runs · filter: ${FILTER_LABEL[filter]}`} focused={!detailOpen}>
        <FilterChips counts={counts} active={filter} />
        <text fg={colors.muted} wrapMode="none" truncate>
          {'  '}
          {fit('STATUS', statusW)} {cell('REPO', repoW, showRepo)}
          {fit('ISSUE', issueW)} {fit('TITLE', titleW)} {cell('SKILL', skillW, showSkill)}
          {fit('AGE', ageW)}
        </text>
        {visible.length === 0 ? (
          <box style={{ flexDirection: 'column', paddingTop: 1 }}>
            <text fg={colors.muted}>
              {runs.length === 0
                ? 'No runs yet. Label a Linear issue with a repo label and agent-<skill>, or run `pnpm test-webhook`.'
                : `No ${FILTER_LABEL[filter].toLowerCase()} runs. Press f to change the filter.`}
            </text>
          </box>
        ) : (
          window.map((run) => {
            const isSelected = run.id === selected?.id;
            return (
              <box
                key={run.id}
                style={{ height: 1, backgroundColor: isSelected ? colors.rowSelected : undefined }}
              >
                <text wrapMode="none" truncate>
                  <span fg={colors.accent}>{isSelected ? '▌ ' : '  '}</span>
                  <Badge status={run.status} />
                  {'  '}
                  {cell(run.domainLabel, repoW, showRepo)}
                  <span attributes={1}>{fit(run.issueIdentifier || '—', issueW)}</span>
                  {'  '}
                  {fit(run.issueTitle || '(no title)', titleW)}
                  {'  '}
                  <span fg={colors.muted}>{cell(`/${run.skill}`, skillW, showSkill)}</span>
                  <span fg={run.status === 'running' ? colors.running : colors.muted}>
                    {fit(
                      run.status === 'running'
                        ? formatTime(runDuration(run, now))
                        : ago(runAge(run, now)),
                      ageW,
                    )}
                  </span>
                </text>
              </box>
            );
          })
        )}
      </Panel>

      {detailOpen && selected ? (
        <Panel
          title={`${selected.issueIdentifier || selected.id} · /${selected.skill}`}
          focused
          height={detailRows}
          grow={false}
        >
          <text wrapMode="none" truncate>
            <Badge status={selected.status} />
            <span fg={colors.muted}>
              {'  '}
              {selected.status === 'running'
                ? `running for ${formatTime(runDuration(selected, now))}`
                : `${selected.finishedAt ? 'took' : 'queued'} ${formatTime(runDuration(selected, now))} · ${ago(runAge(selected, now))}`}
            </span>
          </text>
          <text attributes={1} wrapMode="word">
            {selected.issueTitle || '(no title)'}
          </text>
          <text wrapMode="none" truncate>
            <span fg={colors.muted}>{fit('Repo', 9)}</span>
            {selected.domainLabel} <span fg={colors.muted}>{selected.repoPath}</span>
          </text>
          <text wrapMode="none" truncate>
            <span fg={colors.muted}>{fit('Run ID', 9)}</span>
            {selected.id}
          </text>
          <text wrapMode="none" truncate>
            <span fg={colors.muted}>{fit('Started', 9)}</span>
            {new Date(selected.startedAt).toLocaleString()}
          </text>
          {selected.errorSnippet ? (
            <>
              <text> </text>
              <text fg={statusColor(colors, selected.status)} attributes={1}>
                {reasonLabel(selected.status)}
              </text>
              <text wrapMode="word">{selected.errorSnippet}</text>
            </>
          ) : null}
        </Panel>
      ) : null}
    </box>
  );
}
