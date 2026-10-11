import * as crypto from 'crypto';
import { z } from 'zod';

import { safeEqual } from '../core/safe-equal';
import type { DispatchDecision } from '../core/types';

export type { DispatchDecision } from '../core/types';
export { validateTimestamp } from '../core/timestamp';
export { LinearIngestAdapter } from './linear-ingest.adapter';

// Linear-specific verification: HMAC signature, envelope parsing, timestamp validation

export type WebhookType = 'Issue' | 'AgentSession';
export type IssueAction = 'create' | 'update';
export type AgentSessionAction = 'created' | 'prompted';

export interface LabelChange {
  added: string[];
  removed: string[];
}

export interface VerifiedEvent {
  webhookId: string;
  idempotencyKey: string;
  timestamp: number;
  teamId: string;
  teamKey?: string;
  assigneeId?: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle?: string;
  labels: string[];
  // Linear's stable state-type enum (triage/backlog/unstarted/started/
  // completed/canceled) — not the display name, which is workspace-
  // customizable. Only set for Issue webhooks.
  stateType?: string;
  organizationId: string;
  sessionId?: string; // Linear agent session ID for activity tracking
  type: WebhookType;
  action?: IssueAction | AgentSessionAction;
  labelChange?: LabelChange; // Only for Issue webhooks with label changes
  // Field names (besides `updatedAt`, which is present on every update) that
  // actually changed in this specific Issue "update" webhook. Only set for
  // Issue update events — Linear's `updatedFrom` holds the previous values of
  // whatever changed, so this is a direct read of its keys, not an inference.
  changedFields?: string[];
  rawPayload: unknown;
}

export const verifyLinearSignature = (
  payload: Buffer,
  signature: string | undefined,
  secret: string,
): boolean => {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return safeEqual(signature, expected);
};

// Linear's payloads vary by event and omit or null many fields, so every optional field is
// `nullish`. Only what routing and idempotency need is read; the original is kept as rawPayload.
const timestamp = z.union([z.string().min(1), z.number()]);
const objectWithId = z.object({ id: z.string().optional() }).nullish();
const label = z.union([
  z.string(),
  z.object({ id: z.string().optional(), name: z.string().optional() }),
]);

const issueEnvelope = z.object({
  webhookId: z.string().min(1),
  createdAt: timestamp,
  action: z.string().optional(),
  organizationId: z.string().optional(),
  // Previous values of the fields that changed; only present on "update" events.
  updatedFrom: z.record(z.string(), z.unknown()).nullish(),
  data: z.object({
    id: z.string().optional(),
    identifier: z.string().optional(),
    title: z.string().optional(),
    teamId: z.string().optional(),
    team: z.object({ id: z.string().optional(), key: z.string().optional() }).nullish(),
    assignee: objectWithId,
    organization: objectWithId,
    state: z.object({ type: z.string().optional() }).nullish(),
    labels: z.array(label).catch([]),
    labelIds: z.array(z.string()).catch([]),
    agentSession: z.unknown().optional(),
    agentSessionId: z.string().optional(),
    sessionId: z.string().optional(),
  }),
});

const agentSessionEnvelope = z.object({
  createdAt: timestamp,
  action: z.string().optional(),
  organizationId: z.string().min(1),
  agentSession: z.object({ id: z.string().min(1), issueId: z.string().min(1) }),
});

const parseOrThrow = <T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> => {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  // Paths and messages only: never echo the payload into logs or error responses.
  const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`Invalid Linear webhook payload: ${problems.join('; ')}`);
};

const labelName = (entry: z.infer<typeof label>): string | undefined =>
  typeof entry === 'string' ? entry : entry.name;

export const parseLinearWebhook = (payload: unknown): VerifiedEvent => {
  const { type } = parseOrThrow(z.looseObject({ type: z.string().optional() }), payload);
  // Classic Issue envelope: {webhookId, createdAt, action, data{...}}.
  // Agent session envelope: {type: "AgentSessionEvent", createdAt, agentSession{...}}.
  return type === 'AgentSessionEvent'
    ? parseAgentSessionWebhook(payload)
    : parseIssueWebhook(payload);
};

const parseIssueWebhook = (payload: unknown): VerifiedEvent => {
  const envelope = parseOrThrow(issueEnvelope, payload);
  const { data: issue, updatedFrom } = envelope;

  const teamId = issue.team?.id || issue.teamId;
  const issueId = issue.id;
  const organizationId = issue.organization?.id || envelope.organizationId;
  if (!teamId || !issueId || !organizationId) {
    throw new Error('Missing required fields: teamId, issueId, or organizationId');
  }

  const type: WebhookType = issue.agentSession ? 'AgentSession' : 'Issue';
  const action = envelope.action as IssueAction | AgentSessionAction | undefined;
  // `webhookId` identifies the subscription, not the delivery, so it can't dedupe. The
  // envelope's `createdAt` is per-delivery and unchanged on Linear's retries, so
  // issue + action + createdAt dedupes true retries but not distinct events.
  const ts = new Date(envelope.createdAt).getTime();

  // Whether anything on the issue actually changed. A webhook whose `updatedFrom` holds only
  // `updatedAt` means a side effect such as a comment bumped the timestamp.
  let changedFields: string[] | undefined;
  let labelChange: LabelChange | undefined;
  if (type === 'Issue') {
    if (updatedFrom) changedFields = Object.keys(updatedFrom).filter((key) => key !== 'updatedAt');

    // `updatedFrom` has only bare `labelIds`, so added label names come from diffing them
    // against the current labels.
    const previous = z.array(z.string()).safeParse(updatedFrom?.labelIds);
    if (previous.success) {
      const added = issue.labelIds
        .filter((id) => !previous.data.includes(id))
        .flatMap((id) => issue.labels.filter((l) => typeof l !== 'string' && l.id === id))
        .map(labelName)
        .filter((name): name is string => !!name);
      labelChange = { added, removed: [] };
    }
  }

  return {
    webhookId: envelope.webhookId,
    idempotencyKey: `issue:${issueId}:${action}:${ts}`,
    timestamp: ts,
    teamId,
    teamKey: issue.team?.key,
    assigneeId: issue.assignee?.id,
    issueId,
    issueIdentifier: issue.identifier ?? '',
    issueTitle: issue.title,
    labels: issue.labels.map(labelName).filter((name): name is string => !!name),
    stateType: issue.state?.type,
    organizationId,
    sessionId: issue.agentSessionId || issue.sessionId,
    type,
    action,
    labelChange,
    changedFields,
    rawPayload: payload,
  };
};

// An agent session envelope carries no team, assignee, labels or issue identifier; those are
// left empty so the relay skips it for lack of a teamKey/assigneeId.
const parseAgentSessionWebhook = (payload: unknown): VerifiedEvent => {
  const { agentSession: session, ...envelope } = parseOrThrow(agentSessionEnvelope, payload);
  const action = envelope.action as IssueAction | AgentSessionAction | undefined;
  const ts = new Date(envelope.createdAt).getTime();

  return {
    webhookId: session.id,
    // session.id is constant across a session's lifecycle (created -> prompted), so it alone
    // isn't a per-event key; pair it with the action and delivery time.
    idempotencyKey: `session:${session.id}:${action}:${ts}`,
    timestamp: ts,
    teamId: '',
    issueId: session.issueId,
    issueIdentifier: '',
    labels: [],
    organizationId: envelope.organizationId,
    sessionId: session.id,
    type: 'AgentSession',
    action,
    rawPayload: payload,
  };
};

// Linear's state.type enum: 'triage' | 'backlog' | 'unstarted' | 'started' |
// 'completed' | 'canceled'. "Terminal" means the issue is done, one way or
// another — not the display name, which workspaces can rename freely.
const TERMINAL_STATE_TYPES = new Set(['completed', 'canceled']);

export const isTerminalStateType = (stateType: string | undefined): boolean =>
  !!stateType && TERMINAL_STATE_TYPES.has(stateType);

/**
 * Decides whether a parsed webhook event should trigger a dispatch run.
 * This is independent of label *validation* (whether the labels resolve to a
 * known repo/skill) — that's decided separately once this returns true.
 *
 * Explicit rules, in order:
 * 1. AgentSession events always dispatch. A human interacting with an agent
 *    session in Linear's UI is itself the trigger.
 * 2. Issue "create" events always dispatch. There is no `updatedFrom` on a
 *    create event — the issue's initial fields aren't a "change" to react to.
 * 3. Issue "update" events dispatch if `changedFields` is non-empty, i.e. at
 *    least one real field on the issue changed (labels, delegate, state,
 *    assignee, anything). Linear fires an "Issue update" webhook for *any*
 *    field change, including a side effect of posting a comment — which
 *    bumps only `updatedAt` and touches no other field. Without this check,
 *    our own progress/success comment would re-trigger a run indefinitely:
 *    run -> comment -> webhook -> run -> ...
 * 4. Anything else (unrecognized action) does not dispatch.
 */
export function shouldTriggerDispatch(event: VerifiedEvent): DispatchDecision {
  if (event.type === 'AgentSession') {
    return { shouldDispatch: true, reason: 'agent session event' };
  }

  if (event.action === 'create') {
    return { shouldDispatch: true, reason: 'issue created' };
  }

  if (event.action === 'update') {
    const changed = event.changedFields ?? [];
    if (changed.length > 0) {
      return { shouldDispatch: true, reason: `fields changed: ${changed.join(', ')}` };
    }
    return {
      shouldDispatch: false,
      reason: 'update changed no issue fields (e.g. a comment, which only bumps updatedAt)',
    };
  }

  return { shouldDispatch: false, reason: `unrecognized action: ${String(event.action)}` };
}
