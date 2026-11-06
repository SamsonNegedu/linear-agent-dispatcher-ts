/** What happened to an issue the scanner saw on its last pass. */
export type ScanOutcome =
  | 'dispatched' // enqueued on this pass
  | 'active' // a run is queued or running
  | 'done' // a run of this skill succeeded
  | 'needs_input' // a run stopped to ask a question
  | 'cancelled' // a run was stopped on purpose
  | 'exhausted' // failed maxAttempts times
  | 'waiting' // eligible, but the scope has no free slot
  | 'skipped' // would not route; `detail` says why
  | 'closed'; // issue is completed or canceled

export interface ScanIssueReport {
  identifier: string;
  title: string;
  skill?: string;
  outcome: ScanOutcome;
  detail?: string;
}

export interface ScanWatchReport {
  label: string;
  states: string[];
  issues: ScanIssueReport[];
}

export interface ScanScopeReport {
  /** `team:DLA` or `project:<id>`. */
  name: string;
  maxConcurrent: number;
  inFlight: number;
  watches: ScanWatchReport[];
  /** Set when the scope could not be scanned. */
  error?: string;
}

/** The scanner's last pass, for the monitor. In memory only; a restart starts it empty. */
export interface ScannerReport {
  enabled: boolean;
  intervalSec?: number;
  lastScanAt?: string;
  durationMs?: number;
  scopes: ScanScopeReport[];
}
