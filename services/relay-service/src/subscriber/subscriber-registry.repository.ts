import { DynamoClient } from '@dynamodb/client';
import { randomBytes } from 'crypto';
import { SubscriberRecord } from './types';

// Single-table design: subscribers share the relay table with webhook
// deliveries (see infra/relay-service-table.definition.ts). GSI1 is shared
// across both entity types for their team-scoped queries.
const pKey = (subscriberId: string) => `SUBSCRIBER#${subscriberId}`;
const sKey = (_subscriberId: string) => 'METADATA'; // Sort key: distinguish record type if needed in future
const gsi1pKey = (teamKey: string) => `TEAM#${teamKey}`;
const gsi1sKey = (subscriberId: string) => `SUBSCRIBER#${subscriberId}#ACTIVE`; // Allows future filtering by status

export class SubscriberRegistry {
  constructor(
    private readonly client: DynamoClient,
    private readonly tableName: string,
  ) {}

  async getSubscriber(subscriberId: string): Promise<SubscriberRecord | null> {
    const item = await this.client.getItem<Record<string, unknown>>(
      this.tableName,
      { pKey: pKey(subscriberId), sKey: sKey(subscriberId) },
      /* removeKeys */ false,
    );

    if (!item) {
      return null;
    }

    return this.fromDynamoItem(item);
  }

  async getSubscribersByTeam(teamKey: string): Promise<SubscriberRecord[]> {
    const items = await this.client.queryItems<Record<string, unknown>>({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1pKey = :gsi1pKey AND begins_with(GSI1sKey, :prefix)',
      ExpressionAttributeValues: {
        ':gsi1pKey': gsi1pKey(teamKey),
        ':prefix': 'SUBSCRIBER#',
      },
    });

    return (items || []).map((item) => this.fromDynamoItem(item));
  }

  async getSubscribersByTeamAndAssignee(
    teamKey: string,
    linearUserId: string,
  ): Promise<SubscriberRecord[]> {
    const subscribers = await this.getSubscribersByTeam(teamKey);
    return subscribers.filter((s) => s.linearUserId === linearUserId);
  }

  async getAllSubscribers(): Promise<SubscriberRecord[]> {
    // Query primary table for all subscriber records
    const result = await this.client.query({
      TableName: this.tableName,
      KeyConditionExpression: 'begins_with(pKey, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'SUBSCRIBER#',
      },
    });

    const subscribers = (result.Items || []).map((item) => this.fromDynamoItem(item as Record<string, unknown>));
    // Sort by registration date (newest first)
    return subscribers.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
  }


  async upsertSubscriber(
    record: Omit<SubscriberRecord, 'registeredAt' | 'lastSeenAt' | 'version'>,
  ): Promise<SubscriberRecord> {
    const now = new Date().toISOString();
    const existing = await this.getSubscriber(record.subscriberId);

    const subscriber: SubscriberRecord = {
      ...record,
      registeredAt: existing?.registeredAt || now,
      lastSeenAt: now,
      lastWebhookAt: existing?.lastWebhookAt, // Preserve lastWebhookAt on re-register
      version: (existing?.version || 0) + 1,
    };

    await this.client.putItem(this.tableName, this.toDynamoItem(subscriber));

    return subscriber;
  }

  async markWebhookDelivered(subscriberId: string): Promise<void> {
    await this.client.updateItem(
      this.tableName,
      { pKey: pKey(subscriberId), sKey: sKey(subscriberId) },
      { lastWebhookAt: new Date().toISOString() },
    );
  }

  async updateEndpointById(
    subscriberId: string,
    newEndpoint: string,
  ): Promise<SubscriberRecord | null> {
    // Direct lookup by subscriber ID — no scan needed
    const subscriber = await this.getSubscriber(subscriberId);
    if (!subscriber) {
      return null;
    }

    // Update the endpoint
    const updated: SubscriberRecord = {
      ...subscriber,
      localEndpoint: newEndpoint,
      lastSeenAt: new Date().toISOString(),
      version: subscriber.version + 1,
    };

    await this.client.putItem(this.tableName, this.toDynamoItem(updated));
    return updated;
  }

  updateEndpointBySecret(
    _subscriberSecret: string,
    _newEndpoint: string,
  ): Promise<SubscriberRecord | null> {
    // Looking up by secret requires scanning the entire table (no index exists).
    // Use updateEndpointById instead and save RELAY_SUBSCRIBER_ID in .env.local.
    // If ID not available, re-run pnpm connect-relay to get it.
    return Promise.reject(
      new Error(
        'Updating by secret is not supported. Use subscriberId instead. ' +
        'Run pnpm connect-relay again to save RELAY_SUBSCRIBER_ID to .env.local.',
      ),
    );
  }

  async deleteSubscriber(subscriberId: string): Promise<void> {
    await this.client.delete({
      TableName: this.tableName,
      Key: { pKey: pKey(subscriberId), sKey: sKey(subscriberId) },
    });
  }

  async deleteStaleSubscribers(olderThanMs: number): Promise<number> {
    const cutoffTime = new Date(Date.now() - olderThanMs).toISOString();

    // Query all subscribers by scanning primary table (fallback for cleanup batch job)
    // In production, pair this with CloudWatch alarms to monitor cleanup lag.
    // For high-frequency cleanup, use a dedicated "stale queue" or mark-and-sweep approach.
    const result = await this.client.query({
      TableName: this.tableName,
      KeyConditionExpression: 'begins_with(pKey, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'SUBSCRIBER#',
      },
    });

    const subscribers = (result.Items || []).map((item) => this.fromDynamoItem(item as Record<string, unknown>));

    let deleted = 0;
    for (const subscriber of subscribers) {
      // Use lastWebhookAt if set (webhook has been delivered), otherwise fall back to lastSeenAt (registration time).
      // Delete only if the most recent activity (whichever is later) is older than cutoff.
      const mostRecentActivity = subscriber.lastWebhookAt || subscriber.lastSeenAt;
      if (mostRecentActivity < cutoffTime) {
        await this.deleteSubscriber(subscriber.subscriberId);
        deleted++;
      }
    }

    return deleted;
  }

  generateSubscriberSecret(): string {
    return randomBytes(32).toString('hex');
  }

  private toDynamoItem(subscriber: SubscriberRecord): Record<string, unknown> {
    return {
      pKey: pKey(subscriber.subscriberId),
      sKey: sKey(subscriber.subscriberId),
      GSI1pKey: gsi1pKey(subscriber.teamKey),
      GSI1sKey: gsi1sKey(subscriber.subscriberId),
      ...subscriber,
      // Stored as a DynamoDB List (plain array), not a native Set — Sets
      // cannot be empty in DynamoDB, and this field is legitimately empty
      // most of the time, so a List avoids that restriction entirely.
      domains: Array.from(subscriber.domains),
    };
  }

  private fromDynamoItem(item: Record<string, unknown>): SubscriberRecord {
    return {
      subscriberId: item.subscriberId as string,
      teamKey: item.teamKey as string,
      linearUserId: item.linearUserId as string,
      domains: new Set((item.domains as string[]) || []),
      localEndpoint: item.localEndpoint as string,
      subscriberSecret: item.subscriberSecret as string,
      registeredAt: item.registeredAt as string,
      lastSeenAt: item.lastSeenAt as string,
      lastWebhookAt: item.lastWebhookAt as string | undefined,
      version: item.version as number,
    };
  }
}
