export interface Run {
  id: string;
  provider: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle?: string;
  webhookId: string;
  domainLabel: string;
  repoPath: string;
  skill: string;
  // needs_input: the agent stopped on purpose to ask a question (final reply starts with "Stop rule:")
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'needs_input';
  claudeSessionId?: string;
  exitCode?: number;
  errorSnippet?: string;
  worktreePath?: string;
  processPgid?: number;
  startedAt: Date;
  finishedAt?: Date;
  triggerSource: string;
  providerSessionId?: string;
}

export interface EnqueueRunInput {
  provider: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle?: string;
  idempotencyKey: string;
  webhookId: string;
  domainLabel: string;
  repoPath: string;
  skill: string;
  triggerSource: string;
  providerSessionId?: string;
  // Minimum time since the last run for this (issue, domain, skill) before a
  // new one is rejected as a duplicate. Caller-provided (from
  // RoutingConfigService's policy) rather than defaulted here, so there's a
  // single source of truth for the value.
  dedupeWindowMs: number;
}

export interface CompleteRunInput {
  status: 'succeeded' | 'failed' | 'needs_input';
  claudeSessionId?: string;
  exitCode?: number;
  errorSnippet?: string;
}

export interface IStoreRepository {
  enqueueRun(input: EnqueueRunInput): Promise<Run>;
  getRun(id: string): Promise<Run | null>;
  getLatestRunWithSession(provider: string, issueId: string): Promise<Run | null>;
  getLatestRunWithSessionForAgent(
    provider: string,
    issueId: string,
    sessionId: string,
  ): Promise<Run | null>;
  listRuns(limit: number): Promise<Run[]>;
  listRunsByStatus(status: Run['status'], limit: number): Promise<Run[]>;
  hasActiveRun(provider: string, issueId: string): Promise<boolean>;
  markRunning(id: string, pgid?: number): Promise<void>;
  completeRun(id: string, out: CompleteRunInput): Promise<void>;
  reconcileStaleRuns(olderThanMs: number): Promise<void>;
  ping(): Promise<void>;
  getRunStats(
    sinceMs: number,
  ): Promise<{ lastWebhookAt: Date | null; byStatus: Record<Run['status'], number> }>;
}
