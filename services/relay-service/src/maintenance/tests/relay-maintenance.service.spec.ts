import {
  DELIVERY_RETENTION_MS,
  RelayMaintenanceService,
  SUBSCRIBER_INACTIVE_MS,
} from '../relay-maintenance.service';
import type { SubscriberRegistry } from '../../subscriber/subscriber-registry.repository';
import type { WebhookDeliveries } from '../../webhook/webhook-deliveries.repository';

function build() {
  const subscribers = {
    deleteStaleSubscribers: jest.fn().mockResolvedValue(2),
  } as unknown as jest.Mocked<SubscriberRegistry>;
  const deliveries = {
    deleteOlderThan: jest.fn().mockResolvedValue(5),
  } as unknown as jest.Mocked<WebhookDeliveries>;
  return { service: new RelayMaintenanceService(subscribers, deliveries), subscribers, deliveries };
}

describe('RelayMaintenanceService', () => {
  afterEach(() => jest.useRealTimers());

  it('drops subscribers inactive for 14 days and delivery logs older than 30 days', async () => {
    const { service, subscribers, deliveries } = build();

    await service.run();

    expect(subscribers.deleteStaleSubscribers).toHaveBeenCalledWith(SUBSCRIBER_INACTIVE_MS);
    expect(deliveries.deleteOlderThan).toHaveBeenCalledWith(DELIVERY_RETENTION_MS);
    expect(SUBSCRIBER_INACTIVE_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(DELIVERY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('does not throw when cleanup fails', async () => {
    const { service, subscribers } = build();
    subscribers.deleteStaleSubscribers.mockRejectedValue(new Error('db locked'));

    await expect(service.run()).resolves.toBeUndefined();
  });

  it('runs at startup and then every day, and stops on destroy', async () => {
    jest.useFakeTimers();
    const { service, subscribers } = build();

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(subscribers.deleteStaleSubscribers).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(subscribers.deleteStaleSubscribers).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    expect(subscribers.deleteStaleSubscribers).toHaveBeenCalledTimes(2);
  });
});
