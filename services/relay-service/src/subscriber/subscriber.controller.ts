import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { safeEqual } from '@webhook-verify/core';
import { SubscriberService } from './subscriber.service';
import { OAuthService } from './oauth.service';
import { isLocalhostUrl, isValidRelayUrl, isValidWebhookEndpoint } from './endpoint-validation';

const badRequest = (message: string): HttpException =>
  new HttpException(message, HttpStatus.BAD_REQUEST);

interface UpdateRequest {
  subscriberId?: string;
  subscriberSecret?: string;
  localEndpoint?: string;
}

@Controller('subscribers')
export class SubscriberController {
  private readonly logger = new Logger(SubscriberController.name);

  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly oauthService: OAuthService,
  ) {}

  /**
   * GET /subscribers/auth/start?localEndpoint=...&cliCallback=...&relayUrl=...
   * Starts the OAuth flow and returns the Linear authorization URL.
   * - `localEndpoint`: the full URL the relay will POST webhooks to (not just an origin; the
   *   relay doesn't know the receiver's routes, e.g. `.../webhooks/relay`).
   * - `cliCallback`: a local CLI listener (http://localhost:<port>/...) the /callback handler
   *   redirects to once the flow completes, so the CLI never has to be given anything by hand.
   * - `relayUrl`: base URL for OAuth redirects; defaults to RELAY_BASE_URL.
   */
  @Get('auth/start')
  startAuth(
    @Query('localEndpoint') localEndpoint?: string,
    @Query('cliCallback') cliCallback?: string,
    @Query('relayUrl') relayUrl?: string,
  ) {
    if (!localEndpoint) throw badRequest('Missing localEndpoint query parameter');
    if (!isValidWebhookEndpoint(localEndpoint)) {
      throw badRequest('Invalid localEndpoint URL: must be HTTPS to a public host');
    }
    if (cliCallback && !isLocalhostUrl(cliCallback)) {
      throw badRequest('Invalid cliCallback URL: must be http://localhost');
    }
    if (relayUrl && !isValidRelayUrl(relayUrl)) {
      throw badRequest('Invalid relayUrl: must be HTTPS or http://localhost');
    }

    return {
      redirect: this.oauthService.generateAuthorizationUrl(localEndpoint, cliCallback, relayUrl),
    };
  }

  /**
   * GET /subscribers/:id
   * Existence check the dispatcher uses to confirm the subscriber it holds credentials for is
   * still registered (e.g. not reaped as inactive). Omits the secret and endpoint.
   */
  @Get(':id')
  async getById(@Param('id') id: string) {
    const subscriber = await this.subscriberService.getSubscriber(id);
    if (!subscriber) throw new HttpException('Subscriber not found', HttpStatus.NOT_FOUND);

    return {
      subscriberId: subscriber.subscriberId,
      teamKey: subscriber.teamKey,
      registeredAt: subscriber.registeredAt,
      lastSeenAt: subscriber.lastSeenAt,
      lastWebhookAt: subscriber.lastWebhookAt || null,
    };
  }

  /**
   * PATCH /subscribers
   * Moves an existing subscription to a new delivery endpoint. The caller must prove ownership
   * with the subscriber's secret: subscriber ids are guessable (`<team>:<linearUserId>`), so
   * without it anyone could redirect another person's webhooks.
   */
  @Patch()
  async update(@Body() body: UpdateRequest) {
    const { subscriberId, subscriberSecret, localEndpoint } = body ?? {};
    if (!subscriberId || !subscriberSecret || !localEndpoint) {
      throw badRequest('Missing required fields: subscriberId, subscriberSecret, localEndpoint');
    }
    if (!isValidWebhookEndpoint(localEndpoint)) {
      throw badRequest('Invalid localEndpoint URL: must be HTTPS to a public host');
    }

    const subscriber = await this.subscriberService.getSubscriber(subscriberId);
    // One answer for an unknown id and a wrong secret, so ids cannot be probed.
    if (!subscriber || !safeEqual(subscriberSecret, subscriber.subscriberSecret)) {
      throw new HttpException('Invalid subscriber credentials', HttpStatus.UNAUTHORIZED);
    }

    const updated = await this.subscriberService.updateSubscriberEndpointById(
      subscriberId,
      localEndpoint,
    );
    if (!updated) throw new HttpException('Subscriber not found', HttpStatus.NOT_FOUND);

    this.logger.log(`Subscriber ${subscriberId} endpoint updated`);
    return {
      updated: true,
      subscriberId: updated.subscriberId,
      localEndpoint: updated.localEndpoint,
      message: 'Subscription endpoint updated successfully',
    };
  }
}
