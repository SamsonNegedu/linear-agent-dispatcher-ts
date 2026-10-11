import { SubscriberService, buildSubscriberId } from '../subscriber.service';
import { SUBSCRIBER_REGISTRY_REPOSITORY } from '../subscriber-registry.provider';
import type { SubscriberRegistry } from '../subscriber-registry.repository';
import type { SubscriberRecord } from '../types';
import { baseSubscriberModuleTestBuilder } from './subscriber-module-test-utils';

function makeSubscriber(overrides: Partial<SubscriberRecord> = {}): SubscriberRecord {
  return {
    subscriberId: 'ENG:user_1',
    teamKey: 'ENG',
    linearUserId: 'user_1',
    domains: new Set(),
    localEndpoint: 'http://localhost:4000/webhook',
    subscriberSecret: 'secret',
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

describe('buildSubscriberId', () => {
  it('derives a deterministic id from team and user, excluding the endpoint', () => {
    expect(buildSubscriberId('ENG', 'user_1')).toBe('ENG:user_1');
  });
});

describe('SubscriberService', () => {
  let registry: jest.Mocked<SubscriberRegistry>;
  let service: SubscriberService;

  beforeEach(async () => {
    registry = {
      getSubscriber: jest.fn(),
      getSubscribersByTeamAndAssignee: jest.fn(),
      upsertSubscriber: jest.fn(),
      markWebhookDelivered: jest.fn(),
      deleteStaleSubscribers: jest.fn(),
      updateEndpointBySecret: jest.fn(),
      updateEndpointById: jest.fn(),
      generateSubscriberSecret: jest.fn(),
    } as unknown as jest.Mocked<SubscriberRegistry>;

    const module = await baseSubscriberModuleTestBuilder()
      .overrideProvider(SUBSCRIBER_REGISTRY_REPOSITORY)
      .useValue(registry)
      .compile();

    service = module.get(SubscriberService);
  });

  it('registers a subscriber by upserting into the registry with domains as a Set', async () => {
    const record = makeSubscriber();
    registry.upsertSubscriber.mockResolvedValue(record);

    const result = await service.registerSubscriber(
      'ENG:user_1',
      'ENG',
      'user_1',
      'http://localhost:4000/webhook',
      'secret',
      ['repo-a'],
    );

    expect(registry.upsertSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberId: 'ENG:user_1', domains: new Set(['repo-a']) }),
    );
    expect(result).toBe(record);
  });

  it('re-registering the same team/user pair with a new endpoint upserts the same subscriber id', async () => {
    registry.upsertSubscriber.mockResolvedValue(makeSubscriber());

    await service.registerSubscriber('ENG:user_1', 'ENG', 'user_1', 'http://new-tunnel:5000/webhook', 'secret');

    expect(registry.upsertSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberId: buildSubscriberId('ENG', 'user_1') }),
    );
  });

  it('deletes stale subscribers older than the given threshold', async () => {
    registry.deleteStaleSubscribers.mockResolvedValue(3);

    const count = await service.deleteStaleSubscribers(86_400_000);

    expect(registry.deleteStaleSubscribers).toHaveBeenCalledWith(86_400_000);
    expect(count).toBe(3);
  });
});
