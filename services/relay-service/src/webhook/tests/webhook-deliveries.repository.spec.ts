import { openRelayDatabase, RelayDatabase } from '../../database/relay-database';
import { WebhookDeliveries } from '../webhook-deliveries.repository';

describe('WebhookDeliveries (SQLite)', () => {
  let db: RelayDatabase;
  let deliveries: WebhookDeliveries;
  const rows = () =>
    db.prepare('SELECT * FROM webhook_deliveries ORDER BY timestamp').all() as Record<
      string,
      unknown
    >[];

  beforeEach(() => {
    db = openRelayDatabase(':memory:');
    deliveries = new WebhookDeliveries(db);
  });

  afterEach(() => db.close());

  it('records an attempt and returns its id', async () => {
    const id = await deliveries.logDeliveryAttempt(
      'sub_1',
      'DLA',
      'wh_1',
      'issue_1',
      'DLA-1',
      'user_1',
    );

    expect(rows()).toEqual([
      expect.objectContaining({
        delivery_id: id,
        subscriber_id: 'sub_1',
        team_key: 'DLA',
        webhook_id: 'wh_1',
        issue_id: 'issue_1',
        issue_identifier: 'DLA-1',
        linear_assignee_id: 'user_1',
        status: 'success',
        response_time: null,
        error_message: null,
      }),
    ]);
  });

  it('sets the outcome without wiping the fields written at attempt time', async () => {
    const id = await deliveries.logDeliveryAttempt('sub_1', 'DLA', 'wh_1', 'issue_1', 'DLA-1');

    await deliveries.logDeliveryResult(id, 'timeout', 5000, 'timed out');
    await deliveries.logDeliveryResult(id, 'unreachable'); // later update without optional fields keeps them

    expect(rows()[0]).toMatchObject({
      status: 'unreachable',
      response_time: 5000,
      error_message: 'timed out',
      subscriber_id: 'sub_1',
      issue_identifier: 'DLA-1',
    });
  });

  it('deletes only delivery logs older than the retention window', async () => {
    const day = 24 * 60 * 60 * 1000;
    const insert = db.prepare(
      `INSERT INTO webhook_deliveries (delivery_id, timestamp, subscriber_id, team_key, webhook_id, issue_id, issue_identifier, status)
       VALUES (?, ?, 's', 'DLA', 'w', 'i', 'DLA-1', 'success')`,
    );
    insert.run('old', new Date(Date.now() - 40 * day).toISOString());
    insert.run('recent', new Date(Date.now() - 5 * day).toISOString());

    expect(await deliveries.deleteOlderThan(30 * day)).toBe(1);
    expect(rows().map((r) => r.delivery_id)).toEqual(['recent']);
  });
});
