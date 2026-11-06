import React, { useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useTheme } from '../theme-context';
import type { MonitorSnapshot } from '../services/monitor-api.service';
import { useNow } from '../hooks/useClock';
import { columnWidths, fit, pad } from '../utils/format';
import {
  OUTCOME_LABEL,
  outcomeColor,
  scanTiming,
  scannerRows,
  scannerText,
} from '../utils/scanner';
import { Panel } from './ui';

// Rows the app itself uses: header, tab bar, divider, footer.
const APP_ROWS = 4;

export function ScannerView({
  snapshot,
  registerCopy,
}: {
  snapshot: MonitorSnapshot;
  registerCopy: (copy: () => string) => void;
}): React.ReactNode {
  const colors = useTheme();
  const { width, height } = useTerminalDimensions();
  const now = useNow(1000);
  const { scanner } = snapshot;
  const [scroll, setScroll] = useState(0);
  const offset = useRef(0);

  registerCopy(() => scannerText(scanner));

  const rows = scannerRows(scanner);
  // status panel (3) + list panel borders (2) + column header (1)
  const listRows = Math.max(1, height - APP_ROWS - 6);
  const maxOffset = Math.max(0, rows.length - listRows);
  offset.current = Math.max(0, Math.min(scroll, maxOffset));
  const visible = rows.slice(offset.current, offset.current + listRows);

  useKeyboard((key) => {
    if (key.ctrl || key.meta) return;
    if (key.name === 'down' || key.name === 'j') setScroll(offset.current + 1);
    else if (key.name === 'up' || key.name === 'k') setScroll(offset.current - 1);
    else if (key.name === 'pagedown') setScroll(offset.current + listRows);
    else if (key.name === 'pageup') setScroll(offset.current - listRows);
    else if (key.name === 'home') setScroll(0);
    else if (key.name === 'end') setScroll(maxOffset);
  });

  const showSkill = width >= 100;
  const [issueW, titleW, skillW, outcomeW, detailW] = columnWidths(
    width - 12,
    [9, 'flex', showSkill ? 14 : 0, 9, 24],
    { gap: 2, minFlex: 16 },
  );

  return (
    <box style={{ flexDirection: 'column', flexGrow: 1 }}>
      <Panel title="Scanner" grow={false}>
        {scanner.enabled ? (
          <text wrapMode="none" truncate>
            <span fg={colors.succeeded}>● on</span>
            <span fg={colors.muted}>
              {'   '}every {scanner.intervalSec}s · {scanTiming(scanner, now)}
            </span>
          </text>
        ) : (
          <text fg={colors.muted} wrapMode="none" truncate>
            ○ off. Add a "scanner" block to routing.config.json, then restart the dispatcher.
          </text>
        )}
      </Panel>

      {scanner.enabled ? (
        <Panel
          title={`Issues${rows.length > listRows ? ` · ${rows.length} lines, ↑↓ scroll` : ''}`}
        >
          <text fg={colors.muted} wrapMode="none" truncate>
            {'    '}
            {fit('ISSUE', issueW)}
            {'  '}
            {fit('TITLE', titleW)}
            {'  '}
            {showSkill ? `${fit('SKILL', skillW)}  ` : ''}
            {fit('RESULT', outcomeW)}
            {'  '}
            {fit('WHY', detailW)}
          </text>
          {visible.length === 0 ? (
            <text fg={colors.muted}>No scan has finished yet.</text>
          ) : (
            visible.map((row, i) => {
              const key = `${offset.current + i}`;
              if (row.kind === 'gap') return <text key={key}> </text>;
              if (row.kind === 'scope') {
                return (
                  <text key={key} wrapMode="none" truncate>
                    <span fg={colors.accent} attributes={1}>
                      {row.text}
                    </span>
                    <span fg={colors.muted}>
                      {'  '}
                      {row.slots}
                    </span>
                    {row.error ? <span fg={colors.failed}>{`  ✗ ${row.error}`}</span> : null}
                  </text>
                );
              }
              if (row.kind === 'watch') {
                return (
                  <text key={key} fg={colors.muted} wrapMode="none" truncate>
                    {'  '}
                    {row.text}
                  </text>
                );
              }
              if (row.kind === 'empty') {
                return (
                  <text key={key} fg={colors.muted} wrapMode="none" truncate>
                    {'    '}
                    {row.text}
                  </text>
                );
              }
              return (
                <text key={key} wrapMode="none" truncate>
                  {'    '}
                  <span attributes={1}>{fit(row.identifier, issueW)}</span>
                  {'  '}
                  {fit(row.title || '(no title)', titleW)}
                  {'  '}
                  {showSkill ? (
                    <span fg={colors.muted}>{fit(row.skill ? `/${row.skill}` : '—', skillW)} </span>
                  ) : null}
                  <span fg={outcomeColor(colors, row.outcome)} attributes={1}>
                    {pad(OUTCOME_LABEL[row.outcome], outcomeW)}
                  </span>
                  <span fg={colors.muted}>{fit(row.detail ?? '', detailW)}</span>
                </text>
              );
            })
          )}
        </Panel>
      ) : null}
    </box>
  );
}
