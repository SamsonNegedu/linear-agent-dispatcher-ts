import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Callback, Context } from 'aws-lambda';
import { ApiGatewayService } from '@api-gateway/serverless-express';
import { RelayModule } from '@relay/relay.module';

const apiGatewayHandler = new ApiGatewayService({
  logger: console,
  module: RelayModule,
  interceptors: {
    disableResponseTransform: true, // Relay service handles its own response format
    timingConfig: {
      threshold: 1000, // Log slow requests >1s
    },
  },
});

export const main = async (
  event: APIGatewayProxyEventV2,
  context: Context,
  callback?: Callback<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> => {
  return apiGatewayHandler.handler(event, context, callback);
};
