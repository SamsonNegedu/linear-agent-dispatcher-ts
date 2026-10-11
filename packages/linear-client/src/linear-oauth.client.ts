import * as crypto from 'crypto';
import type { LinearTokenResponse } from './types.js';

/**
 * Linear OAuth client for authentication flow
 * Handles token exchange and state validation
 */
export class LinearOAuthClient {
  private readonly tokenUrl = 'https://api.linear.app/oauth/token';
  private readonly authUrl = 'https://linear.app/oauth/authorize';
  private readonly requestTimeoutMs = 10000;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  /**
   * Generate Linear OAuth authorization URL with cryptographically signed state
   * `cliCallbackUrl`, when provided, is threaded through the signed state so the
   * callback handler can hand the result back to a local CLI listener instead of
   * just returning JSON to the browser.
   * `relayBaseUrl` is stored in state so the callback handler can extract it for
   * token exchange (must match the redirect_uri passed to Linear).
   */
  generateAuthorizationUrl(
    callbackUrl: string,
    localEndpoint: string,
    cliCallbackUrl?: string,
    relayBaseUrl?: string,
  ): string {
    const state = this.generateSignedState(localEndpoint, cliCallbackUrl, relayBaseUrl);

    const url = new URL(this.authUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'admin');
    url.searchParams.set('state', state);

    return url.toString();
  }

  /**
   * Validate signed state and extract endpoint (and optional CLI callback URL + relay base URL)
   * Throws error if state is invalid, forged, or expired
   */
  validateSignedState(state: string): {
    endpoint: string;
    cliCallbackUrl?: string;
    relayBaseUrl?: string;
  } {
    const stateData = this.parseSignedState(state);
    if (!stateData) {
      throw new Error('Invalid or tampered state parameter');
    }

    // Verify signature
    const expectedSignature = this.computeStateSignature(
      stateData.endpoint,
      stateData.nonce,
      stateData.timestamp,
      stateData.cliCallbackUrl,
      stateData.relayBaseUrl,
    );
    if (!crypto.timingSafeEqual(Buffer.from(stateData.signature), Buffer.from(expectedSignature))) {
      throw new Error('State signature verification failed');
    }

    // Verify timestamp is fresh (within 10 minutes)
    const ageMs = Date.now() - stateData.timestamp;
    if (ageMs > 10 * 60 * 1000) {
      throw new Error('State parameter expired');
    }

    return {
      endpoint: stateData.endpoint,
      cliCallbackUrl: stateData.cliCallbackUrl,
      relayBaseUrl: stateData.relayBaseUrl,
    };
  }

  /**
   * Exchange OAuth code for access token
   */
  async exchangeCodeForToken(code: string, callbackUrl: string): Promise<LinearTokenResponse> {
    // Linear's token endpoint follows the OAuth 2.0 spec (RFC 6749 section 4.1.3):
    // the request body must be application/x-www-form-urlencoded, not JSON.
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `OAuth token exchange failed: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`,
      );
    }

    return response.json() as Promise<LinearTokenResponse>;
  }

  private generateSignedState(
    endpoint: string,
    cliCallbackUrl?: string,
    relayBaseUrl?: string,
  ): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const signature = this.computeStateSignature(
      endpoint,
      nonce,
      timestamp,
      cliCallbackUrl,
      relayBaseUrl,
    );

    const stateObj = { endpoint, nonce, timestamp, signature, cliCallbackUrl, relayBaseUrl };
    return Buffer.from(JSON.stringify(stateObj)).toString('base64');
  }

  private parseSignedState(state: string): {
    endpoint: string;
    nonce: string;
    timestamp: number;
    signature: string;
    cliCallbackUrl?: string;
    relayBaseUrl?: string;
  } | null {
    try {
      return JSON.parse(Buffer.from(state, 'base64').toString('utf-8')) as {
        endpoint: string;
        nonce: string;
        timestamp: number;
        signature: string;
        cliCallbackUrl?: string;
        relayBaseUrl?: string;
      };
    } catch {
      return null;
    }
  }

  private computeStateSignature(
    endpoint: string,
    nonce: string,
    timestamp: number,
    cliCallbackUrl?: string,
    relayBaseUrl?: string,
  ): string {
    const message = `${endpoint}:${nonce}:${timestamp}:${cliCallbackUrl ?? ''}:${relayBaseUrl ?? ''}`;
    return crypto.createHmac('sha256', this.clientSecret).update(message).digest('hex');
  }
}
