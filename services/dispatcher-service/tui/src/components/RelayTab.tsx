import React from 'react';
import { useKeyboard } from '@opentui/react';
import { useTheme } from '../theme-context';
import type { RelayTabProps, RelayFormField } from '../types';
import { RelayForm } from './RelayForm';

export function RelayTab({ onRunScript, mode, setMode }: RelayTabProps): React.ReactNode {
  const colors = useTheme();
  useKeyboard((key) => {
    if (mode !== 'idle') return;
    if (key.name === 'c') setMode('connect');
    if (key.name === 'u') setMode('update');
  });

  const relayEnabled = process.env.RELAY_ENABLED === 'true';
  const relayUrl = process.env.RELAY_URL || '';
  const dispatcherUrl = process.env.RELAY_DISPATCHER_URL || '';
  const subscriberId = process.env.RELAY_SUBSCRIBER_ID || '';
  const secret = process.env.RELAY_SUBSCRIBER_SECRET || '';
  const secretDisplay = secret ? `${secret.slice(0, 6)}...${secret.slice(-4)}` : '(none)';

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
    <box style={{ border: true, borderColor: colors.accent, flexDirection: 'column', flexGrow: 1, padding: 1 }}>
      <text>
        Status:{' '}
        <span fg={relayEnabled ? colors.succeeded : colors.muted}>
          ● {relayEnabled ? 'Connected' : 'Not connected'}
        </span>
      </text>
      <text> </text>
      <text fg={colors.muted}>Relay server (dispatcher subscribes to this):</text>
      <text>  {relayUrl || '(not set)'}</text>
      <text> </text>
      <text fg={colors.muted}>Public dispatcher URL (registered with the relay as the webhook target):</text>
      <text>  {dispatcherUrl || '(not tracked — run connect-relay or update-relay)'}</text>
      <text> </text>
      <text>Subscriber ID: {subscriberId || '(none)'}</text>
      <text>Secret: {secretDisplay}</text>
      <text> </text>
      <text fg={colors.muted}>Press &apos;c&apos; to connect, &apos;u&apos; to update endpoint</text>
    </box>
  );
}
