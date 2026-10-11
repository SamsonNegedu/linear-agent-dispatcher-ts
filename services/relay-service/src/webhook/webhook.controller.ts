import {
  Controller,
  Post,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  RawBody,
  Inject,
} from '@nestjs/common';
import { validateTimestamp, AdapterRegistry } from '@webhook-verify/core';
import type { WebhookIngestAdapter, NormalizedEvent } from '@webhook-verify/core';
import { WebhookService } from './webhook.service';
import { RelayServiceConfig } from '../config/relay-config';
import { WebhookResponse } from './types';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    @Inject('RelayServiceConfig') private readonly config: RelayServiceConfig,
    @Inject('IngestAdapterRegistry')
    private readonly ingestAdapterRegistry: AdapterRegistry<WebhookIngestAdapter<Buffer>>,
  ) {}

  /**
   * POST /webhooks/linear — receive Linear webhook, verify signature, fan out to subscribers
   */
  @Post('linear')
  async handleLinearWebhook(
    @Headers('linear-signature') signature: string,
    @RawBody() rawBody: Buffer,
  ): Promise<WebhookResponse> {
    if (!signature) {
      this.logger.warn('Missing linear-signature header');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const secret = this.config.linear.webhookSecret;
    const ingestAdapter = this.ingestAdapterRegistry.getOrThrow('linear');

    // 1. Verify the provider's HMAC signature
    try {
      const isValid = ingestAdapter.verifySignature(rawBody, signature, secret);
      if (!isValid) {
        this.logger.warn('Invalid webhook signature');
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Signature verification error:', error);
      throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    }

    // 2. Parse into the provider-agnostic NormalizedEvent
    let webhook: NormalizedEvent;
    try {
      webhook = ingestAdapter.parse(rawBody);
    } catch (error) {
      this.logger.error('Webhook parsing error:', error);
      throw new HttpException('Invalid webhook format', HttpStatus.BAD_REQUEST);
    }

    // 3. Validate timestamp (prevent replay attacks)
    if (!validateTimestamp(webhook.timestamp)) {
      this.logger.warn('Webhook timestamp outside acceptable window');
      throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    }

    // 4. Validate organizationId (workspace isolation)
    if (
      this.config.linear.organizationId &&
      webhook.organizationId !== this.config.linear.organizationId
    ) {
      this.logger.error(
        `Organization mismatch: expected ${this.config.linear.organizationId}, got ${webhook.organizationId}`,
      );
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    // 5. Fan out webhook to subscribers
    // Forward the parsed NormalizedEvent, not the provider's raw envelope —
    // subscribers (RelayWebhookController on the dispatcher side) expect the
    // flat NormalizedEvent shape directly. The relay→dispatcher HMAC only
    // needs to be internally consistent (sign what we send), it doesn't need
    // to match the provider's original bytes — that's a separate,
    // already-verified signature checked earlier in this handler.
    const result = await this.webhookService.fanOutWebhook(webhook, JSON.stringify(webhook));

    return {
      received: true,
      ...result,
    };
  }
}
