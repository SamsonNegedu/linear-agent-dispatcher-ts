import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RunEntity } from './typeorm/run.entity';
import { ProcessedWebhookEntity } from './typeorm/processed-webhook.entity';
import { WebhookQueueEntity } from './typeorm/webhook-queue.entity';
import { TypeORMStoreRepository } from './typeorm/typeorm-store.repository';
import type { DispatcherConfig } from '../config/config';

const storeProvider: Provider = {
  provide: 'IStoreRepository',
  useFactory: (dataSource: DataSource) => new TypeORMStoreRepository(dataSource),
  inject: [getDataSourceToken()],
};

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: ['DispatcherConfig'],
      useFactory: (config: DispatcherConfig) => ({
        type: 'better-sqlite3',
        database: config.database.path,
        entities: [RunEntity, ProcessedWebhookEntity, WebhookQueueEntity],
        synchronize: config.database.synchronize,
        logging: config.database.logging,
      }),
    }),
    TypeOrmModule.forFeature([RunEntity, ProcessedWebhookEntity, WebhookQueueEntity]),
  ],
  providers: [storeProvider],
  exports: [storeProvider],
})
export class StoreModule {}
