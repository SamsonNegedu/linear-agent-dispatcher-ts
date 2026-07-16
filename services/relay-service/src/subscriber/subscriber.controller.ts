import {
  Controller,
  Post,
  Get,
  Patch,
  Query,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SubscriberService, buildSubscriberId } from './subscriber.service';
import { OAuthService } from './oauth.service';

interface RegisterRequest {
  linearUserId: string;
  teamKey: string;
  /** Full URL the relay will POST webhook deliveries to verbatim — not just a base
   *  origin. The relay has no knowledge of the receiver's route structure, so the
   *  caller (e.g. dispatcher-service's connect-relay CLI) must include whatever
   *  path its webhook handler actually listens on (e.g. `.../webhooks/relay`). */
  localEndpoint: string;
  domains?: string[];
  subscriberSecret: string;
  subscriberId?: string;
}

@Controller('subscribers')
export class SubscriberController {
  private readonly logger = new Logger(SubscriberController.name);

  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly oauthService: OAuthService,
  ) {}

  /**
   * GET /auth/start?localEndpoint=...&cliCallback=...&relayUrl=...
   * Start OAuth flow: redirect to Linear
   * `localEndpoint` must be the full webhook delivery URL (see RegisterRequest
   * above), not just a base origin.
   * `cliCallback`, when provided, must point at a local CLI listener
   * (http://localhost:<port>/...) that the /callback handler will redirect to
   * once the flow completes, so the CLI never has to be given anything by hand.
   * `relayUrl`, when provided, is used as the base URL for OAuth redirects;
   * otherwise falls back to RELAY_BASE_URL env var.
   */
  @Get('auth/start')
  startAuth(
    @Query('localEndpoint') localEndpoint?: string,
    @Query('cliCallback') cliCallback?: string,
    @Query('relayUrl') relayUrl?: string,
  ) {
    if (!localEndpoint) {
      throw new HttpException('Missing localEndpoint query parameter', HttpStatus.BAD_REQUEST);
    }

    // Validate URL is HTTPS and not a private/local IP
    if (!this.isValidWebhookEndpoint(localEndpoint)) {
      throw new HttpException('Invalid localEndpoint URL: must be HTTPS', HttpStatus.BAD_REQUEST);
    }

    if (cliCallback && !this.isLocalhostUrl(cliCallback)) {
      throw new HttpException(
        'Invalid cliCallback URL: must be http://localhost',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (relayUrl && !this.isValidRelayUrl(relayUrl)) {
      throw new HttpException('Invalid relayUrl: must be HTTPS or http://localhost', HttpStatus.BAD_REQUEST);
    }

    const authUrl = this.oauthService.generateAuthorizationUrl(localEndpoint, cliCallback, relayUrl);
    return { redirect: authUrl };
  }

  private isLocalhostUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' && url.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  private isValidRelayUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
    } catch {
      return false;
    }
  }

  /**
   * POST /subscribers/register
   * Register a new subscriber or update existing
   * Body: { linearUserId, teamKey, localEndpoint, domains, subscriberSecret, subscriberId? }
   */
  @Post('register')
  async register(@Body() dto: RegisterRequest) {
    const { linearUserId, teamKey, localEndpoint, domains = [], subscriberSecret } = dto;

    // Validate required fields
    if (!linearUserId || !teamKey || !localEndpoint || !subscriberSecret) {
      throw new HttpException(
        'Missing required fields: linearUserId, teamKey, localEndpoint, subscriberSecret',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate URL is HTTPS and not a private/local IP
    if (!this.isValidWebhookEndpoint(localEndpoint)) {
      throw new HttpException('Invalid localEndpoint URL: must be HTTPS', HttpStatus.BAD_REQUEST);
    }

    try {
      const subscriberId =
        dto.subscriberId || buildSubscriberId(teamKey, linearUserId, localEndpoint);

      await this.subscriberService.registerSubscriber(
        subscriberId,
        teamKey,
        linearUserId,
        localEndpoint,
        subscriberSecret,
        domains,
      );

      this.logger.log(`Subscriber ${subscriberId} registered for team ${teamKey}`);

      return {
        registered: true,
        subscriberId,
        teamKey,
        message: 'Subscription registered. Store RELAY_SUBSCRIBER_SECRET in your .env',
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Error registering subscriber: ${errorMsg}`);
      throw new HttpException('Failed to register subscriber', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * PATCH /subscribers
   * Update an existing subscription's webhook endpoint
   * Authenticated by subscriberSecret (proof of ownership) OR subscriberId (direct ID lookup)
   * Body: { subscriberSecret?, subscriberId?, localEndpoint }
   */
  @Patch()
  async update(
    @Body('subscriberSecret') subscriberSecret?: string,
    @Body('subscriberId') subscriberId?: string,
    @Body('localEndpoint') localEndpoint?: string,
  ) {
    if (!localEndpoint || (!subscriberSecret && !subscriberId)) {
      throw new HttpException(
        'Missing required fields: localEndpoint and either subscriberSecret or subscriberId',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate URL is HTTPS and not a private/local IP
    if (!this.isValidWebhookEndpoint(localEndpoint)) {
      throw new HttpException('Invalid localEndpoint URL: must be HTTPS', HttpStatus.BAD_REQUEST);
    }

    try {
      let updated: { subscriberId: string; localEndpoint: string } | null;

      // Prefer ID lookup (no scan needed) over secret lookup
      if (subscriberId) {
        updated = await this.subscriberService.updateSubscriberEndpointById(subscriberId, localEndpoint);
      } else {
        updated = await this.subscriberService.updateSubscriberEndpoint(subscriberSecret!, localEndpoint);
      }

      if (!updated) {
        const reason = subscriberId
          ? 'Subscriber not found with that ID'
          : 'subscriberId is required. Run pnpm connect-relay to save RELAY_SUBSCRIBER_ID to .env.local, then use pnpm update-relay again.';
        throw new HttpException(reason, HttpStatus.BAD_REQUEST);
      }

      const logMsg = subscriberId
        ? `Subscriber ${subscriberId} endpoint updated`
        : `Subscriber endpoint updated for secret ending in ${subscriberSecret!.slice(-8)}`;
      this.logger.log(logMsg);

      return {
        updated: true,
        subscriberId: updated.subscriberId,
        localEndpoint: updated.localEndpoint,
        message: 'Subscription endpoint updated successfully',
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Error updating subscriber: ${errorMsg}`);
      throw new HttpException('Failed to update subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private isValidWebhookEndpoint(urlString: string): boolean {
    try {
      const url = new URL(urlString);

      // Only allow HTTPS, or HTTP on localhost for development
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && url.hostname === 'localhost')
      ) {
        return false;
      }

      // Reject private IP ranges (except localhost which is already covered)
      const privateRanges = [
        '127.0.0.1',
        '10.',
        '172.16.',
        '192.168.',
        '169.254.',
        '::1',
        'fc00::',
      ];
      if (
        privateRanges.some(
          (range) => url.hostname.startsWith(range) || url.hostname === 'localhost',
        )
      ) {
        // localhost is allowed, but other private ranges are not
        if (url.hostname !== 'localhost') {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
