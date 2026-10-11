import { Injectable, Logger, Inject } from '@nestjs/common';
import { signWebhookPayload } from '@webhook-verify/core/relay';
import { AdapterRegistry } from '@webhook-verify/core';
import { SubscriberService } from '../subscriber/subscriber.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import type { NormalizedEvent, RoutingResolver } from '@webhook-verify/core';

export interface WebhookFanOutResult {
  webhookId: string;
  teamKey: string;
  assigneeId: string;
  delivered: number;
  failed: number;
  skipped?: boolean;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly deliveryService: WebhookDeliveryService,
    @Inject('RoutingResolverRegistry')
    private readonly routingResolverRegistry: AdapterRegistry<RoutingResolver>,
  ) {}

  async fanOutWebhook(webhook: NormalizedEvent, rawPayload: string): Promise<WebhookFanOutResult> {
    const { webhookId, issueId, issueIdentifier, idempotencyKey } = webhook;
    // Locally named teamKey/assigneeId: SubscriberService and its DynamoDB-backed
    // registry are keyed on Linear's team/user routing primitives (GSI partition
    // keys, subscriber IDs) — that storage schema is Linear-specific infra, kept
    // as-is here rather than threading routingKey/ownerId all the way through it.
    let teamKey = webhook.routingKey;
    let assigneeId = webhook.ownerId;

    // Backfill routing info the webhook didn't carry (e.g. an agent session
    // event with no assignee) via the provider's own resolver, if it has one.
    const resolver = this.routingResolverRegistry.get(webhook.provider);
    if (resolver && (!teamKey || !assigneeId)) {
      const resolved = await resolver.resolveMissingRouting(webhook);
      assigneeId = assigneeId || resolved.ownerId;
      teamKey = teamKey || resolved.routingKey;
    }

    // Skip if no assignee (unassigned issue or agent session with no issue fetch)
    if (!teamKey || !assigneeId) {
      this.logger.warn(
        `webhook.skipped reason="missing teamKey or assigneeId" issue=${issueIdentifier || issueId} idempotencyKey=${idempotencyKey}`,
      );
      return {
        webhookId,
        teamKey: teamKey || 'unknown',
        assigneeId: assigneeId || 'unassigned',
        delivered: 0,
        failed: 0,
        skipped: true,
      };
    }

    // Query for matching subscribers
    const subscribers = await this.subscriberService.getSubscribersByTeamAndAssignee(
      teamKey,
      assigneeId,
    );

    if (subscribers.length === 0) {
      this.logger.warn(`No subscribers found for team=${teamKey}, assignee=${assigneeId}`);
      return {
        webhookId,
        teamKey,
        assigneeId,
        delivered: 0,
        failed: 0,
      };
    }

    // Fan out to each subscriber in parallel
    const deliveryResults = await Promise.all(
      subscribers.map((subscriber) =>
        this.deliverToSubscriber(
          subscriber.subscriberId,
          subscriber.localEndpoint,
          subscriber.subscriberSecret,
          rawPayload,
          webhook,
          teamKey,
        ),
      ),
    );

    const failures = deliveryResults.filter((r) => !r.success);
    const successful = deliveryResults.length - failures.length;

    // Structured key=value logging: fields stay at fixed positions after the
    // event name instead of interpolated mid-sentence, and failures carry
    // their actual reason instead of only appearing in a separate log line.
    this.logger.log(
      `webhook.fanout idempotencyKey=${idempotencyKey} issue=${issueIdentifier || issueId} webhookId=${webhookId} team=${teamKey} assignee=${assigneeId} delivered=${successful} failed=${failures.length} total=${subscribers.length}`,
    );
    for (const failure of failures) {
      this.logger.warn(
        `webhook.delivery.failed idempotencyKey=${idempotencyKey} issue=${issueIdentifier || issueId} subscriberId=${failure.subscriberId} endpoint=${failure.endpoint} reason="${failure.reason}"`,
      );
    }

    return {
      webhookId,
      teamKey,
      assigneeId,
      delivered: successful,
      failed: failures.length,
    };
  }

  private async deliverToSubscriber(
    subscriberId: string,
    endpoint: string,
    secret: string,
    payload: string,
    webhook: NormalizedEvent,
    teamKey: string,
  ): Promise<{ subscriberId: string; endpoint: string; success: boolean; reason?: string }> {
    const signature = signWebhookPayload(payload, secret);
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
        signal: AbortSignal.timeout(5000),
      });

      const responseTime = Date.now() - startTime;
      const status = response.ok ? ('success' as const) : ('verification_failed' as const);

      await this.deliveryService.logResult(deliveryId, status, responseTime);

      if (!response.ok) {
        return {
          subscriberId,
          endpoint,
          success: false,
          reason: `HTTP ${response.status}`,
        };
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
