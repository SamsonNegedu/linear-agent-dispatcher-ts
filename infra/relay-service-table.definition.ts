import { RemovalPolicy } from 'aws-cdk-lib';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { TableProps } from 'sst/constructs';

/**
 * Single-table design for relay-service: subscribers and webhook deliveries
 * share one table, distinguished by pKey/sKey prefix (SUBSCRIBER# / DELIVERY#).
 * GSI1 is the only secondary index, shared by both entity types, for the
 * team-scoped queries each needs (subscribers by team, deliveries by team+time).
 */
export const getRelayTableDefinition = (stage: string): TableProps => ({
  fields: {
    pKey: 'string',
    sKey: 'string',
    GSI1pKey: 'string',
    GSI1sKey: 'string',
  },
  primaryIndex: { partitionKey: 'pKey', sortKey: 'sKey' },
  globalIndexes: {
    GSI1: { partitionKey: 'GSI1pKey', sortKey: 'GSI1sKey' },
  },
  cdk: {
    table: {
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: `${stage}-relay-service`,
      timeToLiveAttribute: 'ttl',
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    },
  },
});
