import { Test } from '@nestjs/testing';
import { ExecutorService } from '../executor.service';
import { ExecutorModule } from '../executor.module';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import { StoreModule } from '../../../store/store.module';
import { ClaudeAgentService } from '../claude-agent.service';
import { McpServerDiscoveryService } from '../mcp-server-discovery.service';
import { ActivityNotifierService } from '../activity-notifier.service';
import { IssueCommentService } from '../issue-comment.service';
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
  let activityNotifier: jest.Mocked<ActivityNotifierService>;
  let issueComments: jest.Mocked<IssueCommentService>;
  let service: ExecutorService;

  beforeEach(async () => {
    store = {
      getRun: jest.fn(),
      markRunning: jest.fn().mockResolvedValue(undefined),
      completeRun: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IStoreRepository>;
    claudeAgent = { spawn: jest.fn() } as unknown as jest.Mocked<ClaudeAgentService>;
    activityNotifier = {
      postStart: jest.fn().mockResolvedValue(undefined),
      postSuccess: jest.fn().mockResolvedValue(undefined),
      postError: jest.fn().mockResolvedValue(undefined),
      postElicitation: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ActivityNotifierService>;
    issueComments = {
      postProgress: jest.fn().mockResolvedValue(undefined),
      postSuccess: jest.fn().mockResolvedValue(undefined),
      postFailure: jest.fn().mockResolvedValue(undefined),
      postRequired: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IssueCommentService>;

    const module = await Test.createTestingModule({ imports: [ExecutorModule] })
      .overrideModule(StoreModule)
      .useModule(FakeStoreModule)
      .overrideProvider('IStoreRepository')
      .useValue(store)
      .overrideProvider(ClaudeAgentService)
      .useValue(claudeAgent)
      .overrideProvider(McpServerDiscoveryService)
      .useValue({ allowRules: jest.fn().mockResolvedValue([]) })
      .overrideProvider(ActivityNotifierService)
      .useValue(activityNotifier)
      .overrideProvider(IssueCommentService)
      .useValue(issueComments)
      .compile();

    service = module.get(ExecutorService);
  });

  it('does nothing when the run no longer exists', async () => {
    store.getRun.mockResolvedValue(null);

    await service.executeRun('run_missing', makeEvent());

    expect(store.markRunning).not.toHaveBeenCalled();
  });

  it('posts session activities and completes the run on success (agent session run)', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: 'session_1' }));
    claudeAgent.spawn.mockResolvedValue({ status: 'succeeded', sessionId: 'claude_session_1' });

    await service.executeRun('run_1', makeEvent());

    expect(store.markRunning).toHaveBeenCalledWith('run_1');
    expect(activityNotifier.postStart).toHaveBeenCalledWith(
      'session_1',
      'ISSUE-1',
      'repo-a',
      'implement',
      'run_1',
    );
    expect(activityNotifier.postSuccess).toHaveBeenCalled();
    expect(issueComments.postSuccess).not.toHaveBeenCalled();
    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'succeeded', claudeSessionId: 'claude_session_1' }),
    );
  });

  it('posts issue comments and completes the run on success (non-session run)', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: undefined }));
    claudeAgent.spawn.mockResolvedValue({ status: 'succeeded' });

    await service.executeRun('run_1', makeEvent());

    expect(issueComments.postProgress).toHaveBeenCalledWith(
      'issue_1',
      'repo-a',
      'implement',
      'run_1',
    );
    expect(issueComments.postSuccess).toHaveBeenCalled();
    expect(activityNotifier.postStart).not.toHaveBeenCalled();
  });

  it('completes the run as needs_input and posts the question as an elicitation (agent session run)', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: 'session_1' }));
    claudeAgent.spawn.mockResolvedValue({
      status: 'needs_input',
      exitCode: 0,
      resultText: 'Stop rule: the issue conflicts with an RFC. Recommend option A.',
      errorSnippet: 'Stop rule: the issue conflicts with an RFC. Recommend option A.',
    });

    await service.executeRun('run_1', makeEvent());

    expect(activityNotifier.postElicitation).toHaveBeenCalledWith(
      'session_1',
      'Stop rule: the issue conflicts with an RFC. Recommend option A.',
    );
    expect(activityNotifier.postSuccess).not.toHaveBeenCalled();
    expect(activityNotifier.postError).not.toHaveBeenCalled();
    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'needs_input' }),
    );
  });

  it('posts the question as an action-required comment for a non-session run', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: undefined }));
    claudeAgent.spawn.mockResolvedValue({
      status: 'needs_input',
      exitCode: 0,
      resultText: 'Stop rule: which design token?',
    });

    await service.executeRun('run_1', makeEvent());

    expect(issueComments.postRequired).toHaveBeenCalledWith(
      'issue_1',
      'Stop rule: which design token?',
    );
    expect(issueComments.postSuccess).not.toHaveBeenCalled();
    expect(issueComments.postFailure).not.toHaveBeenCalled();
  });

  it('posts a failure activity and completes the run as failed when the agent run fails', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: 'session_1' }));
    claudeAgent.spawn.mockResolvedValue({ status: 'failed', exitCode: 1, errorSnippet: 'boom' });

    await service.executeRun('run_1', makeEvent());

    expect(activityNotifier.postError).toHaveBeenCalledWith('session_1', 'boom');
    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'failed', errorSnippet: 'boom' }),
    );
  });

  it('marks the run failed and posts feedback when spawning the agent throws unexpectedly', async () => {
    store.getRun.mockResolvedValue(makeRun({ providerSessionId: undefined }));
    claudeAgent.spawn.mockRejectedValue(new Error('spawn ENOENT'));

    await service.executeRun('run_1', makeEvent());

    expect(store.completeRun).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ status: 'failed', errorSnippet: 'spawn ENOENT' }),
    );
    expect(issueComments.postFailure).toHaveBeenCalledWith('issue_1', 'spawn ENOENT');
  });
});
