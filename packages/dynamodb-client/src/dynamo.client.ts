import { Injectable, Logger } from '@nestjs/common';
import { add, Duration } from 'date-fns';
import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
  PutCommand,
  UpdateCommand,
  PutCommandOutput,
  QueryCommand,
  QueryCommandInput,
  DeleteCommand,
  BatchWriteCommand,
  UpdateCommandInput,
  UpdateCommandOutput,
  DeleteCommandInput,
  QueryCommandOutput,
  BatchGetCommandInput,
  BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Key } from './types';
import { buildUpdateExpression, chunk } from './utils';
import { NodeHttpHandler } from '@smithy/node-http-handler';
export { QueryCommandInput, QueryCommandOutput, PutCommandOutput } from '@aws-sdk/lib-dynamodb';
export { NativeAttributeValue } from '@aws-sdk/util-dynamodb';

const MAX_RETRIES = 5;
// DynamoDB per-request limits
const BATCH_GET_LIMIT = 100;
const BATCH_WRITE_LIMIT = 25;

/** DynamoDB reports "nothing left" as undefined or an empty object. */
const nonEmpty = <T extends object>(value: T | undefined): T | undefined =>
  value && Object.keys(value).length > 0 ? value : undefined;

/**
 * Builds the DynamoDBClient config for local dev against DynamoDB Local
 * (docker), mirroring what the previous DynamoDBModule did.
 */
function buildLocalDevConfig(): DynamoDBClientConfig {
  const config: DynamoDBClientConfig = {};

  if (process.env.DYNAMODB_ENDPOINT) {
    config.endpoint = process.env.DYNAMODB_ENDPOINT;

    // DynamoDB Local partitions its data by access key + region (unless
    // started with -sharedDb), so without fixed credentials here the SDK's
    // default credential chain (whatever real AWS profile/env vars happen
    // to be present, or none at all) would silently point at a different,
    // empty table namespace than whatever created the tables. Only do this
    // for an actual local endpoint, not a real (non-AWS) DynamoDB-compatible
    // endpoint that would need genuine credentials.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(config.endpoint)) {
      config.credentials = {
        accessKeyId: 'local',
        secretAccessKey: 'local',
      };
    }
  }

  if (process.env.DYNAMODB_REGION) {
    config.region = process.env.DYNAMODB_REGION;
  }

  return config;
}

@Injectable()
export class DynamoClient {
  readonly logger: Logger = new Logger(DynamoClient.name);

  private docClient: DynamoDBDocumentClient;

  constructor() {
    const client = new DynamoDBClient({
      ...buildLocalDevConfig(),
      maxAttempts: MAX_RETRIES,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 1000,
        requestTimeout: 1000,
      }),
    });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
    });
  }

  async getItem<T>(table: string, key: Key, removeKeys = true): Promise<T | undefined> {
    const response = await this.docClient.send(new GetCommand({ TableName: table, Key: key }));
    const item = response.Item;
    if (!item) {
      return undefined;
    }
    if (!removeKeys) {
      return item as T;
    }
    const withoutKeys = { ...item };
    Object.keys(key).forEach((k) => delete withoutKeys[k]);
    return withoutKeys as T;
  }

  async batchGetItems<T>(table: string, keys: Key[]): Promise<T[]> {
    const results: T[] = [];

    for (const keyChunk of chunk(keys, BATCH_GET_LIMIT)) {
      // DynamoDB may return only part of a batch (throttling, size limits) and reports the
      // rest as UnprocessedKeys; those must be re-requested or the items are silently lost.
      await this.retryUnprocessed<BatchGetCommandInput['RequestItems']>(
        'BatchGetItems',
        { [table]: { Keys: keyChunk } },
        async (requestItems) => {
          const response = await this.docClient.send(new BatchGetCommand({ RequestItems: requestItems }));
          results.push(...((response.Responses?.[table] ?? []) as T[]));
          return nonEmpty(response.UnprocessedKeys);
        },
      );
    }

    return results;
  }

  async putItem<T>(table: string, item: Partial<T>): Promise<PutCommandOutput> {
    return this.docClient.send(new PutCommand({ TableName: table, Item: item }));
  }

  async update(command: UpdateCommandInput): Promise<UpdateCommandOutput> {
    return this.docClient.send(new UpdateCommand(command));
  }

  async updateItem<T>(table: string, key: Key, values: Partial<T>): Promise<void> {
    const update = buildUpdateExpression(values);
    if (!update) return; // nothing to change; DynamoDB rejects an empty UpdateExpression

    await this.docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: key,
        UpdateExpression: update.expression,
        ExpressionAttributeNames: update.names,
        ExpressionAttributeValues: update.values,
        ReturnValues: 'NONE',
      }),
    );
  }

  async query(params: QueryCommandInput): Promise<QueryCommandOutput> {
    return this.docClient.send(new QueryCommand(params));
  }

  async queryItems<T>(params: QueryCommandInput): Promise<T[]> {
    const queryResponse = await this.docClient.send(new QueryCommand(params));
    return (queryResponse.Items ?? []) as T[];
  }

  // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
  async queryAllItems<T>(
    params: QueryCommandInput,
    prevResultItems: T[] = [],
    exclusiveStartKey?: Key,
  ): Promise<T[]> {
    const items = [...prevResultItems];
    let startKey: Key | undefined = exclusiveStartKey;

    do {
      const response = await this.docClient.send(
        new QueryCommand({ ...params, ExclusiveStartKey: startKey }),
      );
      items.push(...((response.Items ?? []) as T[]));
      startKey = response.LastEvaluatedKey as Key | undefined;
    } while (startKey);

    return items;
  }

  async delete(command: DeleteCommandInput): Promise<void> {
    await this.docClient.send(new DeleteCommand(command));
  }

  async deleteItem(table: string, pKey: string, sKey: string): Promise<void> {
    await this.delete({
      TableName: table,
      Key: { pKey, sKey },
    });
  }

  async batchDeleteItems(table: string, keys: Key[]): Promise<void> {
    await Promise.all(
      chunk(keys, BATCH_WRITE_LIMIT).map((keyChunk) =>
        this.batchWriteWithRetry(
          'BatchDeleteItems',
          table,
          keyChunk.map((Key) => ({ DeleteRequest: { Key } })),
        ),
      ),
    );
  }

  async batchWriteItems<T>(table: string, putItems: Partial<T>[]): Promise<void> {
    await Promise.all(
      chunk(putItems, BATCH_WRITE_LIMIT).map((itemChunk) =>
        this.batchWriteWithRetry(
          'BatchWriteItems',
          table,
          itemChunk.map((Item) => ({ PutRequest: { Item } })),
        ),
      ),
    );
  }

  async putItemWithTTL<T>({
    table,
    item,
    ttlSettings,
  }: {
    table: string;
    item: Partial<T>;
    ttlSettings: Duration;
  }): Promise<PutCommandOutput> {
    const now = new Date();

    const validUntil = add(now, ttlSettings).getTime();

    return this.putItem(table, { ...item, validUntil });
  }

  private async batchWriteWithRetry(
    label: string,
    table: string,
    requests: NonNullable<BatchWriteCommandInput['RequestItems']>[string],
  ): Promise<void> {
    await this.retryUnprocessed<BatchWriteCommandInput['RequestItems']>(
      label,
      { [table]: requests },
      async (requestItems) => {
        const response = await this.docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
        return nonEmpty(response.UnprocessedItems);
      },
    );
  }

  /**
   * Sends a batch request, re-sending whatever DynamoDB reports as unprocessed with
   * exponential backoff, and throws if anything is still unprocessed after MAX_RETRIES attempts.
   * `send` returns the unprocessed remainder, or undefined when everything went through.
   */
  private async retryUnprocessed<R>(
    label: string,
    initialRequest: R,
    send: (request: R) => Promise<R | undefined>,
  ): Promise<void> {
    let request: R | undefined = initialRequest;

    for (let attempt = 0; request; attempt++) {
      const unprocessed = await send(request);
      if (!unprocessed) return;

      if (attempt + 1 >= MAX_RETRIES) {
        throw new Error(`DynamoClient: ${label} request has unprocessed items after all retries.`);
      }
      await this.sleep(this.calculateRetryDelay(attempt));
      this.logger.log(`DynamoClient: ${label} retrying`);
      request = unprocessed;
    }
  }

  /**
   * Calculate the delay for the next retry attempt exponentially with jitter
   * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
   */
  private calculateRetryDelay(retryCount: number): number {
    return Math.ceil(Math.random() * (Math.pow(2, retryCount) * 100));
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
