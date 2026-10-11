import { DynamoClient } from '@dynamodb/client';
import { randomUUID } from 'crypto';
import { WebhookDeliveryRecord } from './types';

// Single-table design: deliveries share the relay table with subscribers
// (see infra/relay-service-table.definition.ts). GSI1 is shared across both
// entity types for their team-scoped queries.
const pKey = (deliveryId: string) => `DELIVERY#${deliveryId}`;
const sKey = (_deliveryId: string) => 'DELIVERY'; // Sort key: simple marker for delivery records

// Write sharding: distribute high-traffic teams across 10 shards to avoid hot partitions.
// Queries will need to fan out across all shards.
const SHARD_COUNT = 10;
const getShardId = (): number => Math.floor(Math.random() * SHARD_COUNT);
const gsi1pKey = (teamKey: string, shardId?: number): string => {
  const shard = shardId !== undefined ? shardId : getShardId();
  return `TEAM#${teamKey}#${shard}`;
};

// Timestamp first so GSI1sKey sorts chronologically within a team.
const gsi1sKey = (timestamp: string, deliveryId: string) => `DELIVERY#${timestamp}#${deliveryId}`;

export class WebhookDeliveries {
  constructor(
    private readonly client: DynamoClient,
    private readonly tableName: string,
  ) {}

  async logDeliveryAttempt(
    subscriberId: string,
    teamKey: string,
    webhookId: string,
    issueId: string,
    issueIdentifier: string,
    linearAssigneeId?: string,
  ): Promise<string> {
    const deliveryId = randomUUID();
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

    const record: WebhookDeliveryRecord = {
      deliveryId,
      timestamp: now,
      subscriberId,
      teamKey,
      webhookId,
      issueId,
      issueIdentifier,
      status: 'success', // updated later by logDeliveryResult
      linearAssigneeId,
      ttl,
    };

    await this.client.putItem(this.tableName, {
      pKey: pKey(deliveryId),
      sKey: sKey(deliveryId),
      GSI1pKey: gsi1pKey(teamKey),
      GSI1sKey: gsi1sKey(now, deliveryId),
      ...record,
    });

    return deliveryId;
  }

  async logDeliveryResult(
    deliveryId: string,
    status: WebhookDeliveryRecord['status'],
    responseTime?: number,
    errorMessage?: string,
  ): Promise<void> {
    // Partial update (not a full item replace) so this doesn't wipe out the
    // subscriberId/webhookId/issueId/etc. fields set by logDeliveryAttempt.
    const values: Record<string, unknown> = { status };
    if (responseTime !== undefined) values.responseTime = responseTime;
    if (errorMessage !== undefined) values.errorMessage = errorMessage;

    await this.client.updateItem(
      this.tableName,
      { pKey: pKey(deliveryId), sKey: sKey(deliveryId) },
      values,
    );
  }
}
