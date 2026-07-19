import { Module } from '@nestjs/common';
import { PreflightService } from './preflight.service';
import { RoutingConfigService } from '../../config/routing-config.service';

@Module({
  providers: [PreflightService, RoutingConfigService],
  exports: [RoutingConfigService],
})
export class PreflightModule {}
