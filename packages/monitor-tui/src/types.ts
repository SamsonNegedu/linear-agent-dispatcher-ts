import type { RunStatus } from './theme';
import type { RelayScript } from './services/dispatcher-process.service';

export interface Run {
  id: string;
  issueIdentifier: string;
  issueTitle?: string;
  skill: string;
  repoPath: string;
  domainLabel: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  errorSnippet?: string;
  // 'scan' when the dispatcher's scanner started it; 'webhook' or 'label' otherwise.
  triggerSource?: string;
}

export interface MonitorSummary {
  counts: {
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    needs_input: number;
  };
  repos: Array<{
    repoPath: string;
    domainLabel: string;
    description?: string;
    // skillFound: true = on disk, false = missing, null = plugin skill (unchecked)
    issueLabelToSkill: Array<{ label: string; skill: string; skillFound: boolean | null }>;
    runningCount: number;
    currentRuns: Array<{ issueIdentifier: string; issueTitle?: string }>;
  }>;
}

export interface RelayHealth {
  enabled: boolean;
  configured: boolean;
  subscriberCheck: 'verified' | 'not_found' | 'unreachable' | null;
  lastCheckedAt: string | null;
}

export interface RelayFormField {
  key: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
}

/** What the Overview needs to open the relay connect and update forms. */
export interface RelayActions {
  onRunScript: (script: RelayScript, args: string[]) => void;
  mode: 'idle' | 'connect' | 'update';
  setMode: (mode: 'idle' | 'connect' | 'update') => void;
}

export interface AppProps {
  onExit: () => void;
  onRunRelayScript: (script: RelayScript, args: string[]) => void;
}

export type ScanOutcome =
  | 'dispatched'
  | 'active'
  | 'done'
  | 'needs_input'
  | 'cancelled'
  | 'exhausted'
  | 'waiting'
  | 'skipped'
  | 'closed';

export interface ScanIssue {
  identifier: string;
  title: string;
  skill?: string;
  outcome: ScanOutcome;
  detail?: string;
}

export interface ScannerReport {
  enabled: boolean;
  intervalSec?: number;
  lastScanAt?: string;
  durationMs?: number;
  scopes: Array<{
    name: string;
    maxConcurrent: number;
    inFlight: number;
    error?: string;
    watches: Array<{ label: string; states: string[]; issues: ScanIssue[] }>;
  }>;
}
