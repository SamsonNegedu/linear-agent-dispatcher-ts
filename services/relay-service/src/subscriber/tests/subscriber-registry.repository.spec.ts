import { openRelayDatabase, RelayDatabase } from '../../database/relay-database';
import { SubscriberRegistry } from '../subscriber-registry.repository';

const base = {
  subscriberId: 'DLA:user_1',
  teamKey: 'DLA',
  linearUserId: 'user_1',
  domains: new Set(['backend']),
  localEndpoint: 'https://a.example.com/webhooks/relay',
  subscriberSecret: 'secret_1',
};

describe('SubscriberRegistry (SQLite)', () => {
  let db: RelayDatabase;
  let registry: SubscriberRegistry;

  beforeEach(() => {
    db = openRelayDatabase(':memory:');
    registry = new SubscriberRegistry(db);
  });

  afterEach(() => db.close());

  it('returns null for an unknown subscriber', async () => {
    await expect(registry.getSubscriber('nope')).resolves.toBeNull();
  });

  it('stores and reads back every field, including the domains set', async () => {
    const saved = await registry.upsertSubscriber(base);

    const found = await registry.getSubscriber('DLA:user_1');

    expect(found).toEqual(saved);
    expect(found).toMatchObject({ ...base, version: 1, lastWebhookAt: undefined });
    expect([...found!.domains]).toEqual(['backend']);
  });

  it('re-registering updates in place: keeps registeredAt and lastWebhookAt, bumps version', async () => {
    const first = await registry.upsertSubscriber(base);
    await registry.markWebhookDelivered(base.subscriberId);
    const delivered = (await registry.getSubscriber(base.subscriberId))!;

    const second = await registry.upsertSubscriber({
      ...base,
      localEndpoint: 'https://b.example.com/x',
      subscriberSecret: 'secret_2',
    });

    expect(second.version).toBe(2);
    expect(second.registeredAt).toBe(first.registeredAt);
    expect(second.lastWebhookAt).toBe(delivered.lastWebhookAt);
    expect(second.localEndpoint).toBe('https://b.example.com/x');
    expect(await registry.getSubscribersByTeam('DLA')).toHaveLength(1);
  });

  it('finds subscribers by team, and by team and assignee', async () => {
    await registry.upsertSubscriber(base);
    await registry.upsertSubscriber({
      ...base,
      subscriberId: 'DLA:user_2',
      linearUserId: 'user_2',
    });
    await registry.upsertSubscriber({ ...base, subscriberId: 'SAM:user_1', teamKey: 'SAM' });

    expect((await registry.getSubscribersByTeam('DLA')).map((s) => s.subscriberId)).toEqual([
      'DLA:user_1',
      'DLA:user_2',
    ]);
    expect(
      (await registry.getSubscribersByTeamAndAssignee('DLA', 'user_2')).map((s) => s.subscriberId),
    ).toEqual(['DLA:user_2']);
    expect(await registry.getSubscribersByTeam('NONE')).toEqual([]);
  });

  it('updates only the endpoint by id, bumping the version', async () => {
    await registry.upsertSubscriber(base);

    const updated = await registry.updateEndpointById(
      base.subscriberId,
      'https://moved.example.com/x',
    );

    expect(updated).toMatchObject({
      localEndpoint: 'https://moved.example.com/x',
      version: 2,
      subscriberSecret: 'secret_1',
    });
    await expect(registry.updateEndpointById('nope', 'https://x.example.com')).resolves.toBeNull();
  });

  it('deletes a subscriber', async () => {
    await registry.upsertSubscriber(base);

    await registry.deleteSubscriber(base.subscriberId);

    await expect(registry.getSubscriber(base.subscriberId)).resolves.toBeNull();
  });

  it('deletes only subscribers whose latest activity is older than the cutoff', async () => {
    const day = 24 * 60 * 60 * 1000;
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();
    const insert = db.prepare(
      `INSERT INTO subscribers (subscriber_id, team_key, linear_user_id, domains, local_endpoint, subscriber_secret, registered_at, last_seen_at, last_webhook_at, version)
       VALUES (?, 'DLA', 'u', '[]', 'https://x.example.com', 's', ?, ?, ?, 1)`,
    );
    insert.run('old-never-delivered', iso(30), iso(30), null); // idle since registering
    insert.run('old-seen-recent-webhook', iso(30), iso(30), iso(1)); // recent delivery keeps it
    insert.run('recent', iso(2), iso(2), null);

    const deleted = await registry.deleteStaleSubscribers(14 * day);

    expect(deleted).toBe(1);
    expect(await registry.getSubscriber('old-never-delivered')).toBeNull();
    expect(await registry.getSubscriber('old-seen-recent-webhook')).not.toBeNull();
    expect(await registry.getSubscriber('recent')).not.toBeNull();
  });

  it('generates a 64-character hex secret, different each time', () => {
    const a = registry.generateSubscriberSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(registry.generateSubscriberSecret()).not.toBe(a);
  });

  it('persists across reopening a database file', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const path = join(mkdtempSync(join(tmpdir(), 'relay-db-')), 'nested', 'relay.db');

    const first = openRelayDatabase(path);
    await new SubscriberRegistry(first).upsertSubscriber(base);
    first.close();

    const second = openRelayDatabase(path);
    await expect(
      new SubscriberRegistry(second).getSubscriber(base.subscriberId),
    ).resolves.not.toBeNull();
    second.close();
  });
});
