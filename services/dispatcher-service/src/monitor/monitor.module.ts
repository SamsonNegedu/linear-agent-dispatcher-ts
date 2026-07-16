import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { StoreModule } from '../store/store.module';
import { ReposConfigService } from '../config/repos-config.service';

@Module({
  imports: [StoreModule],
  controllers: [MonitorController],
  providers: [ReposConfigService],
})
export class MonitorModule {}
