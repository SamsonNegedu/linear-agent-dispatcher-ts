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
  timestamp: number;
  teamId: string;
  teamKey?: string;
  assigneeId?: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle?: string;
  labels: string[];
  organizationId: string;
  sessionId?: string; // Linear agent session ID for activity tracking
  type: WebhookType;
  action?: IssueAction | AgentSessionAction;
  labelChange?: LabelChange; // Only for Issue webhooks with label changes
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

  // Extract nested objects with fallbacks
  const team = (eventData.team || {}) as Record<string, unknown>;
  const issue = (eventData.issue || {}) as Record<string, unknown>;
  const assignee = eventData.assignee as Record<string, unknown> | undefined;

  const teamId = (team.id || eventData.teamId) as string;
  const teamKey = team.key as string | undefined;
  const issueId = (issue.id || eventData.issueId || eventData.id) as string;
  const issueIdentifier = (issue.identifier ||
    eventData.issueIdentifier ||
    eventData.identifier) as string;
  const assigneeId = assignee?.id as string | undefined;
  const organizationId = ((eventData.organization as Record<string, unknown> | undefined)?.id ||
    data.organizationId) as string;

  if (!teamId || !issueId || !organizationId) {
    throw new Error('Missing required fields: teamId, issueId, or organizationId');
  }

  const labels = Array.isArray(eventData.labels) ? eventData.labels.map(labelName) : [];

  // Extract Linear agent session ID if available (for activity tracking)
  const sessionId = (eventData.agentSessionId || eventData.sessionId) as string | undefined;

  // Detect label changes (for Issue webhooks)
  let labelChange: LabelChange | undefined;
  if (webhookType === 'Issue' && eventData.labelChanges) {
    const changes = eventData.labelChanges as Record<string, unknown>;
    labelChange = {
      added: Array.isArray(changes.added) ? changes.added.map(labelName) : [],
      removed: Array.isArray(changes.removed) ? changes.removed.map(labelName) : [],
    };
  }

  return {
    webhookId: data.webhookId as string,
    timestamp: new Date(data.createdAt as string).getTime(),
    teamId,
    teamKey,
    assigneeId,
    issueId,
    issueIdentifier,
    issueTitle: issue.title as string | undefined,
    labels,
    organizationId,
    sessionId,
    type: webhookType,
    action: eventData.action as IssueAction | AgentSessionAction | undefined,
    labelChange,
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

  return {
    webhookId: session.id as string, // Use session ID as a unique identifier
    timestamp: new Date(data.createdAt as string).getTime(),
    teamId: '', // Not available in agent session envelope
    teamKey: undefined, // Not available — relay will skip due to missing teamKey
    assigneeId: undefined, // Not available — relay will skip due to missing assigneeId
    issueId,
    issueIdentifier: '', // Not available in agent session envelope
    labels: [], // Agent sessions don't have labels
    organizationId,
    sessionId: session.id as string, // Agent session ID for reference
    type: 'AgentSession',
    action: data.action as IssueAction | AgentSessionAction | undefined,
    rawPayload: data,
  };
};

export const validateTimestamp = (timestamp: number, windowMs: number = 5 * 60 * 1000): boolean => {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= windowMs;
};
