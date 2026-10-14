import {
  BeforeApplicationShutdown,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AdapterRegistry, validateTimestamp } from '@webhook-verify/core';
import type { NormalizedEvent, WebhookIngestAdapter } from '@webhook-verify/core';
import type { RelayServiceConfig } from '../config/relay-config';
import { WebhookService } from './webhook.service';

// Linear gives up on a delivery after 5 seconds and retries it, so a request is answered well
// inside that, and deliveries still running at shutdown get this long to finish.
const SHUTDOWN_DRAIN_MS = 10_000;

interface ProviderIngestSettings {
  webhookSecret: string;
  organizationId?: string;
}

/**
 * The provider-neutral part of receiving a webhook: verify the signature, parse it into a
 * NormalizedEvent, reject replays and foreign workspaces, then fan out. A route only extracts
 * the provider's signature header and calls ingest().
 *
 * Fan-out runs after the caller has its answer: it makes a Linear lookup and an HTTP call per
 * subscriber, which can outlast Linear's 5 second limit and trigger a pointless retry.
 */
@Injectable()
export class WebhookIngestService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(WebhookIngestService.name);
  private readonly settings: Record<string, ProviderIngestSettings>;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly webhookService: WebhookService,
    @Inject('RelayServiceConfig') config: RelayServiceConfig,
    @Inject('IngestAdapterRegistry')
    private readonly ingestAdapterRegistry: AdapterRegistry<WebhookIngestAdapter<Buffer>>,
  ) {
    // One entry per registered ingest adapter.
    this.settings = { linear: config.linear };
  }

  /** Resolves once the webhook is accepted; delivery to subscribers continues in the background. */
  async ingest(
    provider: string,
    signature: string | undefined,
    rawBody: Buffer,
  ): Promise<{ webhookId: string }> {
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
      this.logger.warn(
        `Webhook timestamp outside acceptable window: ${webhook.kind} ${webhook.action ?? ''} sent ${Math.round((Date.now() - webhook.timestamp) / 1000)}s ago`,
      );
      throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    }

    // 4. Validate organizationId (workspace isolation)
    if (organizationId && webhook.organizationId !== organizationId) {
      this.logger.error(
        `Organization mismatch: expected ${organizationId}, got ${webhook.organizationId}`,
      );
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    // 5. Fan out webhook to subscribers, without making Linear wait for it.
    // Forward the parsed NormalizedEvent, not the provider's raw envelope —
    // subscribers (RelayWebhookController on the dispatcher side) expect the
    // flat NormalizedEvent shape directly. The relay→dispatcher HMAC only
    // needs to be internally consistent (sign what we send), it doesn't need
    // to match the provider's original bytes — that's a separate,
    // already-verified signature checked earlier in this handler.
    const delivery = this.webhookService
      .fanOutWebhook(webhook, JSON.stringify(webhook))
      .then(
        () => undefined,
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `webhook.fanout.failed idempotencyKey=${webhook.idempotencyKey} issue=${webhook.issueIdentifier || webhook.issueId} reason="${reason}"`,
          );
        },
      )
      .finally(() => this.inFlight.delete(delivery));
    this.inFlight.add(delivery);

    return { webhookId: webhook.webhookId };
  }

  /** On shutdown, lets deliveries already under way finish instead of dropping them. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.inFlight.size === 0) return;
    this.logger.log(`Waiting for ${this.inFlight.size} webhook delivery(ies) to finish`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_DRAIN_MS);
    });
    await Promise.race([Promise.allSettled([...this.inFlight]), timeout]);
    clearTimeout(timer);
  }
}
