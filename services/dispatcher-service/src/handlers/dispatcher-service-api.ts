import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { ApiGatewayService } from '@api-gateway/serverless-express';
import { AppModule } from '../app.module';

const logger = console;

let apiGatewayService: ApiGatewayService;

export const main: APIGatewayProxyHandlerV2 = async (event, context) => {
  if (!apiGatewayService) {
    logger.log('Initializing API Gateway service...');
    apiGatewayService = new ApiGatewayService({
      module: AppModule,
      logger,
      globalPrefix: '',
    });
  }

  return apiGatewayService.handler(event, context);
};
