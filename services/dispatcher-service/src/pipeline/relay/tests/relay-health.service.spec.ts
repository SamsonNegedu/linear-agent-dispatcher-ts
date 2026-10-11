import { RelayHealthService } from '../relay-health.service';
import { baseRelayModuleTestBuilder } from './relay-module-test-utils';
import type { DispatcherConfig } from '../../../config/config';

async function buildService(overrides: Partial<DispatcherConfig['relay']> = {}): Promise<RelayHealthService> {
  const module = await baseRelayModuleTestBuilder({
    relay: {
      enabled: true,
      subscriberSecret: 'secret_1',
      url: 'https://relay.example.com',
      subscriberId: 'sub_1',
      ...overrides,
    },
  }).compile();

  return module.get(RelayHealthService);
}

describe('RelayHealthService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when relay is not enabled', async () => {
    const service = await buildService({ enabled: false });

    await service.onModuleInit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual({ result: null, lastCheckedAt: null, error: null });
    service.onModuleDestroy();
  });

  it('reports verified when relay-service confirms the subscriber exists', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const service = await buildService();

    await service.onModuleInit();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.example.com/subscribers/sub_1',
      expect.anything(),
    );
    expect(service.getStatus().result).toBe('verified');
    service.onModuleDestroy();
  });

  it('reports not_found when relay-service returns 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const service = await buildService();

    await service.onModuleInit();

    expect(service.getStatus().result).toBe('not_found');
    service.onModuleDestroy();
  });

  it('reports unreachable when the fetch call itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    const service = await buildService();

    await service.onModuleInit();

    expect(service.getStatus()).toEqual(
      expect.objectContaining({ result: 'unreachable', error: 'network error' }),
    );
    service.onModuleDestroy();
  });

  it('dedupes concurrent on-demand refreshes into a single relay-service call', async () => {
    let resolveFetch!: (value: { ok: boolean; status: number }) => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const service = await buildService();

    const refresh1 = service.refresh();
    const refresh2 = service.refresh();
    resolveFetch({ ok: true, status: 200 });
    await Promise.all([refresh1, refresh2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
