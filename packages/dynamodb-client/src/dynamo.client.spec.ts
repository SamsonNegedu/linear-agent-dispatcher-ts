import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoClient } from './dynamo.client';

type Send = jest.Mock<
  Promise<unknown>,
  [{ constructor: { name: string }; input: Record<string, unknown> }]
>;

function makeClient(): { client: DynamoClient; send: Send } {
  const client = new DynamoClient();
  const send: Send = jest.fn();
  (client as unknown as { docClient: { send: Send } }).docClient = { send };
  return { client, send };
}

describe('DynamoClient', () => {
  describe('queryAllItems', () => {
    it('follows LastEvaluatedKey across pages and returns every item', async () => {
      const { client, send } = makeClient();
      send
        .mockResolvedValueOnce({ Items: [{ n: 1 }], LastEvaluatedKey: { pKey: 'a' } })
        .mockResolvedValueOnce({ Items: [{ n: 2 }], LastEvaluatedKey: { pKey: 'b' } })
        .mockResolvedValueOnce({ Items: [{ n: 3 }] });

      const items = await client.queryAllItems<{ n: number }>({ TableName: 'T' });

      expect(items).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
      expect(send.mock.calls.every(([cmd]) => cmd instanceof QueryCommand)).toBe(true);
      expect(
        (send.mock.calls[2][0].input as { ExclusiveStartKey: unknown }).ExclusiveStartKey,
      ).toEqual({ pKey: 'b' });
    });

    it('treats a page without Items as empty', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({});

      await expect(client.queryAllItems({ TableName: 'T' })).resolves.toEqual([]);
      await expect(client.queryItems({ TableName: 'T' })).resolves.toEqual([]);
    });
  });

  describe('getItem', () => {
    it('strips key attributes without mutating the stored object', async () => {
      const { client, send } = makeClient();
      const stored = { pKey: 'p', sKey: 's', value: 1 };
      send.mockResolvedValue({ Item: stored });

      const item = await client.getItem<{ value: number }>('T', { pKey: 'p', sKey: 's' });

      expect(item).toEqual({ value: 1 });
      expect(stored).toEqual({ pKey: 'p', sKey: 's', value: 1 });
      expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    });

    it('returns undefined when the item does not exist', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({});

      await expect(client.getItem('T', { pKey: 'p' })).resolves.toBeUndefined();
    });
  });

  describe('updateItem', () => {
    it('sends a SET expression for the changed attributes', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({});

      await client.updateItem('T', { pKey: 'p' }, { status: 'done', skipped: undefined });

      const command = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(UpdateCommand);
      expect(command.input).toMatchObject({
        UpdateExpression: 'SET #k0 = :v0',
        ExpressionAttributeNames: { '#k0': 'status' },
        ExpressionAttributeValues: { ':v0': 'done' },
      });
    });

    it('does nothing when there is nothing to update', async () => {
      const { client, send } = makeClient();

      await client.updateItem('T', { pKey: 'p' }, {});

      expect(send).not.toHaveBeenCalled();
    });
  });
});
