import { Test } from '@nestjs/testing';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { RunFeedbackService } from '../run-feedback.service';
import { ExecutorModule } from '../executor.module';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import { StoreModule } from '../../../store/store.module';
import { DispatcherConfigModule } from '../../../config/dispatcher-config.module';
import type { DispatcherConfig } from '../../../config/config';

jest.mock('@linear-agent/linear-client');

const MockedLinearGraphQLClient = LinearGraphQLClient as jest.MockedClass<
  typeof LinearGraphQLClient
>;

function makeConfig(apiKey?: string): DispatcherConfig {
  return {
    relay: { enabled: false },
    server: { port: 3000, globalPrefix: '' },
    executor: { claudeBinPath: 'claude', allowedEnvVars: [], timeout: 1_800_000 },
    database: { path: './data/dispatcher.db', synchronize: true, logging: false },
    linear: { apiKey },
    preflight: { skip: false },
  };
}

async function buildService(apiKey?: string): Promise<RunFeedbackService> {
  const module = await Test.createTestingModule({
    imports: [ExecutorModule, DispatcherConfigModule],
  })
    .overrideModule(StoreModule)
    .useModule(FakeStoreModule)
    .overrideProvider('DispatcherConfig')
    .useValue(makeConfig(apiKey))
    .compile();

  return module.get(RunFeedbackService);
}

function mockLinear() {
  const createActivity = jest.fn().mockResolvedValue({ id: 'activity_1' });
  const createComment = jest.fn().mockResolvedValue({ id: 'comment_1' });
  MockedLinearGraphQLClient.mockImplementation(
    () => ({ createActivity, createComment }) as unknown as LinearGraphQLClient,
  );
  return { createActivity, createComment };
}

describe('RunFeedbackService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts an agent-session activity when the target has a session', async () => {
    const { createActivity, createComment } = mockLinear();
    const service = await buildService('key_1');

    await service.needsInput(
      { issueId: 'issue_1', sessionId: 'session_1' },
      'missing domain label',
    );

    expect(createActivity).toHaveBeenCalledWith(
      'session_1',
      'elicitation',
      expect.stringContaining('missing domain label'),
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it('posts an issue comment when there is no session', async () => {
    const { createActivity, createComment } = mockLinear();
    const service = await buildService('key_1');

    await service.needsInput({ issueId: 'issue_1' }, 'multiple domain labels found');

    expect(createComment).toHaveBeenCalledWith(
      'issue_1',
      expect.stringContaining('multiple domain labels found'),
    );
    expect(createActivity).not.toHaveBeenCalled();
  });

  it.each([
    ['started', 'thought'],
    ['succeeded', 'response'],
    ['failed', 'error'],
    ['needsInput', 'elicitation'],
  ] as const)('%s maps to the "%s" activity type', async (method, activity) => {
    const { createActivity } = mockLinear();
    const service = await buildService('key_1');
    const target = { issueId: 'issue_1', sessionId: 'session_1' };

    if (method === 'started') {
      await service.started(target, { repoLabel: 'repo-a', skill: 'implement', runId: 'run_1' });
    } else {
      await service[method](target, 'text');
    }

    expect(createActivity).toHaveBeenCalledWith('session_1', activity, expect.any(String));
  });

  it('includes the issue identifier in a session start message only', async () => {
    const { createActivity, createComment } = mockLinear();
    const service = await buildService('key_1');
    const run = {
      repoLabel: 'repo-a',
      skill: 'implement',
      runId: 'run_1',
      issueIdentifier: 'DLA-1',
    };

    await service.started({ issueId: 'issue_1', sessionId: 'session_1' }, run);
    await service.started({ issueId: 'issue_1' }, run);

    expect(createActivity.mock.calls[0][2]).toContain('Issue: DLA-1');
    expect(createComment.mock.calls[0][1]).not.toContain('Issue: DLA-1');
    expect(createComment.mock.calls[0][1]).toContain('Run ID: `run_1`');
  });

  it('truncates a long failure message to the start', async () => {
    const { createComment } = mockLinear();
    const service = await buildService('key_1');

    await service.failed({ issueId: 'issue_1' }, 'x'.repeat(2000));

    const body = createComment.mock.calls[0][1] as string;
    expect(body.length).toBeLessThan(700);
    expect(body).toContain('…');
  });

  it('does nothing when the target has neither a session nor an issue', async () => {
    const { createActivity, createComment } = mockLinear();
    const service = await buildService('key_1');

    await service.succeeded({}, 'done');

    expect(createActivity).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it('silently skips posting when LINEAR_API_KEY is not configured', async () => {
    const service = await buildService(undefined);

    await expect(service.failed({ issueId: 'issue_1' }, 'boom')).resolves.toBeUndefined();
    expect(MockedLinearGraphQLClient).not.toHaveBeenCalled();
  });

  it('does not throw when the Linear API call fails', async () => {
    MockedLinearGraphQLClient.mockImplementation(
      () =>
        ({
          createActivity: jest.fn().mockRejectedValue(new Error('network down')),
          createComment: jest.fn().mockRejectedValue(new Error('network down')),
        }) as unknown as LinearGraphQLClient,
    );
    const service = await buildService('key_1');

    await expect(
      service.started(
        { issueId: 'issue_1', sessionId: 'session_1' },
        { repoLabel: 'r', skill: 's', runId: 'x' },
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.started({ issueId: 'issue_1' }, { repoLabel: 'r', skill: 's', runId: 'x' }),
    ).resolves.toBeUndefined();
  });
});
