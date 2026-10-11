import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from '../response-envelope.interceptor';

const contextWithStatus = (statusCode?: number): ExecutionContext =>
  ({
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
  }) as unknown as ExecutionContext;

const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps the payload with success, the status code and a timestamp', async () => {
    const result = await firstValueFrom(
      new ResponseEnvelopeInterceptor().intercept(contextWithStatus(201), handler({ id: 1 })),
    );

    expect(result).toEqual({
      success: true,
      data: { id: 1 },
      statusCode: 201,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('defaults the status code to 200 and keeps null/array payloads', async () => {
    const interceptor = new ResponseEnvelopeInterceptor();

    expect(
      (await firstValueFrom(interceptor.intercept(contextWithStatus(), handler([1, 2])))).data,
    ).toEqual([1, 2]);
    expect(
      await firstValueFrom(interceptor.intercept(contextWithStatus(), handler(null))),
    ).toMatchObject({ statusCode: 200, data: null });
  });
});
