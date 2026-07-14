import { Provider } from '@nestjs/common';
import { DynamoClient } from '@dynamodb/client';
import { WebhookDeliveries } from './webhook-deliveries.repository';
import { RelayServiceConfig } from '../config/relay-config';

export const WEBHOOK_DELIVERIES_REPOSITORY = 'WEBHOOK_DELIVERIES_REPOSITORY';

export const webhookDeliveriesProvider: Provider = {
  provide: WEBHOOK_DELIVERIES_REPOSITORY,
  useFactory: (dynamoClient: DynamoClient, config: RelayServiceConfig) => {
    return new WebhookDeliveries(dynamoClient, config.dynamodb.tableName);
  },
  inject: [DynamoClient, 'RelayServiceConfig'],
};
