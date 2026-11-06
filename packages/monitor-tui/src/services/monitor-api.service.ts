import { getConfig } from '../utils/config';
import type { RunStatus } from '../theme';
import type { MonitorSummary, RelayHealth, Run, ScannerReport } from '../types';

interface ApiResponse<T> {
  data: T;
}

async function get<T>(path: string): Promise<T> {
  const { port } = getConfig();
  const res = await fetch(`http://localhost:${port}${path}`);
  const body = (await res.json()) as ApiResponse<T>;
  return body.data;
}

/** Asks the dispatcher to stop a running run. Resolves with an error message, or null on success. */
export async function cancelRun(runId: string): Promise<string | null> {
  const { port } = getConfig();
  try {
    const res = await fetch(
      `http://localhost:${port}/monitor/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: 'POST',
      },
    );
    if (res.ok) return null;
    if (res.status === 404) return 'Run not found';
    if (res.status === 409) return 'Run is no longer running';
    return `Dispatcher answered ${res.status}`;
  } catch {
    return 'Could not reach the dispatcher';
  }
}

export interface MonitorSnapshot {
  summary: MonitorSummary;
  activeRuns: Run[];
  queueRuns: Run[];
  completedRuns: Run[];
  failedRuns: Run[];
  needsInputRuns: Run[];
  relayHealth: RelayHealth;
  scanner: ScannerReport;
}

interface StatusResponse {
  relay: RelayHealth;
}

const SCANNER_OFF: ScannerReport = { enabled: false, scopes: [] };

function getRuns(status: RunStatus, limit: number): Promise<Run[]> {
  return get<Run[]>(`/monitor/runs?status=${status}&limit=${limit}`);
}

export async function fetchMonitorSnapshot(
  options: { refreshRelay?: boolean } = {},
): Promise<MonitorSnapshot> {
  const statusPath = options.refreshRelay ? '/status?refresh=true' : '/status';

  const [
    summary,
    activeRuns,
    queueRuns,
    succeededRuns,
    cancelledRuns,
    failedRuns,
    needsInputRuns,
    scanner,
    status,
  ] = await Promise.all([
    get<MonitorSummary>('/monitor/summary'),
    getRuns('running', 50),
    getRuns('pending', 50),
    getRuns('succeeded', 20),
    getRuns('cancelled', 20),
    getRuns('failed', 20),
    getRuns('needs_input', 20),
    // A dispatcher from before the scanner has no such route; the tab then reads as off.
    get<ScannerReport>('/monitor/scanner').catch(() => SCANNER_OFF),
    // /status is cheap even at 1s poll cadence — the dispatcher only reads a
    // value RelayHealthService caches from its own slower background check
    // against relay-service, it doesn't hit relay-service per request. The
    // exception is refreshRelay, passed only on the TUI's first poll, which
    // forces one on-demand relay-service call so "Connected" reflects reality
    // as soon as the monitor opens rather than whatever was last cached.
    get<StatusResponse>(statusPath),
  ]);

  return {
    summary,
    activeRuns,
    queueRuns,
    completedRuns: [...succeededRuns, ...cancelledRuns],
    failedRuns,
    needsInputRuns,
    relayHealth: status.relay,
    scanner: scanner?.scopes ? scanner : SCANNER_OFF,
  };
}
