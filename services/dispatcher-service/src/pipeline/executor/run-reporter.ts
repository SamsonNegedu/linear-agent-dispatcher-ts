/** Where a report goes: the agent session when there is one, otherwise the issue itself. */
export interface FeedbackTarget {
  issueId?: string;
  sessionId?: string;
}

/**
 * Tells the user what a run is doing, on the tracker the run came from. One implementation per
 * provider, looked up by `event.provider` in the registry under RUN_REPORTER_REGISTRY. Reporting
 * never throws: a tracker outage must not fail a run.
 */
export interface RunReporter {
  readonly provider: string;
  started(
    target: FeedbackTarget,
    run: { repoLabel: string; skill: string; runId: string; issueIdentifier?: string },
  ): Promise<void>;
  succeeded(target: FeedbackTarget, summary: string): Promise<void>;
  failed(target: FeedbackTarget, message: string): Promise<void>;
  cancelled(target: FeedbackTarget): Promise<void>;
  /** Something the user must fix or answer: missing labels, a stopped run's question. */
  needsInput(target: FeedbackTarget, message: string): Promise<void>;
  /** A run was not started because one is already in progress. */
  skipped(target: FeedbackTarget, message: string): Promise<void>;
}

/** Injection token for the `AdapterRegistry<RunReporter>` provider. */
export const RUN_REPORTER_REGISTRY = Symbol('RunReporterRegistry');
