import type { RunStatus } from './theme';

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
  };
  repos: Array<{
    repoPath: string;
    domainLabel: string;
    description?: string;
    modes: Array<{ label: string; skill: string }>;
    runningCount: number;
    currentRuns: Array<{ issueIdentifier: string; issueTitle?: string }>;
  }>;
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
  onRunScript: (script: 'connect-relay' | 'update-relay', args: string[]) => void;
  mode: 'idle' | 'connect' | 'update';
  setMode: (mode: 'idle' | 'connect' | 'update') => void;
}

export interface AppProps {
  onExit: () => void;
  onRunRelayScript: (script: 'connect-relay' | 'update-relay', args: string[]) => void;
}
