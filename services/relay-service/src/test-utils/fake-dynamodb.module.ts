import { Module } from '@nestjs/common';
import { DynamoClient } from '@dynamodb/client';

/**
 * Substitutes DynamoDBModule in tests via `overrideModule` — keeps any
 * factory that injects DynamoClient resolvable without constructing a real
 * AWS SDK client, and tests then swap the specific repository token
 * (e.g. SUBSCRIBER_REGISTRY_REPOSITORY) via `.overrideProvider(...)`.
 */
@Module({
  providers: [{ provide: DynamoClient, useValue: {} }],
  exports: [DynamoClient],
})
export class FakeDynamoDBModule {}
