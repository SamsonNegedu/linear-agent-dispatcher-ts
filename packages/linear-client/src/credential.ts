import { AppTokenProvider, type TokenSource } from './app-token-provider.js';
import type { LinearClientLogger } from './types.js';

export interface LinearCredentialInput {
  oauthClientId?: string;
  oauthClientSecret?: string;
  /** A fixed OAuth token (LINEAR_AGENT_TOKEN). Expires on its own, so only a fallback. */
  agentToken?: string;
  /** A personal API key (LINEAR_API_KEY). Acts as its owner, not as the app. */
  apiKey?: string;
  logger?: LinearClientLogger;
}

/**
 * Picks how to authenticate as the app: the app's client credentials when configured (always
 * current, acts as the app user), else a fixed agent token, else a personal API key.
 */
export const chooseAppCredential = (
  input: LinearCredentialInput,
): string | TokenSource | undefined => {
  const { oauthClientId, oauthClientSecret, agentToken, apiKey, logger } = input;
  if (oauthClientId && oauthClientSecret) {
    return new AppTokenProvider({
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      logger,
    });
  }
  return agentToken || apiKey || undefined;
};
