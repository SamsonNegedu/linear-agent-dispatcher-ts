# ADR 0006: Use NestJS for Relay Service API

## Status

Accepted

## Context

The relay service needs:

- HTTP API with multiple endpoints (webhooks, registration, OAuth)
- Request validation and error handling
- Structured logging and monitoring
- Strong TypeScript support
- OAuth flow management
- Database access layer

Options considered:

- Raw Node.js (http module) + Express
- Express + manual middleware
- NestJS (opinionated, batteries-included)
- Fastify

## Decision

Use NestJS as the application framework, adapted to run on AWS Lambda:

### Architecture

- NestJS app for business logic (modules, services, controllers)
- Serverless-http adapter to bridge NestJS → Lambda
- Controllers for each endpoint (WebhookController, AuthController, SubscriberController)
- Services for business logic (WebhookService, SubscriberService, OAuthService)
- Decorators for authentication, validation, logging

### Key Modules

- `@nestjs/core`: DI, middleware, pipes
- `@nestjs/common`: HTTP decorators and guards
- `serverless-http`: wraps NestJS app for Lambda

## Consequences

### Positive

- **Structure**: forced project structure (modules, controllers, services) aids maintainability
- **Type safety**: full TypeScript with strict mode, decorators
- **Ecosystem**: rich community, many integrations available
- **DI container**: built-in dependency injection simplifies testing
- **Validation**: @nestjs/class-validator pipes for automatic validation
- **Middleware/Guards**: clean interceptor pattern for auth, logging, error handling
- **Error handling**: exception filters for uniform error responses

### Negative

- **Overhead**: more code than a minimal Express app (more decorators, services)
- **Learning curve**: NestJS paradigm is different from Express
- **Cold start**: slightly slower than bare-bones due to metadata reflection
  - Acceptable: cold start is ~500-1000ms anyway; NestJS adds maybe 100ms
- **Opinionated**: forces certain patterns (might feel restrictive to some)

## Alternatives Considered

### Option A: Express + manual middleware

- **Pros**: Lighter, more familiar to some
- **Cons**: Manual error handling, validation, logging; more boilerplate

### Option B: Fastify

- **Pros**: Faster, lighter
- **Cons**: Smaller ecosystem; less mature NestJS integration

### Option C: Raw Lambda handlers

- **Pros**: Minimal, no framework
- **Cons**: Lots of boilerplate, hard to scale with endpoints

## Implementation Notes

### Serverless Adapter

- Use `serverless-http` to wrap NestJS app
- Each Lambda handler calls same NestJS app instance
- Cold start includes NestJS bootstrap (~200-500ms)

### Project Structure

```
services/relay-service/src/
├── main.ts                    # Lambda handler
├── app.module.ts              # Root NestJS module
├── webhooks/
│   ├── webhooks.controller.ts
│   ├── webhooks.service.ts
│   └── webhooks.module.ts
├── subscribers/
│   ├── subscribers.controller.ts
│   ├── subscribers.service.ts
│   └── subscribers.module.ts
├── auth/
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── auth.module.ts
└── common/
    ├── guards/
    ├── interceptors/
    └── dto/
```

### Validation Pipeline

- Use `@nestjs/class-validator` for input validation
- Define DTO classes for each endpoint
- Automatic 400 response if validation fails

### Error Handling

- Exception filters for consistent error responses
- Log all errors to CloudWatch
- Return proper HTTP status codes (400, 401, 403, 500)

### Testing

- Unit tests: mock services, test controllers in isolation
- Integration tests: test against real DynamoDB (local or test table)
- e2e tests: test full flow including Lambda adapter

## Migration Path

If we need to move away from NestJS:

- Service layer is isolated; business logic is testable independently
- Controllers are thin; minimal framework-specific logic
- Easy to extract services and reuse in Express or Fastify
