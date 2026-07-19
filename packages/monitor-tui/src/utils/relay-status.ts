import type { Palette } from '../theme';
import type { RelayHealth } from '../types';

export interface RelayConnectionStatus {
  label: string;
  color: string;
}

// Single source of truth for how "connected" gets rendered — both Dashboard
// and RelayTab show a connection indicator, and used to compute it
// independently, which meant a fix to one silently left the other showing
// stale state.
export function relayConnectionStatus(
  relayEnabled: boolean,
  relayHealth: RelayHealth | null,
  colors: Palette,
): RelayConnectionStatus {
  if (!relayEnabled) return { label: 'Not connected', color: colors.failed };
  if (!relayHealth || relayHealth.subscriberCheck === null) {
    return { label: 'Checking...', color: colors.muted };
  }
  switch (relayHealth.subscriberCheck) {
    case 'verified':
      return { label: 'Connected', color: colors.succeeded };
    case 'not_found':
      return { label: 'Subscriber not found on relay', color: colors.failed };
    case 'unreachable':
      return { label: 'Relay service unreachable', color: colors.failed };
  }
}
