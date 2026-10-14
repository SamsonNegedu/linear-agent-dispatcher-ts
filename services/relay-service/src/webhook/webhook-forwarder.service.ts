import { Injectable, Logger } from '@nestjs/common';
import type { NormalizedEvent } from '@webhook-verify/core';
import { signWebhookPayload } from '@webhook-verify/core/relay';
import { SubscriberService } from '../subscriber/subscriber.service';
import type { SubscriberRecord } from '../subscriber/types';
import { WebhookDeliveryService } from './webhook-delivery.service';

const DELIVERY_TIMEOUT_MS = 5000;

export interface ForwardResult {
  subscriberId: string;
  endpoint: string;
  success: boolean;
  reason?: string;
}

/** Signs a webhook and POSTs it to one subscriber's endpoint, recording the attempt and outcome. */
@Injectable()
export class WebhookForwarder {
  private readonly logger = new Logger(WebhookForwarder.name);

  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly deliveryService: WebhookDeliveryService,
  ) {}

  async forward(
    subscriber: SubscriberRecord,
    payload: string,
    webhook: NormalizedEvent,
    teamKey: string,
  ): Promise<ForwardResult> {
    const { subscriberId, localEndpoint: endpoint } = subscriber;
    const signature = signWebhookPayload(payload, subscriber.subscriberSecret);
    const deliveryId = await this.deliveryService.logAttempt(
      subscriberId,
      teamKey,
      webhook.webhookId,
      webhook.issueId,
      webhook.issueIdentifier,
      webhook.ownerId,
    );

    const startTime = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Relay-Signature': signature,
        },
        body: payload,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      const responseTime = Date.now() - startTime;
      const status = response.ok ? ('success' as const) : ('verification_failed' as const);

      await this.deliveryService.logResult(deliveryId, status, responseTime);

      if (!response.ok) {
        return { subscriberId, endpoint, success: false, reason: `HTTP ${response.status}` };
      }

      // Mark subscriber as recently active (for stale cleanup)
      await this.subscriberService.markWebhookDelivered(subscriberId).catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to mark webhook delivered for ${subscriberId}: ${errorMsg}`);
      });

      return { subscriberId, endpoint, success: true };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const status = errorMsg.includes('timeout') ? ('timeout' as const) : ('unreachable' as const);

      await this.deliveryService
        .logResult(deliveryId, status, responseTime, errorMsg)
        .catch((logErr) => {
          const logErrorMsg = logErr instanceof Error ? logErr.message : 'Unknown error';
          this.logger.error(
            `webhook.delivery.log_error subscriberId=${subscriberId} reason="${logErrorMsg}"`,
          );
        });

      return { subscriberId, endpoint, success: false, reason: errorMsg };
    }
  }
}
