// Provider-agnostic contract shared by relay-service (ingest) and
// dispatcher-service (dispatch). Provider-specific knowledge (envelope
// shape, routing conventions, feedback channels) lives behind the adapter
// interfaces below, not in this file.

export type NormalizedEventKind = 'issue' | 'agent_session';

export interface NormalizedEvent {
  provider: string; // 'linear'
  kind: NormalizedEventKind;
  webhookId: string;
  idempotencyKey: string;
  timestamp: number;
  organizationId: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle?: string;
  ownerId?: string; // was assigneeId
  routingKey?: string; // was teamKey
  routingTags: string[]; // was labels — opaque strings, meaning is provider-defined
  isTerminal: boolean; // was stateType/isTerminalStateType, resolved by the ingest adapter
  sessionId?: string;
  action?: string;
  changedFields?: string[];
  labelChange?: { added: string[]; removed: string[] };
  rawPayload: unknown;
}

export interface DispatchDecision {
  shouldDispatch: boolean;
  reason: string;
}

export interface RoutingDecision {
  repoLabel: string;
  repoPath: string;
  skill: string;
  dedupeWindowMs: number;
}

/**
 * Verifies and parses a provider's raw webhook delivery into a NormalizedEvent.
 * Pure and framework-agnostic — implementations must not depend on Nest DI,
 * a database, or any per-deployment config beyond the signing secret passed in.
 * Owned by relay-service (the ingestion boundary for a given provider).
 */
export interface WebhookIngestAdapter<TRaw = unknown> {
  readonly provider: string;
  verifySignature(rawBody: Buffer, signature: string, secret: string): boolean;
  parse(rawBody: TRaw): NormalizedEvent;
}

/**
 * Decides whether/how a NormalizedEvent should turn into a dispatcher run,
 * and how to notify the provider of the outcome. Implementations are
 * expected to depend on deployment-local config/services (routing rules,
 * API clients for feedback) and so are owned and DI-wired by
 * dispatcher-service, not by this shared package.
 */
export interface DispatchAdapter {
  readonly provider: string;
  shouldDispatch(event: NormalizedEvent): DispatchDecision;
  resolveRouting(event: NormalizedEvent): RoutingDecision;
  postFeedback(event: NormalizedEvent, message: string): Promise<void>;
  /** Tells an agent session that no run was started because one is already in progress. */
  postSkipped?(event: NormalizedEvent, message: string): Promise<void>;
}

export interface ResolvedRouting {
  ownerId?: string;
  routingKey?: string;
}

/**
 * Backfills routing fields a webhook payload didn't carry (e.g. an agent
 * session event with no assignee), by calling the provider's API. Optional:
 * a provider whose webhooks always carry full routing info doesn't need
 * one. Depends on deployment-local config/API clients, so — like
 * DispatchAdapter — implementations are owned and DI-wired by the service
 * that uses them, not by this shared package.
 */
export interface RoutingResolver {
  readonly provider: string;
  resolveMissingRouting(event: NormalizedEvent): Promise<ResolvedRouting>;
}
