import { BatchWriteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoClient } from './dynamo.client';

type Send = jest.Mock<
  Promise<unknown>,
  [{ constructor: { name: string }; input: Record<string, unknown> }]
>;

function makeClient(): { client: DynamoClient; send: Send } {
  const client = new DynamoClient();
  const send: Send = jest.fn();
  (client as unknown as { docClient: { send: Send } }).docClient = { send };
  // Skip real backoff delays.
  jest.spyOn(client as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
  return { client, send };
}

const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ pKey: `p${i}`, sKey: 's' }));

describe('DynamoClient', () => {
  describe('batchGetItems', () => {
    it('sends nothing for an empty key list', async () => {
      const { client, send } = makeClient();

      await expect(client.batchGetItems('T', [])).resolves.toEqual([]);
      expect(send).not.toHaveBeenCalled();
    });

    it('splits into requests of at most 100 keys', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({ Responses: { T: [] } });

      await client.batchGetItems('T', keys(250));

      expect(send).toHaveBeenCalledTimes(3);
      const sizes = send.mock.calls.map(
        ([cmd]) =>
          (cmd.input as { RequestItems: { T: { Keys: unknown[] } } }).RequestItems.T.Keys.length,
      );
      expect(sizes).toEqual([100, 100, 50]);
    });

    it('re-requests UnprocessedKeys so throttled items are not silently lost', async () => {
      const { client, send } = makeClient();
      send
        .mockResolvedValueOnce({
          Responses: { T: [{ id: 1 }] },
          UnprocessedKeys: { T: { Keys: [{ pKey: 'p1', sKey: 's' }] } },
        })
        .mockResolvedValueOnce({ Responses: { T: [{ id: 2 }] } });

      const result = await client.batchGetItems<{ id: number }>('T', keys(2));

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      expect(send).toHaveBeenCalledTimes(2);
      expect((send.mock.calls[1][0].input as { RequestItems: unknown }).RequestItems).toEqual({
        T: { Keys: [{ pKey: 'p1', sKey: 's' }] },
      });
    });

    it('throws when keys are still unprocessed after all retries', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({
        Responses: { T: [] },
        UnprocessedKeys: { T: { Keys: [{ pKey: 'p', sKey: 's' }] } },
      });

      await expect(client.batchGetItems('T', keys(1))).rejects.toThrow(
        /BatchGetItems.*unprocessed/,
      );
      expect(send).toHaveBeenCalledTimes(5);
    });
  });

  describe('batch writes', () => {
    it('chunks puts into requests of at most 25 items', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({});

      await client.batchWriteItems('T', keys(60));

      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls.every(([cmd]) => cmd instanceof BatchWriteCommand)).toBe(true);
    });

    it('retries unprocessed delete requests', async () => {
      const { client, send } = makeClient();
      const unprocessed = { T: [{ DeleteRequest: { Key: { pKey: 'p0', sKey: 's' } } }] };
      send
        .mockResolvedValueOnce({ UnprocessedItems: unprocessed })
        .mockResolvedValueOnce({ UnprocessedItems: {} });

      await client.batchDeleteItems('T', keys(1));

      expect(send).toHaveBeenCalledTimes(2);
      expect((send.mock.calls[1][0].input as { RequestItems: unknown }).RequestItems).toEqual(
        unprocessed,
      );
    });

    it('throws after exhausting retries', async () => {
      const { client, send } = makeClient();
      send.mockResolvedValue({
        UnprocessedItems: { T: [{ PutRequest: { Item: { pKey: 'p' } } }] },
      });

      await expect(client.batchWriteItems('T', [{ pKey: 'p' }])).rejects.toThrow(
        /BatchWriteItems.*unprocessed/,
      );
    });

    it('sends nothing for an empty list', async () => {
      const { client, send } = makeClient();

      await client.batchWriteItems('T', []);
      await client.batchDeleteItems('T', []);

      expect(send).not.toHaveBeenCalled();
    });
  });

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
