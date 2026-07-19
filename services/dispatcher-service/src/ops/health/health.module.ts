import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StoreModule } from '../../store/store.module';
import { RelayModule } from '../../pipeline/relay/relay.module';

@Module({
  imports: [StoreModule, RelayModule],
  controllers: [HealthController],
})
export class HealthModule {}
