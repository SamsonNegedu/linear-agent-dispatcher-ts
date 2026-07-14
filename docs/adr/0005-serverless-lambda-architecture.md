# ADR 0005: Serverless Lambda Architecture for Relay

## Status

Accepted

## Context

The relay service must:

- Handle traffic spikes (webhooks are bursty, not steady-state)
- Run 24/7 with minimal operational overhead
- Scale elastically without pre-provisioning
- Keep costs predictable and proportional to usage
- Integrate with Linear OAuth (which uses HTTPS callbacks)

## Decision

Deploy relay service as AWS Lambda functions triggered by HTTP API Gateway:

- `POST /webhooks/linear` → Lambda handler for Linear webhook ingestion
- `POST /subscribers/register` → Lambda handler for dispatcher registration
- `GET /subscribers/auth/start` → Lambda handler to initiate OAuth flow
- `GET /subscribers/auth/callback` → Lambda handler to complete OAuth flow

Each Lambda:

- Runs Node.js 22+
- Connects to DynamoDB for state
- Connects to AWS Secrets Manager for OAuth tokens
- Has 5-minute timeout (safe for all operations)
- Auto-scales with demand (no provisioning needed)

## Consequences

### Positive

- **No ops burden**: AWS manages infrastructure, scaling, patching
- **Cost efficiency**: pay per invocation + GB-seconds; unused capacity = $0
- **Built-in redundancy**: Lambda runs across multiple AZs
- **Easy deployment**: zip and deploy via SST; no server management
- **Monitoring**: CloudWatch logs built-in; integrates with X-Ray

### Negative

- **Cold starts**: first invocation in 15 minutes has ~1 second overhead
  - Mitigated: low for webhooks (mostly warm); acceptable latency hit
- **Stateless**: can't maintain persistent connections
  - Acceptable: HTTP is stateless anyway; DynamoDB is persistent store
- **Vendor lock-in**: tightly coupled to AWS Lambda
  - Acceptable: Lambda is mature, pricing is transparent

## Alternatives Considered

### Option A: EC2 or ECS Fargate (containerized)

- **Pros**: More control, not serverless
- **Cons**: Need to manage scaling, min cost even at 0 traffic, more ops

### Option B: App Runner (managed container)

- **Pros**: Easier than ECS, still containerized
- **Cons**: Cold starts still exist, less mature than Lambda

### Option C: Kong or API Gateway alternative

- **Pros**: More control over routing logic
- **Cons**: Overkill for our use case; adds complexity

## Implementation Notes

### Local Development

- Use `sst dev` to simulate Lambda locally
- AWS SAM or SST mock for local testing
- Environment variables for credentials (LocalStack for offline DynamoDB)

### Performance Characteristics

- Webhook ingestion: ~200ms (including DynamoDB write)
- Dispatch to 5 dispatchers: ~500ms (parallel requests)
- OAuth flow: ~1 second (includes Linear API call)
- Cold start: ~500-1000ms for first invocation

### Cost Estimation (monthly)

- 1M webhooks/month: ~$0.20 (Lambda) + $1-5 (DynamoDB throughput)
- 100K webhooks/month: ~$0.02 (Lambda) + $0.50 (DynamoDB)
- Scale: costs grow linearly with webhooks; no surprises

### Scaling Limits

- Lambda concurrent execution: 1000 (account limit, can be increased)
- DynamoDB on-demand: scales to millions of writes/sec
- API Gateway: throttles at 10k requests/sec (can be increased)

## Migration Notes

If we need to move away from Lambda later:

- Abstract DynamoDB access (use data layer abstraction)
- Keep handlers thin; business logic in separate module
- Avoid Lambda-specific features where possible
