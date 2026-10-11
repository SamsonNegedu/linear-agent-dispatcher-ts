# API Gateway - NestJS Serverless Fastify

A lightweight wrapper for bootstrapping NestJS applications with AWS Lambda and API Gateway, including production-ready interceptors for logging, error handling, timing, and request tracking.

## Features

- **Serverless Fastify Integration** - Run NestJS on AWS Lambda with API Gateway v2
- **Global Interceptors** - Production-ready interceptors for cross-cutting concerns
- **Request ID Tracking** - Automatic request ID and correlation ID generation
- **Request Context** - AsyncLocalStorage-based context preservation through request lifecycle
- **Smart Logging** - Structured logging with skip paths and request tracking
- **Performance Monitoring** - Response time headers and slow request detection

## Installation

This is an internal workspace package — add it as a dependency in another workspace's `package.json`:

```bash
pnpm add @api-gateway/serverless-express --workspace
```

## Quick Start

### Lambda Service (Relay Service)

```typescript
import { ApiGatewayService } from '@api-gateway/serverless-express';
import { MyModule } from './my.module';

const apiGatewayHandler = new ApiGatewayService({
  logger: console,
  module: MyModule,
  globalPrefix: '/api/v1',
});

export const handler = async (event, context, callback) => {
  return apiGatewayHandler.handler(event, context, callback);
};
```

### Regular NestJS App

```typescript
import { NestFactory } from '@nestjs/core';
import { registerInterceptors } from '@api-gateway/serverless-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // All interceptors enabled by default
  // Health checks auto-skipped
  registerInterceptors(app);

  await app.listen(3000);
}

bootstrap();
```

**That's it.** No configuration needed for the common case.

## Interceptors

All interceptors are enabled by default and can be disabled individually. **ErrorInterceptor and RequestIdInterceptor cannot be disabled** - they are essential.

### 1. RequestIdInterceptor

Automatically generates or extracts request IDs for distributed tracing, and preserves them through AsyncLocalStorage for the life of the request.

**Usage:**

```typescript
// Headers in incoming request
X-Request-Id: abc123def456
X-Correlation-Id: correlationId123

// Headers in response
X-Request-Id: abc123def456
X-Correlation-Id: correlationId123
```

### 2. ErrorInterceptor

Standardizes error responses with consistent format.

**Response Format:**

```json
{
  "statusCode": 400,
  "message": "Bad Request",
  "error": "BadRequestException",
  "timestamp": "2025-07-12T10:30:00.000Z",
  "path": "/api/users"
}
```

### 3. TimingInterceptor

Tracks request duration, adds an `X-Response-Time` header, and optionally logs requests that exceed a threshold.

**Configuration:**

```typescript
timingConfig: {
  threshold: 1000,        // Log if >1000ms
  skipPaths: ['/health'], // Don't time these paths
  logger: customLogger,    // Optional custom logger
}
```

### 4. LoggingInterceptor

Structured request/response logging with request tracking. Logs all real requests (health checks like `/health`, `/metrics` are auto-skipped), includes request/correlation IDs automatically, and works with any logger (Pino, Winston, etc.).

**Log Output:**

```json
{
  "message": "GET /api/users",
  "level": "info",
  "method": "GET",
  "url": "/api/users",
  "statusCode": 200,
  "duration": "45ms",
  "requestId": "abc123def456",
  "correlationId": "correlationId123",
  "ip": "192.168.1.1"
}
```

### 5. ResponseTransformInterceptor

Wraps all successful responses in a standard API format.

**Response Format:**

```json
{
  "success": true,
  "data": { "id": 1, "name": "John" },
  "statusCode": 200,
  "timestamp": "2025-07-12T10:30:00.000Z"
}
```

**Disable if:** Your service handles response formatting itself.

## Request Context

Access request metadata anywhere in your application using AsyncLocalStorage.

```typescript
import { requestContextManager } from '@api-gateway/serverless-express';

// In a service or controller
export class UserService {
  getUser(id: string) {
    const context = requestContextManager.getContext();
    const requestId = context?.requestId;
    const correlationId = context?.correlationId;

    console.log(`Processing request ${requestId}`);
    // ...
  }
}

// Get specific values
const requestId = requestContextManager.getRequestId();
const correlationId = requestContextManager.getCorrelationId();
```

### RequestContext Interface

```typescript
interface RequestContext {
  requestId: string; // Unique ID for this request
  correlationId?: string; // For distributed tracing
  userId?: string; // Can be set by auth interceptor
  startTime: number; // Request start timestamp
  method?: string; // HTTP method
  url?: string; // Request path
  ip?: string; // Client IP
  [key: string]: any; // Add custom fields
}
```

## Configuration Examples

### Slow Request Alerts

```typescript
registerInterceptors(app, {
  timingConfig: {
    threshold: 1000, // Alert on requests >1s
    logger: customLogger,
  },
});
```

### Disable Specific Interceptors

```typescript
registerInterceptors(app, {
  disableLogging: true, // Disable logging
  disableTiming: true, // Disable timing
  disableResponseTransform: true, // Disable response wrapping
  // ErrorInterceptor and RequestIdInterceptor always enabled
});
```

### Lambda Service with Custom Config

```typescript
const apiGatewayHandler = new ApiGatewayService({
  module: MyModule,
  globalPrefix: '/api/v1',
  interceptors: {
    loggingConfig: {
      skipPaths: ['/health', '/metrics'],
      logResponseBody: true,
    },
    timingConfig: {
      threshold: 2000,
      skipPaths: ['/health'],
    },
  },
});
```

## Headers Reference

### Request Headers (Recognized)

| Header             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `X-Request-Id`     | Request identifier (auto-generated if not provided)             |
| `X-Correlation-Id` | Correlation ID for distributed tracing (defaults to request ID) |

### Response Headers (Set)

| Header             | Purpose                          |
| ------------------ | -------------------------------- |
| `X-Request-Id`     | Echo of request ID               |
| `X-Correlation-Id` | Echo of correlation ID           |
| `X-Response-Time`  | Request duration in milliseconds |

## Type Definitions

```typescript
// Main registration options
interface RegisterInterceptorsOptions {
  disableLogging?: boolean;
  loggingConfig?: LoggingConfig;
  disableTiming?: boolean;
  timingConfig?: TimingConfig;
  disableResponseTransform?: boolean;
}

// Logging configuration
interface LoggingConfig {
  logger?: any;
  logResponseBody?: boolean;
}

// Timing configuration
interface TimingConfig {
  logger?: any;
  threshold?: number; // milliseconds - only log if request exceeds this
}

// API Gateway service configuration
interface ApiGatewayServiceConfig {
  module: any; // NestJS module
  logger?: Console | { log: (msg: string) => void };
  globalPrefix?: string;
  interceptors?: RegisterInterceptorsOptions;
}

// Request context (via AsyncLocalStorage)
interface RequestContext {
  requestId: string;
  correlationId?: string;
  userId?: string;
  startTime: number;
  [key: string]: any;
}
```

## Troubleshooting

### Missing Request ID in Logs

Interceptor order matters — RequestIdInterceptor sets up the AsyncLocalStorage context that the others read from, so it must be registered first:

```typescript
app.useGlobalInterceptors(
  new RequestIdInterceptor(), // Must be first
  new ErrorInterceptor(),
  new TimingInterceptor(),
  new LoggingInterceptor(),
);
```

### Response Transform Breaking Your API

If your service returns custom formats, disable ResponseTransformInterceptor:

```typescript
registerInterceptors(app, {
  disableResponseTransform: true,
});
```

### Health Checks Not Being Logged

This is intentional. Paths like `/health`, `/metrics`, `/ping`, `/healthz`, `/ready` are auto-skipped to reduce noise.
