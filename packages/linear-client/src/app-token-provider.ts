import type { LinearClientLogger } from './types.js';

const TOKEN_URL = 'https://api.linear.app/oauth/token';

/**
 * One scope string for every client-credentials request. Linear revokes an app's existing tokens
 * when it is asked for different scopes, so services must not each pick their own.
 */
export const APP_TOKEN_SCOPES = 'read,write,app:assignable,app:mentionable';

// Renew this long before expiry so a request never starts with a token about to lapse.
const RENEW_MARGIN_MS = 5 * 60 * 1000;

/** Supplies the access token for each Linear request, and can be told the current one was rejected. */
export interface TokenSource {
  getToken(): Promise<string>;
  /** Drops the cached token so the next getToken() fetches a fresh one. */
  invalidate(): void;
}

export interface AppTokenProviderOptions {
  clientId: string;
  clientSecret: string;
  scopes?: string;
  logger?: LinearClientLogger;
  /** Test seams. */
  fetchFn?: typeof fetch;
  now?: () => number;
}

/**
 * Mints and caches the app's own access token with Linear's client-credentials grant (valid for
 * 30 days, no refresh token). Each service holds its own provider, so nothing is stored on disk
 * and there is no rotating refresh token for two services to race over. The token acts as the app
 * user, which is what agent sessions and the assign/delegate pickers need.
 */
export class AppTokenProvider implements TokenSource {
  private cached?: { token: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(private readonly options: AppTokenProviderOptions) {}

  async getToken(): Promise<string> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now < this.cached.expiresAt - RENEW_MARGIN_MS) return this.cached.token;
    // Concurrent callers share one request instead of minting a token each.
    this.pending ??= this.mint().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async mint(): Promise<string> {
    const { clientId, clientSecret, scopes = APP_TOKEN_SCOPES, logger } = this.options;
    const response = await (this.options.fetchFn ?? fetch)(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: scopes,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !body.access_token) {
      const detail = body.error_description ?? body.error ?? 'no detail';
      throw new Error(
        `Linear refused the app token request (${response.status}): ${detail}. ` +
          `Check LINEAR_OAUTH_CLIENT_ID/SECRET and that "client credentials tokens" is enabled on the Linear app.`,
      );
    }

    const lifetimeMs = (body.expires_in ?? 24 * 60 * 60) * 1000;
    this.cached = {
      token: body.access_token,
      expiresAt: (this.options.now ?? Date.now)() + lifetimeMs,
    };
    logger?.log(`Minted a Linear app token, valid for ${Math.round(lifetimeMs / 86_400_000)} days`);
    return body.access_token;
  }
}
