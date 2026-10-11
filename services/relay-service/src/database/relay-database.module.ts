import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type { RelayServiceConfig } from '../config/relay-config';
import { RELAY_DATABASE, RelayDatabase, openRelayDatabase } from './relay-database';

@Module({
  providers: [
    {
      provide: RELAY_DATABASE,
      useFactory: (config: RelayServiceConfig) => openRelayDatabase(config.database.path),
      inject: ['RelayServiceConfig'],
    },
  ],
  exports: [RELAY_DATABASE],
})
export class RelayDatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(RELAY_DATABASE) private readonly db: RelayDatabase) {}

  onApplicationShutdown(): void {
    this.db.close();
  }
}
