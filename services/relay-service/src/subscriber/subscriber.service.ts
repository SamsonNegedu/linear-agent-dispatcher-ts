import { Injectable, Logger, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { SubscriberRegistry } from './subscriber-registry.repository';
import { SubscriberRecord } from './types';
import { SUBSCRIBER_REGISTRY_REPOSITORY } from './subscriber-registry.provider';

/**
 * Deterministic subscriber ID for a (team, user, endpoint) triple.
 * Re-registering the same person from the same dispatcher endpoint must
 * overwrite their prior registration rather than piling up duplicates, while
 * still letting one person run dispatchers on multiple machines as distinct
 * subscriptions (each with its own localEndpoint).
 */
export function buildSubscriberId(
  teamKey: string,
  linearUserId: string,
  localEndpoint: string,
): string {
  const endpointHash = createHash('sha256').update(localEndpoint).digest('hex').slice(0, 12);
  return `${teamKey}:${linearUserId}:${endpointHash}`;
}

@Injectable()
export class SubscriberService {
  private readonly logger = new Logger(SubscriberService.name);

  constructor(
    @Inject(SUBSCRIBER_REGISTRY_REPOSITORY)
    private readonly registry: SubscriberRegistry,
  ) {}

  async getSubscribersByTeamAndAssignee(
    teamKey: string,
    linearUserId: string,
  ): Promise<SubscriberRecord[]> {
    return this.registry.getSubscribersByTeamAndAssignee(teamKey, linearUserId);
  }

  async registerSubscriber(
    subscriberId: string,
    teamKey: string,
    linearUserId: string,
    localEndpoint: string,
    subscriberSecret: string,
    domains: string[] = [],
  ): Promise<SubscriberRecord> {
    this.logger.log(`Registering subscriber ${subscriberId} for team ${teamKey}`);
    return this.registry.upsertSubscriber({
      subscriberId,
      teamKey,
      linearUserId,
      domains: new Set(domains),
      localEndpoint,
      subscriberSecret,
    });
  }

  async markWebhookDelivered(subscriberId: string): Promise<void> {
    return this.registry.markWebhookDelivered(subscriberId);
  }

  async deleteStaleSubscribers(olderThanMs: number): Promise<number> {
    this.logger.log(`Deleting subscribers inactive for ${olderThanMs}ms`);
    return this.registry.deleteStaleSubscribers(olderThanMs);
  }

  generateSubscriberSecret(): string {
    return this.registry.generateSubscriberSecret();
  }
}
