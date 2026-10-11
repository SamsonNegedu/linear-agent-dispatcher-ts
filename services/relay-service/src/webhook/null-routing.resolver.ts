import { Logger } from '@nestjs/common';
import type { NormalizedEvent, ResolvedRouting, RoutingResolver } from '@webhook-verify/core';

/**
 * No-op resolver used when LINEAR_API_KEY isn't configured. Warns once per
 * affected event rather than silently dropping agent session webhooks that
 * need assignee backfill.
 */
export class NullRoutingResolver implements RoutingResolver {
  readonly provider = 'linear';
  private readonly logger = new Logger(NullRoutingResolver.name);

  resolveMissingRouting(event: NormalizedEvent): Promise<ResolvedRouting> {
    if (event.kind === 'agent_session' && !event.ownerId) {
      this.logger.warn(
        `Agent session webhook ${event.webhookId} skipped: LINEAR_API_KEY not configured. ` +
          `Configure it in relay to route agent sessions by fetching issue assignee.`,
      );
    }
    return Promise.resolve({});
  }
}
