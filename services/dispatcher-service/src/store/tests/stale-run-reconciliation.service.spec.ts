import { StaleRunReconciliationService } from '../stale-run-reconciliation.service';
import type { IStoreRepository } from '../store.interfaces';
import type { DispatcherConfig } from '../../config/config';

function makeConfig(): DispatcherConfig {
  return {
    relay: { enabled: false },
    server: { port: 3000, globalPrefix: '' },
    executor: { claudeBinPath: 'claude', allowedEnvVars: [], timeout: 1_800_000 },
    database: { path: './data/dispatcher.db', synchronize: true, logging: false },
    linear: {},
    preflight: { skip: false },
  };
}

describe('StaleRunReconciliationService', () => {
  let store: jest.Mocked<IStoreRepository>;
  let service: StaleRunReconciliationService;

  beforeEach(() => {
    jest.useFakeTimers();
    store = {
      reconcileStaleRuns: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IStoreRepository>;
    service = new StaleRunReconciliationService(store, makeConfig());
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('sweeps for stale runs immediately using the configured executor timeout as the threshold', async () => {
    await service.onModuleInit();

    expect(store.reconcileStaleRuns).toHaveBeenCalledWith(1_800_000);
    expect(store.reconcileStaleRuns).toHaveBeenCalledTimes(1);
  });

  it('sweeps again periodically while the module stays alive', async () => {
    await service.onModuleInit();

    jest.advanceTimersByTime(5 * 60 * 1000);
    await Promise.resolve();

    expect(store.reconcileStaleRuns).toHaveBeenCalledTimes(2);
  });

  it('stops sweeping once the module is destroyed', async () => {
    await service.onModuleInit();
    service.onModuleDestroy();

    jest.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();

    expect(store.reconcileStaleRuns).toHaveBeenCalledTimes(1);
  });
});
