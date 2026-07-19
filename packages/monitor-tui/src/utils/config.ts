export interface DispatcherConfig {
  port: string;
  relayEnabled: boolean;
  relayUrl: string;
  dispatcherUrl: string;
  relaySubscriberId: string;
  relaySubscriberSecret: string;
}

// Read fresh on every call rather than cached at module load: loadEnv() in
// utils/env.ts reloads process.env with `override: true` after connect-relay
// /update-relay rewrite the .env file, so callers need up-to-date values.
export function getConfig(): DispatcherConfig {
  return {
    port: process.env.PORT || '3000',
    relayEnabled: process.env.RELAY_ENABLED === 'true',
    relayUrl: process.env.RELAY_URL || '',
    dispatcherUrl: process.env.RELAY_DISPATCHER_URL || '',
    relaySubscriberId: process.env.RELAY_SUBSCRIBER_ID || '',
    relaySubscriberSecret: process.env.RELAY_SUBSCRIBER_SECRET || '',
  };
}
