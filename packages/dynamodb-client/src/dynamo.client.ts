import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  PutCommandOutput,
  QueryCommand,
  QueryCommandInput,
  DeleteCommand,
  UpdateCommandInput,
  UpdateCommandOutput,
  DeleteCommandInput,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { Key } from './types';
import { buildUpdateExpression } from './utils';
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
    if (!removeKeys) {
      return item as T;
    }
    const withoutKeys = { ...item };
    Object.keys(key).forEach((k) => delete withoutKeys[k]);
    return withoutKeys as T;
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
}
