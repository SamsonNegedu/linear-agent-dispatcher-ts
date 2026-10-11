import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookQueueService } from '../webhook-queue.service';
import { WebhookQueueEntity } from '../../../store/typeorm/webhook-queue.entity';
import { DispatcherService } from '../../dispatcher/dispatcher.service';
import { baseRelayModuleTestBuilder } from './relay-module-test-utils';
import type { NormalizedEvent } from '@webhook-verify/core';

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
    routingTags: [],
    isTerminal: false,
    rawPayload: {},
    ...overrides,
  };
}

function flushProcessing(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('WebhookQueueService', () => {
  let queueRepository: jest.Mocked<Repository<WebhookQueueEntity>>;
  let dispatcherService: jest.Mocked<DispatcherService>;
  let service: WebhookQueueService;

  beforeEach(async () => {
    queueRepository = {
      insert: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Repository<WebhookQueueEntity>>;
    dispatcherService = { dispatchWebhook: jest.fn() } as unknown as jest.Mocked<DispatcherService>;

    const module = await baseRelayModuleTestBuilder()
      .overrideProvider(getRepositoryToken(WebhookQueueEntity))
      .useValue(queueRepository)
      .overrideProvider(DispatcherService)
      .useValue(dispatcherService)
      .compile();

    service = module.get(WebhookQueueService);
  });

  it('enqueues and dispatches a webhook, then deletes the row on success', async () => {
    const event = makeEvent();
    queueRepository.insert.mockResolvedValue({} as never);
    queueRepository.findOne
      .mockResolvedValueOnce({
        id: 'row_1',
        idempotencyKey: event.idempotencyKey,
        webhookId: event.webhookId,
        payload: JSON.stringify(event),
        status: 'queued',
      } as WebhookQueueEntity)
      .mockResolvedValueOnce(null);
    dispatcherService.dispatchWebhook.mockResolvedValue(undefined);

    await service.enqueue(event);
    await flushProcessing();

    expect(dispatcherService.dispatchWebhook).toHaveBeenCalledWith(event);
    expect(queueRepository.delete).toHaveBeenCalledWith('row_1');
  });

  it('silently returns without processing when the insert fails (duplicate idempotency key)', async () => {
    queueRepository.insert.mockRejectedValue(new Error('UNIQUE constraint failed'));

    await service.enqueue(makeEvent());

    expect(queueRepository.findOne).not.toHaveBeenCalled();
    expect(dispatcherService.dispatchWebhook).not.toHaveBeenCalled();
  });

  it('marks a row failed when dispatch throws, and continues processing the next queued row', async () => {
    const eventA = makeEvent({ issueIdentifier: 'ISSUE-1' });
    const eventB = makeEvent({
      issueIdentifier: 'ISSUE-2',
      idempotencyKey: 'issue:ISSUE-2:update:1',
    });
    queueRepository.insert.mockResolvedValue({} as never);
    queueRepository.findOne
      .mockResolvedValueOnce({
        id: 'row_a',
        idempotencyKey: eventA.idempotencyKey,
        webhookId: eventA.webhookId,
        payload: JSON.stringify(eventA),
        status: 'queued',
      } as WebhookQueueEntity)
      .mockResolvedValueOnce({
        id: 'row_b',
        idempotencyKey: eventB.idempotencyKey,
        webhookId: eventB.webhookId,
        payload: JSON.stringify(eventB),
        status: 'queued',
      } as WebhookQueueEntity)
      .mockResolvedValueOnce(null);
    dispatcherService.dispatchWebhook
      .mockRejectedValueOnce(new Error('validation failed'))
      .mockResolvedValueOnce(undefined);

    await service.enqueue(eventA);
    await flushProcessing();

    expect(queueRepository.update).toHaveBeenCalledWith('row_a', {
      status: 'failed',
      lastError: 'validation failed',
    });
    expect(queueRepository.delete).toHaveBeenCalledWith('row_b');
  });
});
