import { Module } from '@nestjs/common';
import { STORE_REPOSITORY } from '../store/store.interfaces';

/**
 * Substitutes StoreModule in tests via `overrideModule` — StoreModule's real
 * form calls TypeOrmModule.forRootAsync(...), which opens an actual
 * better-sqlite3 connection on compile. This provides the same
 * STORE_REPOSITORY token with no backing connection, so importing modules
 * still resolve, and tests then swap in a jest mock via
 * `.overrideProvider(STORE_REPOSITORY).useValue(...)`.
 */
@Module({
  providers: [{ provide: STORE_REPOSITORY, useValue: {} }],
  exports: [STORE_REPOSITORY],
})
export class FakeStoreModule {}
