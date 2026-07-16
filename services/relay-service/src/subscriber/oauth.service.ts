import { Injectable, Logger } from '@nestjs/common';
import { RelayServiceConfig } from '../config/relay-config';
import { Inject } from '@nestjs/common';
import {
  LinearGraphQLClient,
  LinearOAuthClient,
  LinearUserInfo,
  LinearTokenResponse,
} from '@linear-agent/linear-client';

/**
 * OAuth service for Linear authentication flow
 * Wrapper around shared LinearOAuthClient and LinearGraphQLClient
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly oauthClient: LinearOAuthClient;
  private readonly graphqlClient: LinearGraphQLClient;

  constructor(@Inject('RelayServiceConfig') private readonly config: RelayServiceConfig) {
    this.oauthClient = new LinearOAuthClient(
      this.config.linear.oauthClientId,
      this.config.linear.oauthClientSecret,
    );
    this.graphqlClient = new LinearGraphQLClient(this.config.linear.oauthClientId);
  }

  /**
   * Generate Linear OAuth authorization URL with cryptographically signed state
   * `cliCallbackUrl`, when provided, lets the callback handler redirect the result
   * back to a local CLI listener instead of returning JSON to the browser.
   * `relayUrl`, when provided, overrides RELAY_BASE_URL env var for constructing the callback URL.
   */
  generateAuthorizationUrl(
    localEndpoint: string,
    cliCallbackUrl?: string,
    relayUrl?: string,
  ): string {
    const baseUrl = relayUrl || this.config.relay.baseUrl;
    const callbackUrl = `${baseUrl}/callback`;
    return this.oauthClient.generateAuthorizationUrl(
      callbackUrl,
      localEndpoint,
      cliCallbackUrl,
      baseUrl,
    );
  }

  /**
   * Validate signed state and extract endpoint (and optional CLI callback URL + relay base URL)
   */
  validateSignedState(state: string): {
    endpoint: string;
    cliCallbackUrl?: string;
    relayBaseUrl?: string;
  } {
    return this.oauthClient.validateSignedState(state);
  }

  /**
   * Exchange OAuth code for access token
   * `relayBaseUrl`, when provided, overrides RELAY_BASE_URL env var (must match the URL sent to Linear).
   */
  async exchangeCodeForToken(code: string, relayBaseUrl?: string): Promise<LinearTokenResponse> {
    const baseUrl = relayBaseUrl || this.config.relay.baseUrl;
    const callbackUrl = `${baseUrl}/callback`;
    try {
      return await this.oauthClient.exchangeCodeForToken(code, callbackUrl);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`OAuth token exchange failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Get user info and teams from Linear API using access token
   */
  async getUserInfo(accessToken: string): Promise<LinearUserInfo> {
    return this.graphqlClient.getUserInfo(accessToken);
  }
}
