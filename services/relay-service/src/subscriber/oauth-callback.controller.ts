import { randomBytes } from 'crypto';
import { Controller, Get, Query, Res, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { SubscriberService, buildSubscriberId } from './subscriber.service';
import { OAuthService } from './oauth.service';

/**
 * Serves the OAuth callback at a top-level /callback route, matching
 * whatever redirect URI is registered with the Linear OAuth application
 * (configurable per-deployment; not necessarily under /subscribers).
 */
@Controller()
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly oauthService: OAuthService,
  ) {}

  /**
   * GET /callback?code=...&state=...
   * OAuth callback: exchange code, get user info, auto-register subscriber
   */
  @Get('callback')
  async handleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      throw new HttpException('Missing code or state parameter', HttpStatus.BAD_REQUEST);
    }

    // Validate signed state and extract localEndpoint, cliCallbackUrl, relayBaseUrl
    let localEndpoint: string;
    let cliCallbackUrl: string | undefined;
    let relayBaseUrl: string | undefined;
    try {
      const stateData = this.oauthService.validateSignedState(state);
      localEndpoint = stateData.endpoint;
      cliCallbackUrl = stateData.cliCallbackUrl;
      relayBaseUrl = stateData.relayBaseUrl;
      new URL(localEndpoint); // Validate it's a valid URL
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`State validation failed: ${errorMsg}`);
      throw new HttpException('Invalid or expired state parameter', HttpStatus.BAD_REQUEST);
    }

    try {
      // Step 1: Exchange code for token
      const tokenResponse = await this.oauthService.exchangeCodeForToken(code, relayBaseUrl);
      const accessToken = tokenResponse.access_token;

      // Step 2: Get user info and teams from Linear
      const userInfo = await this.oauthService.getUserInfo(accessToken);

      // Step 3: Auto-register for all teams with same secret
      // (One dispatcher endpoint receives webhooks from all registered teams)
      const subscriberSecret = randomBytes(32).toString('hex');
      const teamRegistrations = await Promise.all(
        userInfo.teams.map(async (team: { id: string; key: string; name: string }) => {
          const teamKey = team.key;
          const subscriberId = buildSubscriberId(teamKey, userInfo.linearUserId, localEndpoint);

          await this.subscriberService.registerSubscriber(
            subscriberId,
            teamKey,
            userInfo.linearUserId,
            localEndpoint,
            subscriberSecret,
          );

          this.logger.log(`Auto-registered subscriber ${subscriberId} for team ${teamKey}`);
          return { teamKey, teamName: team.name, subscriberId };
        }),
      );

      const result = {
        success: true,
        teamCount: teamRegistrations.length,
        teams: teamRegistrations,
        localEndpoint,
        subscriberSecret,
        message: `Registered with ${teamRegistrations.length} team(s)! Dispatcher will receive webhooks from all registered teams.`,
        env: `RELAY_SUBSCRIBER_SECRET=${subscriberSecret}`,
      };

      // If a local CLI listener asked to be notified (connect-relay.ts), redirect
      // the browser there with the result so the CLI can finish automatically
      // instead of requiring the user to copy the secret out of this JSON by hand.
      if (cliCallbackUrl) {
        const redirectUrl = new URL(cliCallbackUrl);
        redirectUrl.searchParams.set('secret', subscriberSecret);
        redirectUrl.searchParams.set('teams', JSON.stringify(teamRegistrations));
        res.redirect(redirectUrl.toString());
        return;
      }

      res.json(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`OAuth callback error: ${errorMsg}`);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('OAuth callback failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
