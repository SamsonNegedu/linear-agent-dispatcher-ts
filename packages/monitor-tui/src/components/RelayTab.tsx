import React from 'react';
import { useKeyboard } from '@opentui/react';
import { useTheme } from '../theme-context';
import { getConfig } from '../utils/config';
import { pad } from '../utils/format';
import { relayConnectionStatus } from '../utils/relay-status';
import type { RelayTabProps, RelayFormField } from '../types';
import { RelayForm } from './RelayForm';

const LABEL_WIDTH = 16;

export function RelayTab({ onRunScript, mode, setMode, relayHealth }: RelayTabProps): React.ReactNode {
  const colors = useTheme();
  useKeyboard((key) => {
    if (mode !== 'idle') return;
    if (key.name === 'c') setMode('connect');
    if (key.name === 'u') setMode('update');
  });

  const { relayEnabled, relayUrl, dispatcherUrl, relaySubscriberId: subscriberId, relaySubscriberSecret: secret } =
    getConfig();
  const secretDisplay = secret ? `${secret.slice(0, 6)}...${secret.slice(-4)}` : '(none)';
  const status = relayConnectionStatus(relayEnabled, relayHealth, colors);

  if (mode === 'connect') {
    const connectFields: RelayFormField[] = [
      { key: 'relayUrl', label: 'Relay URL', defaultValue: relayUrl, required: true },
      { key: 'localEndpoint', label: 'Public dispatcher URL (webhook target)', required: true },
      { key: 'port', label: 'Local OAuth callback port', defaultValue: '3333' },
    ];
    return (
      <RelayForm
        title="Connect to Relay"
        fields={connectFields}
        onSubmit={(values) => {
          const args = [`--relay-url=${values.relayUrl}`, `--local-endpoint=${values.localEndpoint}`];
          if (values.port) args.push(`--port=${values.port}`);
          setMode('idle');
          onRunScript('connect-relay', args);
        }}
        onCancel={() => setMode('idle')}
      />
    );
  }

  if (mode === 'update') {
    const updateFields: RelayFormField[] = [
      { key: 'localEndpoint', label: 'New public dispatcher URL', required: true },
      { key: 'relayUrl', label: 'Relay URL override', defaultValue: relayUrl },
    ];
    return (
      <RelayForm
        title="Update Relay Endpoint"
        fields={updateFields}
        onSubmit={(values) => {
          const args = [`--local-endpoint=${values.localEndpoint}`];
          if (values.relayUrl) args.push(`--relay-url=${values.relayUrl}`);
          setMode('idle');
          onRunScript('update-relay', args);
        }}
        onCancel={() => setMode('idle')}
      />
    );
  }

  return (
    <box style={{ border: true, borderStyle: 'rounded', borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <box style={{ flexDirection: 'row' }}>
        <text attributes={1}>Relay Connection</text>
        <text>
          {'   '}
          <span fg={status.color}>● {status.label}</span>
        </text>
      </box>
      <text> </text>

      <text fg={colors.accent} attributes={1}>
        Endpoints
      </text>
      <text wrapMode="none" truncate>
        {'  '}
        <span fg={colors.muted}>{pad('Relay server:', LABEL_WIDTH)}</span>
        {relayUrl || '(not set)'}
      </text>
      <text fg={colors.muted} wrapMode="none" truncate>
        {' '.repeat(LABEL_WIDTH + 2)}dispatcher subscribes to this
      </text>
      <text> </text>
      <text wrapMode="none" truncate>
        {'  '}
        <span fg={colors.muted}>{pad('Dispatcher URL:', LABEL_WIDTH)}</span>
        {dispatcherUrl || '(not tracked)'}
      </text>
      <text fg={colors.muted} wrapMode="none" truncate>
        {' '.repeat(LABEL_WIDTH + 2)}webhook target registered with the relay
      </text>
      <text> </text>

      <text fg={colors.accent} attributes={1}>
        Credentials
      </text>
      <text wrapMode="none" truncate>
        {'  '}
        <span fg={colors.muted}>{pad('Subscriber ID:', LABEL_WIDTH)}</span>
        {subscriberId || '(none)'}
      </text>
      <text wrapMode="none" truncate>
        {'  '}
        <span fg={colors.muted}>{pad('Secret:', LABEL_WIDTH)}</span>
        {secretDisplay}
      </text>

      <text> </text>
      <text fg={colors.muted}>
        Press <span fg={colors.accent}>c</span> to connect, <span fg={colors.accent}>u</span> to update endpoint
      </text>
    </box>
  );
}
