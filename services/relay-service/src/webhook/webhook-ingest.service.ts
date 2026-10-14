import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AdapterRegistry, validateTimestamp } from '@webhook-verify/core';
import type { NormalizedEvent, WebhookIngestAdapter } from '@webhook-verify/core';
import type { RelayServiceConfig } from '../config/relay-config';
import { WebhookService, type WebhookFanOutResult } from './webhook.service';

interface ProviderIngestSettings {
  webhookSecret: string;
  organizationId?: string;
}

/**
 * The provider-neutral part of receiving a webhook: verify the signature, parse it into a
 * NormalizedEvent, reject replays and foreign workspaces, then fan out. A route only extracts
 * the provider's signature header and calls ingest().
 */
@Injectable()
export class WebhookIngestService {
  private readonly logger = new Logger(WebhookIngestService.name);
  private readonly settings: Record<string, ProviderIngestSettings>;

  constructor(
    private readonly webhookService: WebhookService,
    @Inject('RelayServiceConfig') config: RelayServiceConfig,
    @Inject('IngestAdapterRegistry')
    private readonly ingestAdapterRegistry: AdapterRegistry<WebhookIngestAdapter<Buffer>>,
  ) {
    // One entry per registered ingest adapter.
    this.settings = { linear: config.linear };
  }

  async ingest(
    provider: string,
    signature: string | undefined,
    rawBody: Buffer,
  ): Promise<WebhookFanOutResult> {
    if (!signature) {
      this.logger.warn(`Missing ${provider} signature header`);
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const settings = this.settings[provider];
    if (!settings) throw new Error(`No ingest settings configured for provider "${provider}"`);
    const { webhookSecret, organizationId } = settings;
    const ingestAdapter = this.ingestAdapterRegistry.getOrThrow(provider);

    // 1. Verify the provider's HMAC signature
    try {
      const isValid = ingestAdapter.verifySignature(rawBody, signature, webhookSecret);
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
    if (organizationId && webhook.organizationId !== organizationId) {
      this.logger.error(
        `Organization mismatch: expected ${organizationId}, got ${webhook.organizationId}`,
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
    return this.webhookService.fanOutWebhook(webhook, JSON.stringify(webhook));
  }
}
