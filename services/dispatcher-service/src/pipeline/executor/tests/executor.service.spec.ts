import { Test } from '@nestjs/testing';
import { ExecutorService } from '../executor.service';
import { ExecutorModule } from '../executor.module';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import { StoreModule } from '../../../store/store.module';
import { ClaudeAgentService } from '../claude-agent.service';
import { McpServerDiscoveryService } from '../mcp-server-discovery.service';
import { RunFeedbackService } from '../run-feedback.service';
import type { IStoreRepository, Run } from '../../../store/store.interfaces';
import type { NormalizedEvent } from '@webhook-verify/core';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
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
    ...overrides,
  };
}

function makeEvent(): NormalizedEvent {
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
  };
}

describe('ExecutorService.executeRun', () => {
  let store: jest.Mocked<IStoreRepository>;
  let claudeAgent: jest.Mocked<ClaudeAgentService>;
  let feedback: jest.Mocked<RunFeedbackService>;
  let service: ExecutorService;

  beforeEach(async () => {
    store = {
      getRun: jest.fn(),
      markRunning: jest.fn().mockResolvedValue(undefined),
      completeRun: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IStoreRepository>;
    claudeAgent = {
      spawn: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<ClaudeAgentService>;
    feedback = {
      started: jest.fn().mockResolvedValue(undefined),
      succeeded: jest.fn().mockResolvedValue(undefined),
      failed: jest.fn().mockResolvedValue(undefined),
      needsInput: jest.fn().mockResolvedValue(undefined),
      cancelled: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RunFeedbackService>;

    const module = await Test.createTestingModule({ imports: [ExecutorModule] })
      .overrideModule(StoreModule)
      .useModule(FakeStoreModule)
      .overrideProvider('IStoreRepository')
      .useValue(store)
      .overrideProvider(ClaudeAgentService)
      .useValue(claudeAgent)
      .overrideProvider(McpServerDiscoveryService)
      .useValue({ allowRules: jest.fn().mockResolvedValue([]) })
      .overrideProvider(RunFeedbackService)
      .useValue(feedback)
      .compile();

    service = module.get(ExecutorService);
  });

  it('does nothing when the run no longer exists', async () => {
    store.getRun.mockResolvedValue(null);

    await service.executeRun('run_missing', makeEvent());

    expect(store.markRunning).not.toHaveBeenCalled();
  });

  const sessionTarget = { issueId: 'issue_1', sessionId: 'session_1' };
  const issueTarget = { issueId: 'issue_1', sessionId: undefined };

  it('reports start and success to the session and completes the run (agent session run)', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: 'session_1' }));
    claudeAgent.spawn.mockResolvedValue({ status: 'succeeded', sessionId: 'claude_session_1' });

    await service.executeRun('run_1', makeEvent());

    expect(store.markRunning).toHaveBeenCalledWith('run_1');
    expect(feedback.started).toHaveBeenCalledWith(sessionTarget, {
      repoLabel: 'repo-a',
      skill: 'implement',
      runId: 'run_1',
      issueIdentifier: 'ISSUE-1',
    });
    expect(feedback.succeeded).toHaveBeenCalledWith(sessionTarget, expect.any(String));
    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'succeeded', claudeSessionId: 'claude_session_1' }),
    );
  });

  it('targets the issue when the run has no agent session', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: undefined }));
    claudeAgent.spawn.mockResolvedValue({ status: 'succeeded' });

    await service.executeRun('run_1', makeEvent());

    expect(feedback.started).toHaveBeenCalledWith(issueTarget, expect.anything());
    expect(feedback.succeeded).toHaveBeenCalledWith(issueTarget, expect.any(String));
  });

  it('completes the run as needs_input and posts the question', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: 'session_1' }));
    const question = 'Stop rule: the issue conflicts with an RFC. Recommend option A.';
    claudeAgent.spawn.mockResolvedValue({
      status: 'needs_input',
      exitCode: 0,
      resultText: question,
      errorSnippet: question,
    });

    await service.executeRun('run_1', makeEvent());

    expect(feedback.needsInput).toHaveBeenCalledWith(sessionTarget, question);
    expect(feedback.succeeded).not.toHaveBeenCalled();
    expect(feedback.failed).not.toHaveBeenCalled();
    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'needs_input' }),
    );
  });

  it('reports a failed agent run and completes the run as failed', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: 'session_1' }));
    claudeAgent.spawn.mockResolvedValue({ status: 'failed', exitCode: 1, errorSnippet: 'boom' });

    await service.executeRun('run_1', makeEvent());

    expect(feedback.failed).toHaveBeenCalledWith(sessionTarget, 'boom');
    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'failed', errorSnippet: 'boom' }),
    );
  });

  it('marks the run failed and reports it when spawning the agent throws unexpectedly', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: undefined }));
    claudeAgent.spawn.mockRejectedValue(new Error('spawn ENOENT'));

    await service.executeRun('run_1', makeEvent());

    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'failed', errorSnippet: 'spawn ENOENT' }),
    );
    expect(feedback.failed).toHaveBeenCalledWith(issueTarget, 'spawn ENOENT');
  });
});

describe('ExecutorService cancellation', () => {
  let store: jest.Mocked<IStoreRepository>;
  let claudeAgent: jest.Mocked<ClaudeAgentService>;
  let feedback: jest.Mocked<RunFeedbackService>;
  let service: ExecutorService;

  beforeEach(async () => {
    store = {
      getRun: jest.fn(),
      markRunning: jest.fn().mockResolvedValue(undefined),
      completeRun: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IStoreRepository>;
    claudeAgent = {
      spawn: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<ClaudeAgentService>;
    feedback = {
      started: jest.fn(),
      cancelled: jest.fn(),
    } as unknown as jest.Mocked<RunFeedbackService>;

    const module = await Test.createTestingModule({ imports: [ExecutorModule] })
      .overrideModule(StoreModule)
      .useModule(FakeStoreModule)
      .overrideProvider('IStoreRepository')
      .useValue(store)
      .overrideProvider(ClaudeAgentService)
      .useValue(claudeAgent)
      .overrideProvider(McpServerDiscoveryService)
      .useValue({ allowRules: jest.fn().mockResolvedValue([]) })
      .overrideProvider(RunFeedbackService)
      .useValue(feedback)
      .compile();
    service = module.get(ExecutorService);
  });

  it('cancelRun stops a running run', async () => {
    store.getRun.mockResolvedValue(makeRun({ status: 'running' }));
    claudeAgent.cancel.mockReturnValue(true);

    await expect(service.cancelRun('run_1')).resolves.toBe('cancelling');
    expect(claudeAgent.cancel).toHaveBeenCalledWith('run_1');
  });

  it('cancelRun reports not_found for an unknown run', async () => {
    store.getRun.mockResolvedValue(null);

    await expect(service.cancelRun('nope')).resolves.toBe('not_found');
  });

  it('cancelRun reports not_running for a finished run or one with no live process', async () => {
    store.getRun.mockResolvedValue(makeRun({ status: 'succeeded' }));
    await expect(service.cancelRun('run_1')).resolves.toBe('not_running');

    store.getRun.mockResolvedValue(makeRun({ status: 'running' }));
    claudeAgent.cancel.mockReturnValue(false);
    await expect(service.cancelRun('run_1')).resolves.toBe('not_running');
  });

  it('executeRun records a cancelled result and tells the user, without a failure message', async () => {
    store.getRun.mockResolvedValue(makeRun());
    claudeAgent.spawn.mockResolvedValue({ status: 'cancelled', exitCode: undefined });

    await service.executeRun('run_1', makeEvent());

    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(feedback.cancelled).toHaveBeenCalled();
  });
});
