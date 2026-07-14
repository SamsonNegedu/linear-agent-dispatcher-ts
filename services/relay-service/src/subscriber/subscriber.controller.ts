import {
  Controller,
  Post,
  Get,
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
   * GET /auth/start?localEndpoint=...&cliCallback=...
   * Start OAuth flow: redirect to Linear
   * `localEndpoint` must be the full webhook delivery URL (see RegisterRequest
   * above), not just a base origin.
   * `cliCallback`, when provided, must point at a local CLI listener
   * (http://localhost:<port>/...) that the /callback handler will redirect to
   * once the flow completes, so the CLI never has to be given anything by hand.
   */
  @Get('auth/start')
  async startAuth(
    @Query('localEndpoint') localEndpoint?: string,
    @Query('cliCallback') cliCallback?: string,
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

    const authUrl = this.oauthService.generateAuthorizationUrl(localEndpoint, cliCallback);
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
