import { Module } from '@nestjs/common';

/**
 * Substitutes StoreModule in tests via `overrideModule` — StoreModule's real
 * form calls TypeOrmModule.forRootAsync(...), which opens an actual
 * better-sqlite3 connection on compile. This provides the same
 * 'IStoreRepository' token with no backing connection, so importing modules
 * still resolve, and tests then swap in a jest mock via
 * `.overrideProvider('IStoreRepository').useValue(...)`.
 */
@Module({
  providers: [{ provide: 'IStoreRepository', useValue: {} }],
  exports: ['IStoreRepository'],
})
export class FakeStoreModule {}
