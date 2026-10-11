import { Injectable, Logger, Inject } from '@nestjs/common';
import { SubscriberRegistry } from './subscriber-registry.repository';
import { SubscriberRecord } from './types';
import { SUBSCRIBER_REGISTRY_REPOSITORY } from './subscriber-registry.provider';

/**
 * Deterministic subscriber ID for a (team, user) pair.
 *
 * Deliberately excludes localEndpoint: this ID is the upsert key
 * (upsertSubscriber looks up by id, then overwrites in place), so the same
 * person re-registering for the same team — even from a new localEndpoint,
 * e.g. a fresh ngrok tunnel after restarting connect-relay — must resolve to
 * the same row and update it, not create a second one. An earlier version
 * hashed localEndpoint into the id, so any endpoint change produced a brand
 * new subscriber instead of updating the existing one; both rows then stayed
 * active with different secrets, and the relay fanned out to both — one
 * accepted by the dispatcher's current secret, one always rejected with a
 * signature mismatch. Concretely, one person only ever needs one active
 * subscription per team regardless of how many machines/tunnels they've used
 * over time — the localEndpoint on file is just "wherever to deliver next."
 */
export function buildSubscriberId(teamKey: string, linearUserId: string): string {
  return `${teamKey}:${linearUserId}`;
}

@Injectable()
export class SubscriberService {
  private readonly logger = new Logger(SubscriberService.name);

  constructor(
    @Inject(SUBSCRIBER_REGISTRY_REPOSITORY)
    private readonly registry: SubscriberRegistry,
  ) {}

  async getSubscriber(subscriberId: string): Promise<SubscriberRecord | null> {
    return this.registry.getSubscriber(subscriberId);
  }

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

  async updateSubscriberEndpointById(
    subscriberId: string,
    newEndpoint: string,
  ): Promise<SubscriberRecord | null> {
    return this.registry.updateEndpointById(subscriberId, newEndpoint);
  }

  generateSubscriberSecret(): string {
    return this.registry.generateSubscriberSecret();
  }
}
