import { NestFactory } from '@nestjs/core';
import type { IEntryNestModule } from '@nestjs/core/nest-factory';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import awsLambdaFastify from '@fastify/aws-lambda';
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

type LambdaProxyHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
  callback?: Callback<APIGatewayProxyResultV2>,
) => Promise<APIGatewayProxyResultV2>;

/**
 * Service class that bootstraps a NestJS application and handles Lambda events
 * Manages app initialization with singleton caching
 */
export class ApiGatewayService {
  private proxy: LambdaProxyHandler | null = null;
  private readonly config: ApiGatewayServiceConfig;
  private readonly logger: Console | { log: (msg: string) => void };

  constructor(config: ApiGatewayServiceConfig) {
    this.config = config;
    this.logger = config.logger || console;
  }

  /**
   * Initialize or return cached Lambda proxy handler
   */
  private async getProxy(): Promise<LambdaProxyHandler> {
    if (!this.proxy) {
      this.logger.log('[API Gateway] Bootstrapping NestJS application...');

      const adapter = new FastifyAdapter();
      const nestApp = await NestFactory.create<NestFastifyApplication>(
        this.config.module,
        adapter,
      );

      // Set global prefix if provided
      if (this.config.globalPrefix) {
        nestApp.setGlobalPrefix(this.config.globalPrefix);
      }

      // Register interceptors
      registerInterceptors(nestApp, this.config.interceptors);

      // Initialize the app
      await nestApp.init();
      await nestApp.getHttpAdapter().getInstance().ready();

      this.logger.log('[API Gateway] NestJS application initialized');

      this.proxy = awsLambdaFastify(nestApp.getHttpAdapter().getInstance());
    }
    return this.proxy;
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
      const proxy = await this.getProxy();
      return proxy(event, context, callback);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.log(`[API Gateway] Handler error: ${errorMsg}`);
      throw error;
    }
  }
}
