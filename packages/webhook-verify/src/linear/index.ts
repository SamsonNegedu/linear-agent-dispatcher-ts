import * as crypto from 'crypto';

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
  signature: string,
  secret: string,
): boolean => {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

export const parseLinearWebhook = (payload: unknown): VerifiedEvent => {
  const data = payload as Record<string, unknown>;

  // Detect envelope type: Issue webhooks have {webhookId, createdAt, data{...}},
  // while AgentSession webhooks have {type: "AgentSessionEvent", createdAt, agentSession{...}}
  const isAgentSessionEnvelope = data.type === 'AgentSessionEvent';

  if (isAgentSessionEnvelope) {
    // Agent session envelope
    if (!data.createdAt || !data.agentSession) {
      throw new Error('Invalid Linear webhook payload structure');
    }
    return parseAgentSessionWebhook(data);
  } else {
    // Issue webhook envelope (classic structure)
    if (!data.webhookId || !data.createdAt || !data.data) {
      console.error(
        'Invalid Linear webhook payload structure. Received:',
        JSON.stringify(
          {
            type: data.type,
            webhookId: data.webhookId,
            createdAt: data.createdAt,
            hasData: !!data.data,
            keys: Object.keys(data),
          },
          null,
          2,
        ),
      );
      throw new Error('Invalid Linear webhook payload structure');
    }
    return parseIssueWebhook(data);
  }
};

const labelName = (label: unknown): string =>
  typeof label === 'string' ? label : ((label as Record<string, unknown>).name as string);

const parseIssueWebhook = (data: Record<string, unknown>): VerifiedEvent => {
  const eventData = data.data as Record<string, unknown>;

  // Extract webhook type (Issue or AgentSession from data)
  const webhookType: WebhookType = eventData.agentSession ? 'AgentSession' : 'Issue';

  // `eventData` (`data.data`) is the Issue entity itself, flat — Linear's classic
  // Issue webhook envelope has no nested `data.data.issue` sub-object, so `id`,
  // `identifier`, and `title` are read directly off it.
  const team = (eventData.team || {}) as Record<string, unknown>;
  const assignee = eventData.assignee as Record<string, unknown> | undefined;
  const state = eventData.state as Record<string, unknown> | undefined;

  const teamId = (team.id || eventData.teamId) as string;
  const teamKey = team.key as string | undefined;
  const issueId = eventData.id as string;
  const issueIdentifier = eventData.identifier as string;
  const issueTitle = eventData.title as string | undefined;
  const assigneeId = assignee?.id as string | undefined;
  const stateType = state?.type as string | undefined;
  const organizationId = ((eventData.organization as Record<string, unknown> | undefined)?.id ||
    data.organizationId) as string;

  if (!teamId || !issueId || !organizationId) {
    throw new Error('Missing required fields: teamId, issueId, or organizationId');
  }

  const labels = Array.isArray(eventData.labels) ? eventData.labels.map(labelName) : [];

  // Extract Linear agent session ID if available (for activity tracking)
  const sessionId = (eventData.agentSessionId || eventData.sessionId) as string | undefined;

  // `updatedFrom` (sibling of `data`, only present on "update" events) holds
  // the previous value of every field that changed in this specific webhook
  // — nothing more. `changedFields` is a direct read of its keys (minus the
  // always-present `updatedAt`), so it says exactly what changed, generically,
  // for any field: labels, delegate, state, assignee, etc. A webhook where
  // `updatedFrom` has ONLY `updatedAt` means no issue field actually changed
  // — the only way that happens is something bumping the issue's timestamp
  // without touching it directly, e.g. a comment being posted.
  let changedFields: string[] | undefined;
  let labelChange: LabelChange | undefined;
  if (webhookType === 'Issue') {
    const updatedFrom = data.updatedFrom as Record<string, unknown> | undefined;
    if (updatedFrom) {
      changedFields = Object.keys(updatedFrom).filter((key) => key !== 'updatedAt');
    }

    // Label names aren't in `updatedFrom` (it only has bare `labelIds`), so
    // resolving `added` label names requires diffing against the current
    // `labelIds`/`labels` arrays. Kept separate from `changedFields` because
    // it needs this extra resolution step and only applies to one field.
    const previousLabelIds = updatedFrom?.labelIds as string[] | undefined;
    if (Array.isArray(previousLabelIds)) {
      const currentLabelIds = Array.isArray(eventData.labelIds)
        ? (eventData.labelIds as string[])
        : [];
      const addedIds = currentLabelIds.filter((id) => !previousLabelIds.includes(id));
      const currentLabels = Array.isArray(eventData.labels)
        ? (eventData.labels as Record<string, unknown>[])
        : [];
      const addedNames = addedIds
        .map((id) => currentLabels.find((label) => label.id === id))
        .filter((label): label is Record<string, unknown> => !!label)
        .map(labelName);
      labelChange = { added: addedNames, removed: [] };
    }
  }

  // `data.webhookId` identifies the webhook *subscription*, not the individual
  // delivery — it's constant across every event Linear sends to it, so it must
  // not be used as an idempotency key. The envelope's `createdAt` is per-delivery
  // and is retried unchanged by Linear on non-2xx responses, so pairing it with
  // the issue makes a key that dedupes true retries but not distinct events.
  const timestamp = new Date(data.createdAt as string).getTime();
  // `action` lives on the envelope itself (Linear's classic webhook shape is
  // {action, type, createdAt, data: {...}}), not nested inside `data.data`.
  const action = data.action as IssueAction | AgentSessionAction | undefined;

  return {
    webhookId: data.webhookId as string,
    idempotencyKey: `issue:${issueId}:${action}:${timestamp}`,
    timestamp,
    teamId,
    teamKey,
    assigneeId,
    issueId,
    issueIdentifier,
    issueTitle,
    labels,
    stateType,
    organizationId,
    sessionId,
    type: webhookType,
    action,
    labelChange,
    changedFields,
    rawPayload: data,
  };
};

const parseAgentSessionWebhook = (data: Record<string, unknown>): VerifiedEvent => {
  const session = data.agentSession as Record<string, unknown>;

  // Agent sessions don't have team/assignee in the webhook envelope — they're
  // just notifications that a session was created/prompted. We extract what we
  // can (issueId, organizationId) and leave team/assignee empty so the relay
  // can skip them (relay checks for teamKey/assigneeId and skips if missing).
  const issueId = session.issueId as string;
  const organizationId = data.organizationId as string;

  if (!issueId || !organizationId) {
    throw new Error('Missing required fields in AgentSession: issueId or organizationId');
  }

  const timestamp = new Date(data.createdAt as string).getTime();
  const action = data.action as IssueAction | AgentSessionAction | undefined;

  return {
    webhookId: session.id as string, // Use session ID as a unique identifier
    // session.id is constant across a session's lifecycle (created -> prompted),
    // so it alone isn't a valid per-event key — pair with action + delivery time.
    idempotencyKey: `session:${session.id as string}:${action}:${timestamp}`,
    timestamp,
    teamId: '', // Not available in agent session envelope
    teamKey: undefined, // Not available — relay will skip due to missing teamKey
    assigneeId: undefined, // Not available — relay will skip due to missing assigneeId
    issueId,
    issueIdentifier: '', // Not available in agent session envelope
    labels: [], // Agent sessions don't have labels
    organizationId,
    sessionId: session.id as string, // Agent session ID for reference
    type: 'AgentSession',
    action,
    rawPayload: data,
  };
};

export const validateTimestamp = (timestamp: number, windowMs: number = 5 * 60 * 1000): boolean => {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= windowMs;
};

// Linear's state.type enum: 'triage' | 'backlog' | 'unstarted' | 'started' |
// 'completed' | 'canceled'. "Terminal" means the issue is done, one way or
// another — not the display name, which workspaces can rename freely.
const TERMINAL_STATE_TYPES = new Set(['completed', 'canceled']);

export const isTerminalStateType = (stateType: string | undefined): boolean =>
  !!stateType && TERMINAL_STATE_TYPES.has(stateType);

export interface DispatchDecision {
  shouldDispatch: boolean;
  reason: string;
}

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
