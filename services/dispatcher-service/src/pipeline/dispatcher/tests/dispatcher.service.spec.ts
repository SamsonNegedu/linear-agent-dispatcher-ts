import { AdapterRegistry, IncompleteLabelsError, ValidationError } from '@webhook-verify/core';
import type { DispatchAdapter, NormalizedEvent } from '@webhook-verify/core';
import { DispatcherService } from '../dispatcher.service';
import { ExecutorService } from '../../executor/executor.service';
import type { IStoreRepository } from '../../../store/store.interfaces';
import type { IIssueContextResolver } from '../issue-context-resolver.interface';
import { DuplicatePayloadError, ActiveRunError } from '../../../store/store.errors';
import { baseRelayModuleTestBuilder } from '../../relay/tests/relay-module-test-utils';

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
    routingTags: ['repo-a', 'agent-implement'],
    isTerminal: false,
    action: 'update',
    changedFields: ['labelIds'],
    rawPayload: {},
    ...overrides,
  };
}

describe('DispatcherService.dispatchWebhook', () => {
  let store: jest.Mocked<IStoreRepository>;
  let executorService: jest.Mocked<ExecutorService>;
  let dispatchAdapter: jest.Mocked<DispatchAdapter>;
  let issueContextResolver: jest.Mocked<IIssueContextResolver>;
  let service: DispatcherService;

  beforeEach(async () => {
    store = {
      enqueueRun: jest.fn(),
      getRun: jest.fn(),
      getLatestRunWithSession: jest.fn(),
      getLatestRunWithSessionForAgent: jest.fn(),
      listRuns: jest.fn(),
      listRunsByStatus: jest.fn(),
      hasActiveRun: jest.fn(),
      markRunning: jest.fn(),
      completeRun: jest.fn(),
      reconcileStaleRuns: jest.fn(),
      ping: jest.fn(),
      getRunStats: jest.fn(),
    };
    executorService = {
      executeRun: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ExecutorService>;
    dispatchAdapter = {
      provider: 'linear',
      shouldDispatch: jest.fn(),
      resolveRouting: jest.fn(),
      postFeedback: jest.fn(),
    };
    issueContextResolver = {
      resolveIssueContext: jest.fn(),
    };

    const dispatchAdapterRegistry = new AdapterRegistry<DispatchAdapter>();
    dispatchAdapterRegistry.register(dispatchAdapter);

    const module = await baseRelayModuleTestBuilder()
      .overrideProvider('IStoreRepository')
      .useValue(store)
      .overrideProvider(ExecutorService)
      .useValue(executorService)
      .overrideProvider('DispatchAdapterRegistry')
      .useValue(dispatchAdapterRegistry)
      .overrideProvider('IIssueContextResolver')
      .useValue(issueContextResolver)
      .compile();

    service = module.get(DispatcherService);
  });

  it('does not enqueue a run when the adapter declines to dispatch', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: false,
      reason: 'update changed no issue fields',
    });

    await service.dispatchWebhook(makeEvent());

    expect(store.enqueueRun).not.toHaveBeenCalled();
    expect(executorService.executeRun).not.toHaveBeenCalled();
  });

  it('enqueues a run and executes it when the adapter approves dispatch', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: true,
      reason: 'issue created',
    });
    issueContextResolver.resolveIssueContext.mockResolvedValue({
      labels: ['repo-a', 'agent-implement'],
      identifier: 'ISSUE-1',
    });
    dispatchAdapter.resolveRouting.mockReturnValue({
      repoLabel: 'repo-a',
      repoPath: '/repos/repo-a',
      skill: 'implement',
      dedupeWindowMs: 60_000,
    });
    store.enqueueRun.mockResolvedValue({
      id: 'run_1',
      provider: 'linear',
      issueId: 'issue_1',
      issueIdentifier: 'ISSUE-1',
      webhookId: 'wh_1',
      domainLabel: 'repo-a',
      repoPath: '/repos/repo-a',
      skill: 'implement',
      status: 'pending',
      startedAt: new Date(),
      triggerSource: 'webhook',
    });

    const event = makeEvent({ action: 'create', changedFields: undefined });
    await service.dispatchWebhook(event);

    expect(store.enqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'issue_1',
        issueIdentifier: 'ISSUE-1',
        domainLabel: 'repo-a',
        repoPath: '/repos/repo-a',
        skill: 'implement',
        dedupeWindowMs: 60_000,
      }),
    );
    expect(executorService.executeRun).toHaveBeenCalledWith('run_1', event);
  });

  it('silently skips when routing is incomplete (labels not yet set)', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: true,
      reason: 'issue created',
    });
    issueContextResolver.resolveIssueContext.mockResolvedValue({ labels: [] });
    dispatchAdapter.resolveRouting.mockImplementation(() => {
      throw new IncompleteLabelsError('missing domain label');
    });

    await expect(service.dispatchWebhook(makeEvent())).resolves.toBeUndefined();

    expect(store.enqueueRun).not.toHaveBeenCalled();
    expect(dispatchAdapter.postFeedback).not.toHaveBeenCalled();
  });

  it('posts feedback and rethrows on a validation error (e.g. conflicting labels)', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: true,
      reason: 'issue created',
    });
    issueContextResolver.resolveIssueContext.mockResolvedValue({ labels: ['repo-a', 'repo-b'] });
    dispatchAdapter.resolveRouting.mockImplementation(() => {
      throw new ValidationError('multiple domain labels found');
    });

    const event = makeEvent();
    await expect(service.dispatchWebhook(event)).rejects.toThrow(ValidationError);

    expect(store.enqueueRun).not.toHaveBeenCalled();
    expect(dispatchAdapter.postFeedback).toHaveBeenCalledWith(
      event,
      'multiple domain labels found',
    );
  });

  it('rethrows a duplicate payload error without posting feedback (already processed)', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: true,
      reason: 'issue created',
    });
    issueContextResolver.resolveIssueContext.mockResolvedValue({
      labels: ['repo-a', 'agent-implement'],
    });
    dispatchAdapter.resolveRouting.mockReturnValue({
      repoLabel: 'repo-a',
      repoPath: '/repos/repo-a',
      skill: 'implement',
      dedupeWindowMs: 60_000,
    });
    store.enqueueRun.mockRejectedValue(new DuplicatePayloadError('issue:ISSUE-1:update:1'));

    await expect(service.dispatchWebhook(makeEvent())).rejects.toThrow(DuplicatePayloadError);

    expect(dispatchAdapter.postFeedback).not.toHaveBeenCalled();
  });

  it('rethrows without posting feedback when the store rejects the run as an active-run conflict', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: true,
      reason: 'issue created',
    });
    issueContextResolver.resolveIssueContext.mockResolvedValue({
      labels: ['repo-a', 'agent-implement'],
    });
    dispatchAdapter.resolveRouting.mockReturnValue({
      repoLabel: 'repo-a',
      repoPath: '/repos/repo-a',
      skill: 'implement',
      dedupeWindowMs: 60_000,
    });
    store.enqueueRun.mockRejectedValue(new ActiveRunError('issue_1'));

    const event = makeEvent();
    await expect(service.dispatchWebhook(event)).rejects.toThrow(ActiveRunError);

    expect(dispatchAdapter.postFeedback).not.toHaveBeenCalled();
  });

  it('posts feedback and rethrows on an unexpected error', async () => {
    dispatchAdapter.shouldDispatch.mockReturnValue({
      shouldDispatch: true,
      reason: 'issue created',
    });
    issueContextResolver.resolveIssueContext.mockRejectedValue(new Error('GraphQL request failed'));

    const event = makeEvent();
    await expect(service.dispatchWebhook(event)).rejects.toThrow('GraphQL request failed');

    expect(store.enqueueRun).not.toHaveBeenCalled();
    expect(dispatchAdapter.postFeedback).toHaveBeenCalledWith(event, 'GraphQL request failed');
  });
});
