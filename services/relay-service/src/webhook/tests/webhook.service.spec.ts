import { AdapterRegistry } from '@webhook-verify/core';
import type { NormalizedEvent, RoutingResolver } from '@webhook-verify/core';
import { WebhookService } from '../webhook.service';
import { SubscriberService } from '../../subscriber/subscriber.service';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import type { SubscriberRecord } from '../../subscriber/types';
import { baseWebhookModuleTestBuilder } from './webhook-module-test-utils';

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    provider: 'linear',
    kind: 'issue',
    webhookId: 'wh_1',
    idempotencyKey: 'issue:ISSUE-1:update:1',
    timestamp: Date.now(),
    organizationId: 'org_1',
    issueId: 'issue_1',
    issueIdentifier: 'ISSUE-1',
    routingKey: 'ENG',
    ownerId: 'user_1',
    routingTags: [],
    isTerminal: false,
    rawPayload: {},
    ...overrides,
  };
}

function makeSubscriber(overrides: Partial<SubscriberRecord> = {}): SubscriberRecord {
  return {
    subscriberId: 'sub_1',
    teamKey: 'ENG',
    linearUserId: 'user_1',
    domains: new Set(['repo-a']),
    localEndpoint: 'http://localhost:4000/webhook',
    subscriberSecret: 'secret',
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

describe('WebhookService.fanOutWebhook', () => {
  let subscriberService: jest.Mocked<SubscriberService>;
  let deliveryService: jest.Mocked<WebhookDeliveryService>;
  let routingResolverRegistry: AdapterRegistry<RoutingResolver>;
  let service: WebhookService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    subscriberService = {
      getSubscribersByTeamAndAssignee: jest.fn(),
      markWebhookDelivered: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SubscriberService>;
    deliveryService = {
      logAttempt: jest.fn().mockResolvedValue('delivery_1'),
      logResult: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WebhookDeliveryService>;
    routingResolverRegistry = new AdapterRegistry<RoutingResolver>();

    const module = await baseWebhookModuleTestBuilder()
      .overrideProvider(SubscriberService)
      .useValue(subscriberService)
      .overrideProvider(WebhookDeliveryService)
      .useValue(deliveryService)
      .overrideProvider('RoutingResolverRegistry')
      .useValue(routingResolverRegistry)
      .compile();

    service = module.get(WebhookService);

    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  it('skips fan-out when routing info is missing and no resolver can backfill it', async () => {
    const event = makeEvent({ kind: 'agent_session', ownerId: undefined, routingKey: undefined });

    const result = await service.fanOutWebhook(event, JSON.stringify(event));

    expect(result).toEqual({
      webhookId: 'wh_1',
      teamKey: 'unknown',
      assigneeId: 'unassigned',
      delivered: 0,
      failed: 0,
      skipped: true,
    });
    expect(subscriberService.getSubscribersByTeamAndAssignee).not.toHaveBeenCalled();
  });

  it('backfills missing routing via the provider resolver, then delivers to subscribers', async () => {
    const resolver: jest.Mocked<RoutingResolver> = {
      provider: 'linear',
      resolveMissingRouting: jest.fn().mockResolvedValue({ ownerId: 'user_1', routingKey: 'ENG' }),
    };
    routingResolverRegistry.register(resolver);

    const subscriber = makeSubscriber();
    subscriberService.getSubscribersByTeamAndAssignee.mockResolvedValue([subscriber]);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const event = makeEvent({ kind: 'agent_session', ownerId: undefined });
    const result = await service.fanOutWebhook(event, JSON.stringify(event));

    expect(resolver.resolveMissingRouting).toHaveBeenCalledWith(event);
    expect(subscriberService.getSubscribersByTeamAndAssignee).toHaveBeenCalledWith('ENG', 'user_1');
    expect(result).toEqual({
      webhookId: 'wh_1',
      teamKey: 'ENG',
      assigneeId: 'user_1',
      delivered: 1,
      failed: 0,
    });
  });

  it('reports zero delivered/failed when no subscribers match the routing key', async () => {
    subscriberService.getSubscribersByTeamAndAssignee.mockResolvedValue([]);

    const event = makeEvent();
    const result = await service.fanOutWebhook(event, JSON.stringify(event));

    expect(result).toEqual({
      webhookId: 'wh_1',
      teamKey: 'ENG',
      assigneeId: 'user_1',
      delivered: 0,
      failed: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts per-subscriber delivery failures without failing the whole fan-out', async () => {
    const okSubscriber = makeSubscriber({ subscriberId: 'sub_ok', localEndpoint: 'http://ok.local' });
    const failSubscriber = makeSubscriber({ subscriberId: 'sub_fail', localEndpoint: 'http://fail.local' });
    subscriberService.getSubscribersByTeamAndAssignee.mockResolvedValue([okSubscriber, failSubscriber]);
    fetchMock.mockImplementation((endpoint: string) =>
      endpoint === 'http://ok.local'
        ? Promise.resolve({ ok: true, status: 200 })
        : Promise.resolve({ ok: false, status: 500 }),
    );

    const event = makeEvent();
    const result = await service.fanOutWebhook(event, JSON.stringify(event));

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
  });
});
