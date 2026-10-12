import React, { useEffect, useRef, useState } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useTheme } from './theme-context';
import { copyToClipboard } from './utils/clipboard';
import { getConfig } from './utils/config';
import { relayConnectionStatus } from './utils/relay-status';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useMonitorSnapshot } from './hooks/useMonitorSnapshot';
import { useSpinner } from './hooks/useClock';
import { KeyHints } from './components/ui';
import { TABS } from './tabs';
import type { AppProps } from './types';

export function App({ onExit, onRunRelayScript }: AppProps): React.ReactNode {
  const colors = useTheme();
  const { snapshot, error } = useMonitorSnapshot();
  const [currentTab, setCurrentTab] = useState(0);
  const [notice, setNotice] = useState<string | null>(null); // e.g. while the server restarts
  const [relayMode, setRelayMode] = useState<'idle' | 'connect' | 'update'>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [mouseOn, setMouseOn] = useState(true);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const copyRef = useRef<(() => string) | null>(null);
  const loaded = snapshot !== null || error !== null;
  const tab = TABS[currentTab];

  // Views re-register what `y` copies each time they render; clearing here (parents render
  // before children) means a view that registers nothing doesn't inherit the previous one's.
  copyRef.current = null;
  const registerCopy = (copy: () => string): void => {
    copyRef.current = copy;
  };

  useEffect(() => {
    if (loaded) renderer.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  }, [loaded, renderer]);

  useGlobalShortcuts({
    onExit,
    onRestartStart: () => setNotice('Restarting server...'),
    onRestartSettled: (restartError) => setNotice(restartError ? restartError.message : null),
  });

  const showToast = (message: string): void => {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2500);
  };

  const copyCurrent = async (): Promise<void> => {
    const selected = renderer.hasSelection ? renderer.getSelection()?.getSelectedText() : '';
    const text = selected || copyRef.current?.() || (snapshot ? tab.text(snapshot) : '');
    if (!text) return showToast('Nothing to copy');
    const ok = await copyToClipboard(text, (t) => renderer.copyToClipboardOSC52(t));
    const what = selected ? 'selection' : `${tab.name} view`;
    showToast(
      ok
        ? `Copied ${what} (${text.split('\n').length} lines)`
        : 'Copy failed: no clipboard available',
    );
  };

  const switchTab = (to: number): void => setCurrentTab((to + TABS.length) % TABS.length);

  useKeyboard((key) => {
    if (relayMode !== 'idle') return;
    if (key.name === 'q') return onExit();
    if (key.name === 'y') return void copyCurrent();
    if (key.name === 'm') {
      const next = !renderer.useMouse;
      renderer.useMouse = next;
      setMouseOn(next);
      return showToast(
        next
          ? 'Mouse on (scroll/click). Terminal selection off'
          : 'Mouse off: select text with the mouse, Cmd+C',
      );
    }
    if (key.name === 'tab') return switchTab(currentTab + (key.shift ? -1 : 1));
    if (key.name === 'left') return switchTab(currentTab - 1);
    if (key.name === 'right') return switchTab(currentTab + 1);
    const tabNumber = parseInt(key.name, 10);
    if (tabNumber >= 1 && tabNumber <= TABS.length) switchTab(tabNumber - 1);
  });

  const summary = snapshot?.summary;
  const compact = width < 100;
  const failure = notice ?? error;
  const contentReady = snapshot !== null && !failure;
  const spinner = useSpinner((summary?.counts.running ?? 0) > 0);
  const relayStatus = relayConnectionStatus(
    getConfig().relayEnabled,
    snapshot?.relayHealth ?? null,
    colors,
  );

  const globalHints = [
    ['1-4', 'views'],
    ['y', 'copy'],
    ['m', mouseOn ? 'mouse off' : 'mouse on'],
    ['^R', 'restart'],
    ['q', 'quit'],
  ] as const;

  return (
    <box style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
      <box
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingLeft: 1,
          paddingRight: 1,
          height: 1,
        }}
      >
        <text wrapMode="none" style={{ flexShrink: 0, marginRight: 2 }}>
          <span fg={colors.accent} attributes={1}>
            ◆ DISPATCHER
          </span>
        </text>
        {summary ? (
          <text wrapMode="none" truncate style={{ flexShrink: 1 }}>
            <span fg={colors.running}>
              {spinner} {summary.counts.running} {compact ? 'run' : 'running'}
            </span>
            {'   '}
            <span fg={colors.pending}>{summary.counts.pending} queued</span>
            {summary.counts.needs_input > 0 ? (
              <span fg={colors.needs_input}>
                {'   '}
                {summary.counts.needs_input} {compact ? 'input' : 'need input'}
              </span>
            ) : null}
            {summary.counts.failed > 0 ? (
              <span fg={colors.failed}>
                {'   '}
                {summary.counts.failed} failed
              </span>
            ) : null}
            {compact ? null : (
              <span fg={colors.muted}>
                {'   '}
                {summary.counts.succeeded} done
              </span>
            )}
            {'   '}
            <span fg={relayStatus.color}>
              ● {compact ? 'relay' : `relay ${relayStatus.label.toLowerCase()}`}
            </span>
          </text>
        ) : null}
      </box>

      <box style={{ flexDirection: 'row', paddingLeft: 1, height: 1 }}>
        {TABS.map((t, i) => {
          const count = snapshot ? t.count?.(snapshot) : null;
          const alert = snapshot ? (t.alert?.(snapshot) ?? 0) : 0;
          const active = i === currentTab;
          return (
            <box
              key={t.name}
              style={{ flexDirection: 'row', marginRight: 1 }}
              onMouseDown={() => setCurrentTab(i)}
            >
              <text wrapMode="none">
                <span
                  fg={active ? colors.selectedFg : colors.muted}
                  bg={active ? colors.accent : undefined}
                  attributes={active ? 1 : 0}
                >
                  {` ${i + 1} ${t.name}${count ? ` ${count}` : ''} `}
                </span>
                {alert > 0 ? <span fg={colors.needs_input}>{` ●${alert}`}</span> : null}
              </text>
            </box>
          );
        })}
      </box>
      <text fg={colors.border} wrapMode="none">
        {'─'.repeat(Math.max(0, width))}
      </text>

      <box style={{ flexDirection: 'column', flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        {contentReady ? (
          tab.view({
            snapshot,
            relay: { onRunScript: onRunRelayScript, mode: relayMode, setMode: setRelayMode },
            registerCopy,
          })
        ) : (
          <text fg={failure ? colors.failed : colors.muted}>
            {failure ? `Error: ${failure}` : 'Loading...'}
          </text>
        )}
      </box>

      <box style={{ paddingLeft: 1, height: 1 }}>
        {toast ? (
          <text fg={colors.succeeded}>{toast}</text>
        ) : !contentReady ? (
          <text> </text>
        ) : relayMode !== 'idle' ? (
          <KeyHints
            hints={[
              ['⏎', 'confirm'],
              ['esc', 'cancel'],
            ]}
          />
        ) : (
          <KeyHints
            hints={compact ? [...tab.hints, ['q', 'quit']] : [...tab.hints, ...globalHints]}
          />
        )}
      </box>
    </box>
  );
}
