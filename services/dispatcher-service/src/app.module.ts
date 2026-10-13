import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { rootEnvFile } from '@linear-agent/env-file';
import { DispatcherConfigModule } from './config/dispatcher-config.module';
import { ConfigValidatorService } from './config/config-validator.service';
import { RelayModule } from './pipeline/relay/relay.module';
import { PreflightModule } from './ops/preflight/preflight.module';
import { HealthModule } from './ops/health/health.module';
import { MonitorModule } from './ops/monitor/monitor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: rootEnvFile(),
    }),
    DispatcherConfigModule,
    PreflightModule,
    HealthModule,
    MonitorModule,
    RelayModule,
  ],
  controllers: [],
  providers: [ConfigValidatorService],
})
export class AppModule {}
