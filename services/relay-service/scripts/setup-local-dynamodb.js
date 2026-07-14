#!/usr/bin/env node
/**
 * Creates the single relay table (subscribers + webhook deliveries,
 * single-table design) against a local DynamoDB
 * (e.g. `docker run -p 8000:8000 amazon/dynamodb-local`).
 *
 * In AWS this is provisioned by SST (see infra/relay-service-table.definition.ts);
 * this script mirrors that same schema for local dev, where nothing provisions
 * it automatically. Safe to re-run: skips the table if it already exists.
 */
const {
  DynamoDBClient,
  CreateTableCommand,
  UpdateTimeToLiveCommand,
  ListTablesCommand,
  DeleteTableCommand,
} = require('@aws-sdk/client-dynamodb');

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const region = process.env.DYNAMODB_REGION || 'us-east-1';
const tableName = process.env.RELAY_TABLE_NAME || 'RelayTable';

const client = new DynamoDBClient({
  endpoint,
  region,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function tableExists(name) {
  const { TableNames } = await client.send(new ListTablesCommand({}));
  return (TableNames || []).includes(name);
}

async function dropLegacyTables() {
  for (const legacyTable of ['SubscriberRegistry', 'WebhookDeliveries']) {
    if (await tableExists(legacyTable)) {
      await client.send(new DeleteTableCommand({ TableName: legacyTable }));
      console.log(`✓ Dropped legacy table ${legacyTable} (replaced by single-table design)`);
    }
  }
}

async function createRelayTable() {
  if (await tableExists(tableName)) {
    console.log(`✓ ${tableName} already exists`);
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pKey', AttributeType: 'S' },
        { AttributeName: 'sKey', AttributeType: 'S' },
        { AttributeName: 'GSI1pKey', AttributeType: 'S' },
        { AttributeName: 'GSI1sKey', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pKey', KeyType: 'HASH' },
        { AttributeName: 'sKey', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1pKey', KeyType: 'HASH' },
            { AttributeName: 'GSI1sKey', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );

  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    }),
  );

  console.log(`✓ Created ${tableName}`);
}

async function main() {
  console.log(`Setting up local DynamoDB table at ${endpoint}...`);
  await dropLegacyTables();
  await createRelayTable();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Failed to set up local DynamoDB table:', err);
  process.exitCode = 1;
});
