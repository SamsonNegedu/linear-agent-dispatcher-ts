import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { StoreModule } from '../../store/store.module';
import { RoutingConfigService } from '../../config/routing-config.service';

@Module({
  imports: [StoreModule],
  controllers: [MonitorController],
  providers: [RoutingConfigService, MonitorService],
})
export class MonitorModule {}
