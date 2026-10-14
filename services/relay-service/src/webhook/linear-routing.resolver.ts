import { Logger } from '@nestjs/common';
import type { NormalizedEvent, ResolvedRouting, RoutingResolver } from '@webhook-verify/core';
import type { LinearGraphQLClient } from '@linear-agent/linear-client';

/**
 * Backfills routingKey/ownerId for agent session webhooks, which don't
 * carry assignee/team info — by fetching the issue from Linear's API.
 * Without a client (no LINEAR_API_KEY) it warns and backfills nothing, rather
 * than silently dropping agent session webhooks that need it.
 */
export class LinearRoutingResolver implements RoutingResolver {
  readonly provider = 'linear';
  private readonly logger = new Logger(LinearRoutingResolver.name);

  constructor(private readonly client: LinearGraphQLClient | null) {}

  async resolveMissingRouting(event: NormalizedEvent): Promise<ResolvedRouting> {
    if (event.kind !== 'agent_session' || event.ownerId) return {};

    if (!this.client) {
      this.logger.warn(
        `Agent session webhook ${event.webhookId} skipped: LINEAR_API_KEY not configured. ` +
          `Configure it in relay to route agent sessions by fetching issue assignee.`,
      );
      return {};
    }
    if (!event.issueId) return {};

    try {
      this.logger.log(
        `Fetching issue ${event.issueId} to resolve assignee for agent session webhook`,
      );
      const issueInfo = await this.client.fetchIssueAssignee(event.issueId);
      return { ownerId: issueInfo.assigneeId, routingKey: issueInfo.teamKey };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to fetch issue ${event.issueId} for agent session: ${errorMsg}`);
      return {};
    }
  }
}
