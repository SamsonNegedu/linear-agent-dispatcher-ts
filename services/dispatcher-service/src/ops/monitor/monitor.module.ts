import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { StoreModule } from '../../store/store.module';
import { ExecutorModule } from '../../pipeline/executor/executor.module';
import { RelayModule } from '../../pipeline/relay/relay.module';
import { RoutingConfigService } from '../../config/routing-config.service';

@Module({
  imports: [StoreModule, ExecutorModule, RelayModule],
  controllers: [MonitorController],
  providers: [RoutingConfigService, MonitorService],
})
export class MonitorModule {}
