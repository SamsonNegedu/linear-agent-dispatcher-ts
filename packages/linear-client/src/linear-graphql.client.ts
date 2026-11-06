import { LinearClient, PaginationOrderBy } from '@linear/sdk';
import type { TokenSource } from './app-token-provider.js';
import type {
  ActivityType,
  LinearUserInfo,
  ActivityCreateResponse,
  IssueLabelsResponse,
  IssueContext,
  LinearClientLogger,
  ListIssuesQuery,
  ScannedIssue,
} from './types.js';

/**
 * Below this many webhook-supplied labels, treat the webhook payload as incomplete
 * and fetch the full label set via the Linear API. Real issues have domain + mode labels
 * (>=2), so fewer than that means the webhook likely missed updates.
 */
const MIN_LABEL_COUNT_FOR_FALLBACK = 2;

/**
 * Shared Linear API client for both relay and dispatcher services.
 * Wraps @linear/sdk for issue/activity/comment operations used by webhook routing.
 */
// An expired or revoked token surfaces as this SDK error type or message.
const isAuthError = (error: unknown): boolean => {
  const { type, message } = (error ?? {}) as { type?: string; message?: string };
  return (
    type === 'AuthenticationError' ||
    /authentication required|not authenticated/i.test(message ?? '')
  );
};

const newSdkClient = (token: string): LinearClient =>
  // Personal API keys (lin_api_...) and OAuth access tokens (lin_oauth_...) authenticate
  // differently; sending an OAuth token as an apiKey is rejected as "Authentication required".
  token.startsWith('lin_oauth_')
    ? new LinearClient({ accessToken: token })
    : new LinearClient({ apiKey: token });

export class LinearGraphQLClient {
  private sdkClient?: { token: string; client: LinearClient };

  /**
   * `credential` is a fixed token or API key, or a TokenSource that supplies a current token for
   * each request. With a TokenSource, a request rejected as unauthenticated is retried once on a
   * fresh token.
   */
  constructor(
    private readonly credential: string | TokenSource,
    private readonly logger?: LinearClientLogger,
    /** Test seam: how a token becomes an SDK client. */
    private readonly createSdk: (token: string) => LinearClient = newSdkClient,
  ) {}

  private async sdk(): Promise<LinearClient> {
    const token =
      typeof this.credential === 'string' ? this.credential : await this.credential.getToken();
    if (this.sdkClient?.token !== token) this.sdkClient = { token, client: this.createSdk(token) };
    return this.sdkClient.client;
  }

  private async call<T>(operation: (client: LinearClient) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.sdk());
    } catch (error) {
      if (typeof this.credential === 'string' || !isAuthError(error)) throw error;
      this.logger?.warn('Linear rejected the app token; fetching a new one and retrying once');
      this.credential.invalidate();
      return operation(await this.sdk());
    }
  }

  /**
   * Get current user info and teams from Linear
   * Used during OAuth flow in relay-service
   */
  async getUserInfo(accessToken: string): Promise<LinearUserInfo> {
    const client = accessToken ? new LinearClient({ accessToken }) : await this.sdk();

    const viewer = await client.viewer;
    if (!viewer?.id) {
      throw new Error('Failed to extract user ID from Linear response');
    }

    const teamsConnection = await viewer.teams();
    const teams = teamsConnection.nodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
    }));
    if (teams.length === 0) {
      throw new Error('User has no Linear teams');
    }

    return {
      linearUserId: viewer.id,
      email: viewer.email,
      teams,
    };
  }

  /** Who these credentials act as. `app` is true for an app user, which agent sessions require. */
  async getViewer(): Promise<{ name: string; app: boolean }> {
    const viewer = await this.call((client) => client.viewer);
    return { name: viewer.name, app: viewer.app };
  }

  /**
   * Create an activity in a Linear agent session
   * Used by dispatcher-service for activity posting
   */
  async createActivity(
    agentSessionId: string,
    type: ActivityType,
    body: string,
  ): Promise<ActivityCreateResponse> {
    if (!agentSessionId || !type || !body) {
      throw new Error('Missing required fields for activity creation');
    }

    try {
      const response = await this.call((client) =>
        client.createAgentActivity({ agentSessionId, content: { type, body } }),
      );

      if (!response.agentActivityId) {
        throw new Error('No activity ID returned from Linear API');
      }

      return { id: response.agentActivityId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.error(
        `Failed to create Linear agent activity: ${errorMsg} sessionId=${agentSessionId} type=${type}`,
      );
      throw error;
    }
  }

  /**
   * Post a plain comment on an issue: the feedback channel for webhooks with no agent
   * session (activities need an agentSessionId).
   */
  async createComment(issueId: string, body: string): Promise<{ id: string }> {
    if (!issueId || !body) {
      throw new Error('Missing required fields for comment creation');
    }

    try {
      const response = await this.call((client) => client.createComment({ issueId, body }));

      if (!response.commentId) {
        throw new Error('No comment ID returned from Linear API');
      }

      return { id: response.commentId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.error(`Failed to create Linear comment: ${errorMsg} issueId=${issueId}`);
      throw error;
    }
  }

  /**
   * Resolve issue labels and identifier. Webhook labels are used as-is unless there are
   * fewer than MIN_LABEL_COUNT_FOR_FALLBACK, in which case they are re-fetched from Linear
   * (the identifier comes with that fetch; AgentSession webhooks never carry one). If the
   * fetch fails, the webhook labels are used so an API outage doesn't block routing.
   */
  async resolveIssueContext(issueId: string, webhookLabels: string[]): Promise<IssueContext> {
    if (webhookLabels.length >= MIN_LABEL_COUNT_FOR_FALLBACK) {
      this.logger?.debug(
        `Webhook label count meets fallback threshold, skipping Linear API fetch labelCount=${webhookLabels.length} threshold=${MIN_LABEL_COUNT_FOR_FALLBACK} issueId=${issueId}`,
      );
      return { labels: webhookLabels };
    }

    this.logger?.log(
      `Webhook label count below fallback threshold, fetching full label set from Linear API labelCount=${webhookLabels.length} threshold=${MIN_LABEL_COUNT_FOR_FALLBACK} issueId=${issueId}`,
    );

    try {
      const result = await this.fetchIssueLabels(issueId);
      this.logger?.log(
        `Resolved labels via Linear API fallback resolvedCount=${result.labels.length} webhookCount=${webhookLabels.length} issueId=${issueId}`,
      );
      return { labels: result.labels, identifier: result.identifier };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.warn(
        `Linear API label fallback failed, using webhook-supplied labels instead: ${errorMsg} issueId=${issueId}`,
      );
      return { labels: webhookLabels };
    }
  }

  /**
   * Fetch issue assignee and team from Linear
   * Used by relay-service to resolve routing for agent session webhooks
   */
  async fetchIssueAssignee(
    issueId: string,
  ): Promise<{ assigneeId?: string; teamId?: string; teamKey?: string }> {
    if (!issueId) {
      throw new Error('issueId is required');
    }

    const { assignee, team } = await this.call(async (client) => {
      const issue = await client.issue(issueId);
      return { assignee: await issue?.assignee, team: await issue?.team };
    });

    return {
      assigneeId: assignee?.id,
      teamId: team?.id,
      teamKey: team?.key,
    };
  }

  /** The workspace the credentials belong to; webhooks carry it, scanned issues do not. */
  async getOrganizationId(): Promise<string> {
    const organization = await this.call((client) => client.organization);
    return organization.id;
  }

  /**
   * Issues in a project or team that carry `label` and sit in one of `states`, oldest first. Used by the
   * dispatcher's scanner to find work without waiting for a webhook.
   */
  async listLabeledIssues(query: ListIssuesQuery): Promise<ScannedIssue[]> {
    return this.call(async (client) => {
      const connection = await client.issues({
        first: query.limit,
        orderBy: PaginationOrderBy.CreatedAt,
        filter: {
          ...(query.projectId ? { project: { id: { eq: query.projectId } } } : {}),
          ...(query.teamKey ? { team: { key: { eq: query.teamKey } } } : {}),
          labels: { name: { eq: query.label } },
          state: { name: { in: query.states } },
        },
      });

      return Promise.all(
        connection.nodes.map(async (issue) => {
          const [labels, state, team] = await Promise.all([
            issue.labels(),
            issue.state,
            issue.team,
          ]);
          return {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            labels: labels.nodes.map((l) => l.name),
            teamKey: team?.key,
            assigneeId: issue.assigneeId ?? undefined,
            isTerminal: state?.type === 'completed' || state?.type === 'canceled',
          };
        }),
      );
    });
  }

  /**
   * When the issue last became a candidate for `label`: the later of the label being added and the
   * issue moving into the state it is in now. Undefined when its history says neither (the label
   * and state date from creation, or are older than the page fetched). Lets the scanner treat an
   * issue that had the label taken off and put back, or left its state and returned, as new work.
   */
  async getWatchStartedAt(issueId: string, label: string): Promise<Date | undefined> {
    return this.call(async (client) => {
      const issue = await client.issue(issueId);
      if (!issue) return undefined;
      const labelId = (await issue.labels()).nodes.find((l) => l.name === label)?.id;
      const history = await issue.history({ first: 50 });
      const times = history.nodes
        .filter(
          (entry) =>
            (issue.stateId !== undefined && entry.toStateId === issue.stateId) ||
            (labelId !== undefined && entry.addedLabelIds?.includes(labelId)),
        )
        .map((entry) => entry.createdAt.getTime());
      return times.length ? new Date(Math.max(...times)) : undefined;
    });
  }

  /**
   * Fetch issue labels from Linear
   * Used by dispatcher-service for label fallback when webhook labels incomplete
   */
  async fetchIssueLabels(issueId: string): Promise<IssueLabelsResponse> {
    if (!issueId) {
      throw new Error('issueId is required');
    }

    return this.call(async (client) => {
      const issue = await client.issue(issueId);
      if (!issue) return { labels: [] };

      const labelsConnection = await issue.labels();
      const labelNames = labelsConnection.nodes
        .map((label) => label.name)
        .filter((name): name is string => !!name && typeof name === 'string');

      return { labels: labelNames, identifier: issue.identifier };
    });
  }
}
