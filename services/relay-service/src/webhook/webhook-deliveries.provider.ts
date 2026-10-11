import { Provider } from '@nestjs/common';
import { RELAY_DATABASE, RelayDatabase } from '../database/relay-database';
import { WebhookDeliveries } from './webhook-deliveries.repository';

export const WEBHOOK_DELIVERIES_REPOSITORY = 'WEBHOOK_DELIVERIES_REPOSITORY';

export const webhookDeliveriesProvider: Provider = {
  provide: WEBHOOK_DELIVERIES_REPOSITORY,
  useFactory: (db: RelayDatabase) => new WebhookDeliveries(db),
  inject: [RELAY_DATABASE],
};
