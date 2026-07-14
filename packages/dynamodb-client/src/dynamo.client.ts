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
  BatchWriteCommandOutput,
  BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Key } from './types';
import { chunkArray, formatUpdateExpression } from './utils';
import { NodeHttpHandler } from '@smithy/node-http-handler';
export { QueryCommandInput, QueryCommandOutput, PutCommandOutput } from '@aws-sdk/lib-dynamodb';
export { NativeAttributeValue } from '@aws-sdk/util-dynamodb';

const MAX_RETRIES = 5;

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
    if (removeKeys) {
      Object.keys(key).forEach((k) => delete item[k]);
    }
    return item as T;
  }

  async batchGetItems<T>(table: string, keys: Key[]): Promise<T[]> {
    const keysArray = keys.length > 100 ? chunkArray(keys) : [keys];
    const batchResponse: T[] = [];

    for (const chunk of keysArray) {
      const RequestItems = {
        [table]: {
          Keys: chunk,
        },
      };

      const response = await this.docClient.send(new BatchGetCommand({ RequestItems }));
      const items = response.Responses;
      if (items && items[table].length) {
        batchResponse.push(...(items[table] as T[]));
      }
    }

    return batchResponse;
  }

  async putItem<T>(table: string, item: Partial<T>): Promise<PutCommandOutput> {
    return this.docClient.send(new PutCommand({ TableName: table, Item: item }));
  }

  async update(command: UpdateCommandInput): Promise<UpdateCommandOutput> {
    return this.docClient.send(new UpdateCommand(command));
  }

  async updateItem<T>(table: string, key: Key, values: Partial<T>): Promise<void> {
    const { updateExpression, updateValues, attributeNames } = formatUpdateExpression(values);
    await this.docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: updateValues,
        ReturnValues: 'NONE',
      }),
    );
  }

  async query(params: QueryCommandInput): Promise<QueryCommandOutput> {
    return this.docClient.send(new QueryCommand(params));
  }

  async queryItems<T>(params: QueryCommandInput): Promise<T[]> {
    const queryResponse = await this.docClient.send(new QueryCommand(params));
    return queryResponse.Items as T[];
  }

  // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
  async queryAllItems<T>(
    params: QueryCommandInput,
    prevResultItems: T[] = [],
    exclusiveStartKey?: Key,
  ): Promise<T[]> {
    const queryResponse = await this.docClient.send(
      new QueryCommand({ ...params, ExclusiveStartKey: exclusiveStartKey }),
    );
    const resultItems = [...prevResultItems, ...(queryResponse.Items as T[])];

    if (queryResponse.LastEvaluatedKey) {
      return this.queryAllItems(params, resultItems, queryResponse.LastEvaluatedKey);
    }

    return resultItems;
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
    const keysArray: Key[][] = keys.length > 25 ? chunkArray(keys, 25) : [keys];
    const deletePromises = keysArray.map(async (chunk) => {
      const deleteRequestKeys = chunk.map((item) => ({
        DeleteRequest: {
          Key: item,
        },
      }));

      let requestItems: BatchWriteCommandInput['RequestItems'] = {
        [table]: deleteRequestKeys,
      };

      let retryCount = 0;
      while (retryCount < MAX_RETRIES) {
        const response: BatchWriteCommandOutput = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: requestItems }),
        );

        if (this.hasProcessedAll(response)) break;

        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);

        this.logger.log('DynamoClient: BatchDeleteItems retrying');

        requestItems = response.UnprocessedItems;
        retryCount += 1;

        if (retryCount === MAX_RETRIES)
          throw new Error(
            'DynamoClient: BatchDeleteItems request has unprocessed items after all retries.',
          );
      }
    });

    await Promise.all(deletePromises);
  }

  async batchWriteItems<T>(table: string, putItems: Partial<T>[]): Promise<void> {
    const putItemsArray: Partial<T>[][] =
      putItems.length > 25 ? chunkArray(putItems, 25) : [putItems];
    const writePromises = putItemsArray.map(async (chunk) => {
      const putItemRequests = chunk.map((item) => ({
        PutRequest: {
          Item: item,
        },
      }));

      let requestItems: BatchWriteCommandInput['RequestItems'] = {
        [table]: putItemRequests,
      };

      let retryCount = 0;
      while (retryCount < MAX_RETRIES) {
        const response: BatchWriteCommandOutput = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: requestItems }),
        );

        if (this.hasProcessedAll(response)) break;

        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);

        this.logger.log('DynamoClient: BatchWriteItems retrying');

        requestItems = response.UnprocessedItems;
        retryCount += 1;

        if (retryCount === MAX_RETRIES)
          throw new Error(
            'DynamoClient: BatchWriteItems request has unprocessed items after all retries.',
          );
      }
    });

    await Promise.all(writePromises);
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

  private hasProcessedAll(response: BatchWriteCommandOutput): boolean {
    return !response.UnprocessedItems || !Object.keys(response.UnprocessedItems).length;
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
