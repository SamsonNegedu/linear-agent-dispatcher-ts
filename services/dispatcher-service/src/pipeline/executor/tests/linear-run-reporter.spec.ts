import { Test } from '@nestjs/testing';
import { AppTokenProvider, LinearGraphQLClient } from '@linear-agent/linear-client';
import { LinearRunReporter } from '../linear-run-reporter';
import { ExecutorModule } from '../executor.module';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import { StoreModule } from '../../../store/store.module';
import { DispatcherConfigModule } from '../../../config/dispatcher-config.module';
import type { DispatcherConfig } from '../../../config/config';
import { makeDispatcherConfig } from '../../../test-utils/dispatcher-config';

// Only the client class is mocked: chooseAppCredential and AppTokenProvider stay real.
jest.mock('@linear-agent/linear-client', () => ({
  ...jest.requireActual('@linear-agent/linear-client'),
  LinearGraphQLClient: jest.fn(),
}));

const MockedLinearGraphQLClient = LinearGraphQLClient as jest.MockedClass<
  typeof LinearGraphQLClient
>;

type LinearSettings = DispatcherConfig['linear'];

const makeConfig = (linear: LinearSettings): DispatcherConfig => makeDispatcherConfig({ linear });

async function buildService(
  apiKey?: string,
  agentToken?: string,
  oauth: Pick<LinearSettings, 'oauthClientId' | 'oauthClientSecret'> = {},
): Promise<LinearRunReporter> {
  const module = await Test.createTestingModule({
    imports: [ExecutorModule, DispatcherConfigModule],
  })
    .overrideModule(StoreModule)
    .useModule(FakeStoreModule)
    .overrideProvider('DispatcherConfig')
    .useValue(makeConfig({ apiKey, agentToken, ...oauth }))
    .compile();

  return module.get(LinearRunReporter);
}

function mockLinear() {
  const createActivity = jest.fn().mockResolvedValue({ id: 'activity_1' });
  const createComment = jest.fn().mockResolvedValue({ id: 'comment_1' });
  MockedLinearGraphQLClient.mockImplementation(
    () => ({ createActivity, createComment }) as unknown as LinearGraphQLClient,
  );
  return { createActivity, createComment };
}

describe('LinearRunReporter', () => {
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

  it('closes an agent session with a response when a run was skipped', async () => {
    const { createActivity, createComment } = mockLinear();
    const service = await buildService('key_1');

    await service.skipped({ issueId: 'issue_1', sessionId: 'session_1' }, 'already running');

    expect(createActivity).toHaveBeenCalledWith('session_1', 'response', 'already running');
    expect(createComment).not.toHaveBeenCalled();
  });

  it('posts a response to the session when a run is cancelled', async () => {
    const { createActivity } = mockLinear();
    const service = await buildService('key_1');

    await service.cancelled({ issueId: 'issue_1', sessionId: 'session_1' });

    expect(createActivity).toHaveBeenCalledWith(
      'session_1',
      'response',
      expect.stringContaining('cancelled'),
    );
  });

  it('posts nothing for a skipped run when there is no session', async () => {
    const { createActivity, createComment } = mockLinear();
    const service = await buildService('key_1');

    await service.skipped({ issueId: 'issue_1' }, 'already running');

    expect(createActivity).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it('posts session activity with the agent token and comments with the API key', async () => {
    const byKey: Record<string, { createActivity: jest.Mock; createComment: jest.Mock }> = {};
    MockedLinearGraphQLClient.mockImplementation((key) => {
      byKey[key as string] = {
        createActivity: jest.fn().mockResolvedValue({ id: 'activity_1' }),
        createComment: jest.fn().mockResolvedValue({ id: 'comment_1' }),
      };
      return byKey[key as string] as unknown as LinearGraphQLClient;
    });
    const service = await buildService('lin_api_personal', 'lin_oauth_app');

    await service.needsInput({ issueId: 'issue_1', sessionId: 'session_1' }, 'x');
    await service.needsInput({ issueId: 'issue_1' }, 'y');

    expect(byKey['lin_oauth_app'].createActivity).toHaveBeenCalledTimes(1);
    expect(byKey['lin_oauth_app'].createComment).not.toHaveBeenCalled();
    expect(byKey['lin_api_personal'].createComment).toHaveBeenCalledTimes(1);
    expect(byKey['lin_api_personal'].createActivity).not.toHaveBeenCalled();
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
  it('posts session activity with the app token it mints itself when client credentials are set', async () => {
    const credentials: unknown[] = [];
    MockedLinearGraphQLClient.mockImplementation((credential) => {
      credentials.push(credential);
      return {} as unknown as LinearGraphQLClient;
    });

    // A stale fixed agent token is ignored: the minted token is always current.
    await buildService('lin_api_personal', 'lin_oauth_stale', {
      oauthClientId: 'client_id',
      oauthClientSecret: 'client_secret',
    });

    const [activity, comment] = credentials;
    expect(activity).toBeInstanceOf(AppTokenProvider);
    expect(comment).toBe('lin_api_personal');
  });

  it('comments as the app when there is no API key and client credentials are set', async () => {
    const credentials: unknown[] = [];
    MockedLinearGraphQLClient.mockImplementation((credential) => {
      credentials.push(credential);
      return {} as unknown as LinearGraphQLClient;
    });

    await buildService(undefined, undefined, {
      oauthClientId: 'client_id',
      oauthClientSecret: 'client_secret',
    });

    expect(credentials[0]).toBeInstanceOf(AppTokenProvider);
    expect(credentials[1]).toBeInstanceOf(AppTokenProvider);
  });
});
