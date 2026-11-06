import type { LinearGraphQLClient } from '@linear-agent/linear-client';
import type { NormalizedEvent } from '@webhook-verify/core';
import type { IssueContext, IssueContextResolver } from './issue-context-resolver.interface';

/**
 * Linear webhooks can carry an incomplete label set and agent-session webhooks carry no issue
 * identifier, so both are re-fetched from Linear. Without LINEAR_API_KEY there is no client and
 * the webhook's own labels are used as they are.
 */
export class LinearIssueContextResolver implements IssueContextResolver {
  readonly provider = 'linear';

  constructor(private readonly client: LinearGraphQLClient | null) {}

  resolveIssueContext(event: NormalizedEvent): Promise<IssueContext> {
    if (!this.client) return Promise.resolve({ labels: event.routingTags });
    return this.client.resolveIssueContext(event.issueId, event.routingTags);
  }
}
