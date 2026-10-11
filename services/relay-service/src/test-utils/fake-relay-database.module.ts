import { Module } from '@nestjs/common';
import { RELAY_DATABASE } from '../database/relay-database';

/**
 * Substitutes RelayDatabaseModule in tests via `overrideModule`, so compiling a module never
 * opens a real SQLite file. Repository constructors only store the handle, and tests then swap
 * the repository token (e.g. SUBSCRIBER_REGISTRY_REPOSITORY) with `.overrideProvider(...)`.
 */
@Module({
  providers: [{ provide: RELAY_DATABASE, useValue: {} }],
  exports: [RELAY_DATABASE],
})
export class FakeRelayDatabaseModule {}
