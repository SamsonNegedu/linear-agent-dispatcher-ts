import { Test } from '@nestjs/testing';
import { LinearGraphQLClient } from '@linear-agent/linear-client';
import { ActivityNotifierService } from '../activity-notifier.service';
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

async function buildService(apiKey?: string): Promise<ActivityNotifierService> {
  const module = await Test.createTestingModule({ imports: [ExecutorModule, DispatcherConfigModule] })
    .overrideModule(StoreModule)
    .useModule(FakeStoreModule)
    .overrideProvider('DispatcherConfig')
    .useValue(makeConfig(apiKey))
    .compile();

  return module.get(ActivityNotifierService);
}

describe('ActivityNotifierService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts an elicitation activity through the Linear client when a session and API key are present', async () => {
    const createActivity = jest.fn().mockResolvedValue({ id: 'activity_1' });
    MockedLinearGraphQLClient.mockImplementation(
      () => ({ createActivity }) as unknown as LinearGraphQLClient,
    );

    const service = await buildService('key_1');
    await service.postElicitation('session_1', 'missing domain label');

    expect(createActivity).toHaveBeenCalledWith('session_1', 'elicitation', expect.stringContaining('missing domain label'));
  });

  it('silently skips posting when no sessionId is provided', async () => {
    const createActivity = jest.fn();
    MockedLinearGraphQLClient.mockImplementation(
      () => ({ createActivity }) as unknown as LinearGraphQLClient,
    );

    const service = await buildService('key_1');
    await service.postSuccess(undefined as unknown as string, 'done');

    expect(createActivity).not.toHaveBeenCalled();
  });

  it('silently skips posting when LINEAR_API_KEY is not configured', async () => {
    const service = await buildService(undefined);

    await expect(service.postError('session_1', 'boom')).resolves.toBeUndefined();
    expect(MockedLinearGraphQLClient).not.toHaveBeenCalled();
  });

  it('does not throw when the Linear API call fails', async () => {
    const createActivity = jest.fn().mockRejectedValue(new Error('network down'));
    MockedLinearGraphQLClient.mockImplementation(
      () => ({ createActivity }) as unknown as LinearGraphQLClient,
    );

    const service = await buildService('key_1');

    await expect(service.postStart('session_1', 'ISSUE-1', 'repo-a', 'implement', 'run_1')).resolves.toBeUndefined();
  });
});
