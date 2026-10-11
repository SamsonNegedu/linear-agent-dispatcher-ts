import type { NormalizedEvent, WebhookIngestAdapter } from '../core/types';
import { verifyLinearSignature, parseLinearWebhook, isTerminalStateType, type VerifiedEvent } from './index';

/**
 * Quarantines everything Linear-specific about ingesting a webhook: its HMAC
 * scheme, its envelope shape (classic Issue vs. AgentSessionEvent), and its
 * routing primitives (team/assignee/labels/state). Downstream code — relay's
 * fan-out, the dispatcher's queue and dispatch pipeline — only ever sees the
 * resulting NormalizedEvent.
 */
export class LinearIngestAdapter implements WebhookIngestAdapter<Buffer> {
  readonly provider = 'linear';

  verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
    return verifyLinearSignature(rawBody, signature, secret);
  }

  parse(rawBody: Buffer): NormalizedEvent {
    const payload = JSON.parse(rawBody.toString('utf-8')) as unknown;
    const event = parseLinearWebhook(payload);
    return toNormalizedEvent(event);
  }
}

function toNormalizedEvent(event: VerifiedEvent): NormalizedEvent {
  return {
    provider: 'linear',
    kind: event.type === 'AgentSession' ? 'agent_session' : 'issue',
    webhookId: event.webhookId,
    idempotencyKey: event.idempotencyKey,
    timestamp: event.timestamp,
    organizationId: event.organizationId,
    issueId: event.issueId,
    issueIdentifier: event.issueIdentifier,
    issueTitle: event.issueTitle,
    ownerId: event.assigneeId,
    routingKey: event.teamKey,
    routingTags: event.labels,
    isTerminal: isTerminalStateType(event.stateType),
    sessionId: event.sessionId,
    action: event.action,
    changedFields: event.changedFields,
    labelChange: event.labelChange,
    rawPayload: event.rawPayload,
  };
}
