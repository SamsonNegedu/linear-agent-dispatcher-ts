import { Test } from '@nestjs/testing';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { IssueCommentService } from '../issue-comment.service';
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

async function buildService(apiKey?: string): Promise<IssueCommentService> {
  const module = await Test.createTestingModule({ imports: [ExecutorModule, DispatcherConfigModule] })
    .overrideModule(StoreModule)
    .useModule(FakeStoreModule)
    .overrideProvider('DispatcherConfig')
    .useValue(makeConfig(apiKey))
    .compile();

  return module.get(IssueCommentService);
}

describe('IssueCommentService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts a required-action comment through the Linear client when an API key is present', async () => {
    const createComment = jest.fn().mockResolvedValue({ id: 'comment_1' });
    MockedLinearGraphQLClient.mockImplementation(
      () => ({ createComment }) as unknown as LinearGraphQLClient,
    );

    const service = await buildService('key_1');
    await service.postRequired('issue_1', 'multiple domain labels found');

    expect(createComment).toHaveBeenCalledWith(
      'issue_1',
      expect.stringContaining('multiple domain labels found'),
    );
  });

  it('silently skips posting when LINEAR_API_KEY is not configured', async () => {
    const service = await buildService(undefined);

    await expect(service.postFailure('issue_1', 'boom')).resolves.toBeUndefined();
    expect(MockedLinearGraphQLClient).not.toHaveBeenCalled();
  });

  it('does not throw when the Linear API call fails', async () => {
    const createComment = jest.fn().mockRejectedValue(new Error('network down'));
    MockedLinearGraphQLClient.mockImplementation(
      () => ({ createComment }) as unknown as LinearGraphQLClient,
    );

    const service = await buildService('key_1');

    await expect(
      service.postProgress('issue_1', 'repo-a', 'implement', 'run_1'),
    ).resolves.toBeUndefined();
  });
});
