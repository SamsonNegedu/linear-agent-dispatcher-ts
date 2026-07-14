import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DispatcherConfigModule } from './config/dispatcher-config.module';
import { ConfigValidatorService } from './config/config-validator.service';
import { RelayModule } from './relay/relay.module';
import { PreflightModule } from './preflight/preflight.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DispatcherConfigModule,
    PreflightModule,
    HealthModule,
    RelayModule,
  ],
  controllers: [],
  providers: [ConfigValidatorService],
})
export class AppModule {}
