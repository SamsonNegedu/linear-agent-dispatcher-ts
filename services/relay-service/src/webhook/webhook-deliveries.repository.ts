import { randomUUID } from 'crypto';
import type { RelayDatabase } from '../database/relay-database';
import { WebhookDeliveryRecord } from './types';

export class WebhookDeliveries {
  constructor(private readonly db: RelayDatabase) {}

  /** Records an attempt (status starts as 'success'; logDeliveryResult sets the real outcome). */
  async logDeliveryAttempt(
    subscriberId: string,
    teamKey: string,
    webhookId: string,
    issueId: string,
    issueIdentifier: string,
    linearAssigneeId?: string,
  ): Promise<string> {
    const deliveryId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO webhook_deliveries (delivery_id, timestamp, subscriber_id, team_key, webhook_id,
           issue_id, issue_identifier, status, linear_assignee_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?)`,
      )
      .run(
        deliveryId,
        new Date().toISOString(),
        subscriberId,
        teamKey,
        webhookId,
        issueId,
        issueIdentifier,
        linearAssigneeId ?? null,
      );
    return deliveryId;
  }

  async logDeliveryResult(
    deliveryId: string,
    status: WebhookDeliveryRecord['status'],
    responseTime?: number,
    errorMessage?: string,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE webhook_deliveries
         SET status = ?, response_time = COALESCE(?, response_time), error_message = COALESCE(?, error_message)
         WHERE delivery_id = ?`,
      )
      .run(status, responseTime ?? null, errorMessage ?? null, deliveryId);
  }

  /** Deletes delivery logs older than `olderThanMs`. Returns how many were deleted. */
  async deleteOlderThan(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    return this.db.prepare('DELETE FROM webhook_deliveries WHERE timestamp < ?').run(cutoff)
      .changes;
  }
}
