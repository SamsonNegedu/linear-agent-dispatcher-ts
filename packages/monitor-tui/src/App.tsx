import React, { useEffect, useRef, useState } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import type { SelectRenderable } from '@opentui/core';
import { useTheme } from './theme-context';
import { copyToClipboard } from './utils/clipboard';
import { getConfig } from './utils/config';
import { relayConnectionStatus } from './utils/relay-status';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useMonitorSnapshot } from './hooks/useMonitorSnapshot';
import { TABS } from './tabs';
import type { AppProps } from './types';

export function App({ onExit, onRunRelayScript }: AppProps): React.ReactNode {
  const colors = useTheme();
  const [currentTab, setCurrentTab] = useState(0);
  const { snapshot, error } = useMonitorSnapshot();
  const [notice, setNotice] = useState<string | null>(null); // e.g. while the server restarts
  const [relayMode, setRelayMode] = useState<'idle' | 'connect' | 'update'>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [mouseOn, setMouseOn] = useState(true);
  const sidebarRef = useRef<SelectRenderable>(null);
  const renderer = useRenderer();
  const { height: terminalHeight } = useTerminalDimensions();
  const HEADER_ROWS = 3;
  const FOOTER_ROWS = 1;
  const contentHeight = Math.max(1, terminalHeight - HEADER_ROWS - FOOTER_ROWS);
  const loaded = snapshot !== null || error !== null;

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

  const tab = TABS[currentTab];

  const copyCurrent = async (): Promise<void> => {
    const selected = renderer.hasSelection ? renderer.getSelection()?.getSelectedText() : '';
    const text = selected || (snapshot ? tab.text(snapshot) : '');
    if (!text) return showToast('Nothing to copy');
    const ok = await copyToClipboard(text, (t) => renderer.copyToClipboardOSC52(t));
    const what = selected ? 'selection' : `${tab.name} tab`;
    showToast(
      ok
        ? `Copied ${what} (${text.split('\n').length} lines)`
        : 'Copy failed: no clipboard available',
    );
  };

  useKeyboard((key) => {
    if (relayMode !== 'idle') return;
    if (key.name === 'q') {
      onExit();
      return;
    }
    if (key.name === 'y') {
      void copyCurrent();
      return;
    }
    if (key.name === 'm') {
      const next = !renderer.useMouse;
      renderer.useMouse = next;
      setMouseOn(next);
      showToast(
        next
          ? 'Mouse on (scroll/click). Terminal selection off'
          : 'Mouse off: select text with the mouse, Cmd+C',
      );
      return;
    }
    const tabNum = parseInt(key.name, 10);
    if (tabNum >= 1 && tabNum <= TABS.length) {
      setCurrentTab(tabNum - 1);
      sidebarRef.current?.setSelectedIndex(tabNum - 1);
      sidebarRef.current?.focus();
    }
  });

  const sidebarOptions = TABS.map((t) => {
    const count = snapshot ? t.count?.(snapshot) : null;
    return { name: count ? `${t.name} (${count})` : t.name, description: '' };
  });

  const switchHint = `↑↓/1-${TABS.length} switch · y copy · m mouse ${mouseOn ? 'off' : 'on'} · q quit · Ctrl+R restart`;
  const footerHint =
    relayMode !== 'idle'
      ? 'Enter confirm · Esc cancel'
      : [tab.hint, switchHint].filter(Boolean).join(' · ');

  const failure = notice ?? error;
  const contentReady = snapshot !== null && !failure;
  const summary = snapshot?.summary;
  const relayStatus = relayConnectionStatus(
    getConfig().relayEnabled,
    snapshot?.relayHealth ?? null,
    colors,
  );

  return (
    <box style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
      <box
        style={{
          border: true,
          borderStyle: 'rounded',
          borderColor: colors.accent,
          paddingLeft: 1,
          paddingRight: 1,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <text attributes={1} wrapMode="none" style={{ flexShrink: 0, marginRight: 2 }}>
          DISPATCHER MONITOR
        </text>
        {summary ? (
          <text wrapMode="none" truncate style={{ flexShrink: 1 }}>
            <span fg={colors.running}>● {summary.counts.running} running</span>
            {'  '}
            <span fg={colors.pending}>● {summary.counts.pending} queued</span>
            {'  '}
            <span fg={colors.succeeded}>● {summary.counts.succeeded} done</span>
            {'  '}
            <span fg={colors.failed}>● {summary.counts.failed} failed</span>
            {summary.counts.needs_input > 0 ? (
              <span fg={colors.needs_input}>
                {'  '}● {summary.counts.needs_input} need input
              </span>
            ) : null}
            {'  '}
            <span fg={relayStatus.color}>● relay: {relayStatus.label}</span>
          </text>
        ) : null}
      </box>
      <box style={{ flexDirection: 'row', height: contentHeight }}>
        <box
          style={{
            width: 22,
            height: contentHeight,
            border: true,
            borderStyle: 'rounded',
            borderColor: colors.accent,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
          }}
          onMouseDown={() => {
            if (!contentReady || relayMode !== 'idle') return;
            sidebarRef.current?.focus();
          }}
        >
          <select
            ref={sidebarRef}
            focused={contentReady && relayMode === 'idle'}
            options={sidebarOptions}
            selectedIndex={currentTab}
            showDescription={false}
            selectedBackgroundColor={colors.selectedBg}
            selectedTextColor={colors.selectedFg}
            onChange={(index) => setCurrentTab(index)}
            style={{ flexGrow: 1 }}
          />
        </box>
        <box
          style={{ flexDirection: 'column', width: '100%', height: contentHeight }}
          onMouseDown={() => sidebarRef.current?.blur()}
        >
          {contentReady ? (
            tab.view({
              snapshot,
              relay: { onRunScript: onRunRelayScript, mode: relayMode, setMode: setRelayMode },
            })
          ) : (
            <text fg={failure ? colors.failed : colors.muted}>
              {failure ? `Error: ${failure}` : 'Loading...'}
            </text>
          )}
        </box>
      </box>
      <box style={{ paddingLeft: 1 }}>
        <text fg={toast ? colors.succeeded : colors.muted}>
          {toast ?? (contentReady ? footerHint : '')}
        </text>
      </box>
    </box>
  );
}
