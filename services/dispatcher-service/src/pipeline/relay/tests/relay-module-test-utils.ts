import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RelayModule } from '../relay.module';
import { StoreModule } from '../../../store/store.module';
import { WebhookQueueEntity } from '../../../store/typeorm/webhook-queue.entity';
import { DispatcherConfigModule } from '../../../config/dispatcher-config.module';
import { RoutingConfigService } from '../../../config/routing-config.service';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import type { DispatcherConfig } from '../../../config/config';

export function makeDispatcherConfig(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
  return {
    relay: { enabled: false },
    server: { port: 3000, globalPrefix: '' },
    executor: { claudeBinPath: 'claude', allowedEnvVars: [], timeout: 1_800_000 },
    database: { path: './data/dispatcher.db', synchronize: true, logging: false },
    linear: {},
    preflight: { skip: true },
    ...overrides,
  };
}

/**
 * RelayModule (dispatcher's pipeline/relay) eagerly wires in PreflightModule,
 * StoreModule, and ExecutorModule alongside its own providers — every one of
 * those providers gets constructed on compile() regardless of which service
 * a given test cares about. This sets up the baseline overrides every
 * RelayModule-based test needs so nothing tries a real DB connection or a
 * real routing.config.json read.
 */
export function baseRelayModuleTestBuilder(
  configOverrides: Partial<DispatcherConfig> = {},
): TestingModuleBuilder {
  return Test.createTestingModule({ imports: [RelayModule, DispatcherConfigModule] })
    .overrideModule(StoreModule)
    .useModule(FakeStoreModule)
    .overrideProvider('DispatcherConfig')
    .useValue(makeDispatcherConfig(configOverrides))
    .overrideProvider(RoutingConfigService)
    .useValue({ getAllRepositories: () => [] } as unknown as RoutingConfigService)
    .overrideProvider(getRepositoryToken(WebhookQueueEntity))
    .useValue({});
}
