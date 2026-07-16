import { NestFactory } from '@nestjs/core';
import type { IEntryNestModule } from '@nestjs/core/nest-factory';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import serverlessExpress from '@codegenie/serverless-express';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context, Callback } from 'aws-lambda';
import { registerInterceptors, type RegisterInterceptorsOptions } from './interceptors';

export interface ApiGatewayServiceConfig {
  /**
   * The NestJS module to bootstrap
   */
  module: IEntryNestModule;
  /**
   * Logger for bootstrap debugging
   */
  logger?: Console | { log: (msg: string) => void };
  /**
   * Global API prefix (e.g., '/api/v1')
   */
  globalPrefix?: string;
  /**
   * Interceptor configuration options
   */
  interceptors?: RegisterInterceptorsOptions;
}

/**
 * Service class that bootstraps a NestJS application and handles Lambda events
 * Manages app initialization with singleton caching
 */
export class ApiGatewayService {
  private app: express.Application | null = null;
  private readonly config: ApiGatewayServiceConfig;
  private readonly logger: Console | { log: (msg: string) => void };

  constructor(config: ApiGatewayServiceConfig) {
    this.config = config;
    this.logger = config.logger || console;
  }

  /**
   * Initialize or return cached NestJS app
   */
  private async getApp(): Promise<express.Application> {
    if (!this.app) {
      this.logger.log('[API Gateway] Bootstrapping NestJS application...');

      // Create Express app
      const expressApp = express();

      // Create NestJS app with Express adapter
      const adapter = new ExpressAdapter(expressApp);
      const nestApp = await NestFactory.create(this.config.module, adapter);

      // Set global prefix if provided
      if (this.config.globalPrefix) {
        nestApp.setGlobalPrefix(this.config.globalPrefix);
      }

      // Register interceptors
      registerInterceptors(nestApp, this.config.interceptors);

      // Initialize the app
      await nestApp.init();

      this.logger.log('[API Gateway] NestJS application initialized');

      this.app = expressApp;
    }
    return this.app;
  }

  /**
   * Lambda handler for API Gateway v2 events
   */
  async handler(
    event: APIGatewayProxyEventV2,
    context: Context,
    callback?: Callback<APIGatewayProxyResultV2>,
  ): Promise<APIGatewayProxyResultV2> {
    try {
      const expressApp = await this.getApp();
      const handler = serverlessExpress({ app: expressApp });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument
      return handler(event, context, callback as any);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.log(`[API Gateway] Handler error: ${errorMsg}`);
      throw error;
    }
  }
}
