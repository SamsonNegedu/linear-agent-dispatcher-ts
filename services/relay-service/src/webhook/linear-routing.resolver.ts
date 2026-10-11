import { Logger } from '@nestjs/common';
import type { NormalizedEvent, ResolvedRouting, RoutingResolver } from '@webhook-verify/core';
import { LinearGraphQLClient } from '@linear-agent/linear-client';

/**
 * Backfills routingKey/ownerId for agent session webhooks, which don't
 * carry assignee/team info — by fetching the issue from Linear's API.
 */
export class LinearRoutingResolver implements RoutingResolver {
  readonly provider = 'linear';
  private readonly logger = new Logger(LinearRoutingResolver.name);

  constructor(private readonly client: LinearGraphQLClient) {}

  async resolveMissingRouting(event: NormalizedEvent): Promise<ResolvedRouting> {
    if (event.kind !== 'agent_session' || event.ownerId || !event.issueId) {
      return {};
    }

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
