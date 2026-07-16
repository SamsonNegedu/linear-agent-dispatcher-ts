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
  status: 'pending' | 'running' | 'succeeded' | 'failed';
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
  dailyRunCap?: number;
  dedupeWindow?: number;
}

export interface CompleteRunInput {
  status: 'succeeded' | 'failed';
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
  getRunStats(sinceMs: number): Promise<{ lastWebhookAt: Date | null; byStatus: Record<Run['status'], number> }>;
}
