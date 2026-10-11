import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WEBHOOK_DELIVERIES_REPOSITORY } from '../webhook-deliveries.provider';
import type { WebhookDeliveries } from '../webhook-deliveries.repository';
import { baseWebhookModuleTestBuilder } from './webhook-module-test-utils';

describe('WebhookDeliveryService', () => {
  let deliveries: jest.Mocked<WebhookDeliveries>;
  let service: WebhookDeliveryService;

  beforeEach(async () => {
    deliveries = {
      logDeliveryAttempt: jest.fn().mockResolvedValue('delivery_1'),
      logDeliveryResult: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebhookDeliveries>;

    const module = await baseWebhookModuleTestBuilder()
      .overrideProvider(WEBHOOK_DELIVERIES_REPOSITORY)
      .useValue(deliveries)
      .compile();

    service = module.get(WebhookDeliveryService);
  });

  it('logs a delivery attempt and returns the generated delivery id', async () => {
    const id = await service.logAttempt('sub_1', 'ENG', 'wh_1', 'issue_1', 'ISSUE-1', 'user_1');

    expect(deliveries.logDeliveryAttempt).toHaveBeenCalledWith(
      'sub_1',
      'ENG',
      'wh_1',
      'issue_1',
      'ISSUE-1',
      'user_1',
    );
    expect(id).toBe('delivery_1');
  });

  it('logs a delivery result', async () => {
    await service.logResult('delivery_1', 'success', 120);

    expect(deliveries.logDeliveryResult).toHaveBeenCalledWith('delivery_1', 'success', 120, undefined);
  });
});
