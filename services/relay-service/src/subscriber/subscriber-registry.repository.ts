import { randomBytes } from 'crypto';
import type { RelayDatabase } from '../database/relay-database';
import { SubscriberRecord } from './types';

interface SubscriberRow {
  subscriber_id: string;
  team_key: string;
  linear_user_id: string;
  domains: string;
  local_endpoint: string;
  subscriber_secret: string;
  registered_at: string;
  last_seen_at: string;
  last_webhook_at: string | null;
  version: number;
}

const toRecord = (row: SubscriberRow): SubscriberRecord => ({
  subscriberId: row.subscriber_id,
  teamKey: row.team_key,
  linearUserId: row.linear_user_id,
  domains: new Set(JSON.parse(row.domains) as string[]),
  localEndpoint: row.local_endpoint,
  subscriberSecret: row.subscriber_secret,
  registeredAt: row.registered_at,
  lastSeenAt: row.last_seen_at,
  lastWebhookAt: row.last_webhook_at ?? undefined,
  version: row.version,
});

export class SubscriberRegistry {
  constructor(private readonly db: RelayDatabase) {}

  async getSubscriber(subscriberId: string): Promise<SubscriberRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM subscribers WHERE subscriber_id = ?')
      .get(subscriberId);
    return row ? toRecord(row as SubscriberRow) : null;
  }

  async getSubscribersByTeam(teamKey: string): Promise<SubscriberRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM subscribers WHERE team_key = ? ORDER BY subscriber_id')
      .all(teamKey);
    return (rows as SubscriberRow[]).map(toRecord);
  }

  async getSubscribersByTeamAndAssignee(
    teamKey: string,
    linearUserId: string,
  ): Promise<SubscriberRecord[]> {
    const subscribers = await this.getSubscribersByTeam(teamKey);
    return subscribers.filter((s) => s.linearUserId === linearUserId);
  }

  async upsertSubscriber(
    record: Omit<SubscriberRecord, 'registeredAt' | 'lastSeenAt' | 'version'>,
  ): Promise<SubscriberRecord> {
    const now = new Date().toISOString();
    const existing = await this.getSubscriber(record.subscriberId);

    const subscriber: SubscriberRecord = {
      ...record,
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now,
      lastWebhookAt: existing?.lastWebhookAt, // kept when the same subscriber re-registers
      version: (existing?.version ?? 0) + 1,
    };
    this.save(subscriber);
    return subscriber;
  }

  async markWebhookDelivered(subscriberId: string): Promise<void> {
    this.db
      .prepare('UPDATE subscribers SET last_webhook_at = ? WHERE subscriber_id = ?')
      .run(new Date().toISOString(), subscriberId);
  }

  async updateEndpointById(
    subscriberId: string,
    newEndpoint: string,
  ): Promise<SubscriberRecord | null> {
    const subscriber = await this.getSubscriber(subscriberId);
    if (!subscriber) return null;

    const updated: SubscriberRecord = {
      ...subscriber,
      localEndpoint: newEndpoint,
      lastSeenAt: new Date().toISOString(),
      version: subscriber.version + 1,
    };
    this.save(updated);
    return updated;
  }

  async deleteSubscriber(subscriberId: string): Promise<void> {
    this.db.prepare('DELETE FROM subscribers WHERE subscriber_id = ?').run(subscriberId);
  }

  /**
   * Deletes subscribers whose latest activity (last delivered webhook, else registration) is
   * older than `olderThanMs`. Returns how many were deleted.
   */
  async deleteStaleSubscribers(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    return this.db
      .prepare('DELETE FROM subscribers WHERE COALESCE(last_webhook_at, last_seen_at) < ?')
      .run(cutoff).changes;
  }

  generateSubscriberSecret(): string {
    return randomBytes(32).toString('hex');
  }

  private save(subscriber: SubscriberRecord): void {
    this.db
      .prepare(
        `INSERT INTO subscribers (subscriber_id, team_key, linear_user_id, domains, local_endpoint,
           subscriber_secret, registered_at, last_seen_at, last_webhook_at, version)
         VALUES (@subscriberId, @teamKey, @linearUserId, @domains, @localEndpoint,
           @subscriberSecret, @registeredAt, @lastSeenAt, @lastWebhookAt, @version)
         ON CONFLICT(subscriber_id) DO UPDATE SET
           team_key = excluded.team_key, linear_user_id = excluded.linear_user_id,
           domains = excluded.domains, local_endpoint = excluded.local_endpoint,
           subscriber_secret = excluded.subscriber_secret, registered_at = excluded.registered_at,
           last_seen_at = excluded.last_seen_at, last_webhook_at = excluded.last_webhook_at,
           version = excluded.version`,
      )
      .run({
        ...subscriber,
        domains: JSON.stringify([...subscriber.domains]),
        lastWebhookAt: subscriber.lastWebhookAt ?? null,
      });
  }
}
