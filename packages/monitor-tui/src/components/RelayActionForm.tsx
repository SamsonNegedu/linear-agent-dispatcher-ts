import React from 'react';
import { getConfig } from '../utils/config';
import type { RelayActions, RelayFormField } from '../types';
import { RelayForm } from './RelayForm';

/**
 * The connect and update forms, shown in place of the Overview while one is open. Renders
 * nothing when `mode` is idle.
 */
export function RelayActionForm({ onRunScript, mode, setMode }: RelayActions): React.ReactNode {
  const { relayUrl } = getConfig();

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
          const args = [
            `--relay-url=${values.relayUrl}`,
            `--local-endpoint=${values.localEndpoint}`,
          ];
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

  return null;
}
