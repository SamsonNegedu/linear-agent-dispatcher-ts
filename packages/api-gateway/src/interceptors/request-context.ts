import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId?: string;
  userId?: string;
  startTime: number;
  [key: string]: unknown;
}

class RequestContextManager {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  async runAsync<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(context, fn);
  }
}

export const requestContextManager = new RequestContextManager();
