import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RelayModule } from '../relay.module';
import { StoreModule } from '../../../store/store.module';
import { ProcessedWebhookEntity } from '../../../store/typeorm/processed-webhook.entity';
import { WebhookQueueEntity } from '../../../store/typeorm/webhook-queue.entity';
import { DispatcherConfigModule } from '../../../config/dispatcher-config.module';
import { RoutingConfigService } from '../../../config/routing-config.service';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import type { DispatcherConfig } from '../../../config/config';
import { makeDispatcherConfig } from '../../../test-utils/dispatcher-config';

/** DispatcherConfig for RelayModule tests: no Linear key, preflight skipped. */
export const makeRelayTestConfig = (overrides: Partial<DispatcherConfig> = {}): DispatcherConfig =>
  makeDispatcherConfig({ linear: {}, preflight: { skip: true }, ...overrides });

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
    .useValue(makeRelayTestConfig(configOverrides))
    .overrideProvider(RoutingConfigService)
    .useValue({ getAllRepositories: () => [] } as unknown as RoutingConfigService)
    .overrideProvider(getRepositoryToken(WebhookQueueEntity))
    .useValue({})
    .overrideProvider(getRepositoryToken(ProcessedWebhookEntity))
    .useValue({});
}
