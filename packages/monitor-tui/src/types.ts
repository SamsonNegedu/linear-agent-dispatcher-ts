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

export interface RowColumn {
  label: string;
  width: number;
}

export interface RelayFormField {
  key: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
}

export interface RelayTabProps {
  onRunScript: (script: RelayScript, args: string[]) => void;
  mode: 'idle' | 'connect' | 'update';
  setMode: (mode: 'idle' | 'connect' | 'update') => void;
  relayHealth: RelayHealth | null;
}

export interface AppProps {
  onExit: () => void;
  onRunRelayScript: (script: RelayScript, args: string[]) => void;
}
