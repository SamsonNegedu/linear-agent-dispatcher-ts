import { Injectable, Logger, Inject } from '@nestjs/common';
import { signWebhookPayload } from '@webhook-verify/core/relay';
import { SubscriberService } from '../subscriber/subscriber.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { VerifiedEvent } from '@webhook-verify/core/linear';
import { RelayServiceConfig } from '../config/relay-config';
import { LinearGraphQLClient } from '@linear-agent/linear-client';

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
  private linearClient: LinearGraphQLClient | null;

  constructor(
    private readonly subscriberService: SubscriberService,
    private readonly deliveryService: WebhookDeliveryService,
    @Inject('RelayServiceConfig') private readonly config: RelayServiceConfig,
  ) {
    this.linearClient = config.linear.apiKey
      ? new LinearGraphQLClient(config.linear.apiKey, this.logger)
      : null;
  }

  async fanOutWebhook(webhook: VerifiedEvent, rawPayload: string): Promise<WebhookFanOutResult> {
    const { webhookId, issueId, type } = webhook;
    let { teamKey, assigneeId } = webhook;

    // For agent session webhooks without assignee info, try to fetch the issue for routing
    if (type === 'AgentSession' && !assigneeId && issueId) {
      if (!this.linearClient) {
        this.logger.warn(
          `Agent session webhook ${webhookId} skipped: LINEAR_API_KEY not configured. ` +
            `Configure it in relay to route agent sessions by fetching issue assignee.`,
        );
      } else {
        try {
          this.logger.log(`Fetching issue ${issueId} to resolve assignee for agent session webhook`);
          const issueInfo = await this.linearClient.fetchIssueAssignee(issueId);
          assigneeId = issueInfo.assigneeId;
          if (!teamKey) {
            teamKey = issueInfo.teamKey;
          }
        } catch (err) {
          this.logger.warn(
            `Failed to fetch issue ${issueId} for agent session: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Skip if no assignee (unassigned issue or agent session with no issue fetch)
    if (!teamKey || !assigneeId) {
      this.logger.warn(`Webhook ${webhookId} missing teamKey or assigneeId, skipping`);
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
        ),
      ),
    );

    const failures = deliveryResults.filter((r) => !r.success);
    const successful = deliveryResults.length - failures.length;

    // Structured key=value logging: fields stay at fixed positions after the
    // event name instead of interpolated mid-sentence, and failures carry
    // their actual reason instead of only appearing in a separate log line.
    this.logger.log(
      `webhook.fanout webhookId=${webhookId} team=${teamKey} assignee=${assigneeId} delivered=${successful} failed=${failures.length} total=${subscribers.length}`,
    );
    for (const failure of failures) {
      this.logger.warn(
        `webhook.delivery.failed webhookId=${webhookId} subscriberId=${failure.subscriberId} endpoint=${failure.endpoint} reason="${failure.reason}"`,
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
    webhook: VerifiedEvent,
  ): Promise<{ subscriberId: string; endpoint: string; success: boolean; reason?: string }> {
    const signature = signWebhookPayload(payload, secret);
    const deliveryId = await this.deliveryService.logAttempt(
      subscriberId,
      webhook.teamKey!,
      webhook.webhookId,
      webhook.issueId,
      webhook.issueIdentifier,
      webhook.assigneeId,
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
      await this.subscriberService.markWebhookDelivered(subscriberId).catch((err) => {
        this.logger.warn(`Failed to mark webhook delivered for ${subscriberId}: ${err}`);
      });

      return { subscriberId, endpoint, success: true };
    } catch (err) {
      const responseTime = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
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
