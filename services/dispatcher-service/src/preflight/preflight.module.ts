import { Module } from '@nestjs/common';
import { PreflightService } from './preflight.service';
import { ReposConfigService } from '../config/repos-config.service';

@Module({
  providers: [PreflightService, ReposConfigService],
  exports: [ReposConfigService],
})
export class PreflightModule {}
