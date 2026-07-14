import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StoreModule } from '../store/store.module';

@Module({
  imports: [StoreModule],
  controllers: [HealthController],
})
export class HealthModule {}
