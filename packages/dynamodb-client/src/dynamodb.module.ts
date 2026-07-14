import { Module } from '@nestjs/common';
import { DynamoClient } from './dynamo.client';

/**
 * DynamoDB module: provides singleton DynamoClient (document-client wrapper)
 * for injection.
 *
 * Works out-of-the-box with sst dev (no env vars needed).
 * Optional environment variables:
 * - DYNAMODB_ENDPOINT: override endpoint (e.g., http://localhost:8000 for local testing without sst)
 * - DYNAMODB_REGION: override region (default: reads AWS_REGION env var)
 */
@Module({
  providers: [DynamoClient],
  exports: [DynamoClient],
})
export class DynamoDBModule {}
