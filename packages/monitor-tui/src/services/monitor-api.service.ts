import { getConfig } from '../utils/config';
import type { RunStatus } from '../theme';
import type { MonitorSummary, RelayHealth, Run } from '../types';

interface ApiResponse<T> {
  data: T;
}

async function get<T>(path: string): Promise<T> {
  const { port } = getConfig();
  const res = await fetch(`http://localhost:${port}${path}`);
  const body = (await res.json()) as ApiResponse<T>;
  return body.data;
}

export interface MonitorSnapshot {
  summary: MonitorSummary;
  activeRuns: Run[];
  queueRuns: Run[];
  completedRuns: Run[];
  failedRuns: Run[];
  needsInputRuns: Run[];
  relayHealth: RelayHealth;
}

interface StatusResponse {
  relay: RelayHealth;
}

function getRuns(status: RunStatus, limit: number): Promise<Run[]> {
  return get<Run[]>(`/monitor/runs?status=${status}&limit=${limit}`);
}

export async function fetchMonitorSnapshot(
  options: { refreshRelay?: boolean } = {},
): Promise<MonitorSnapshot> {
  const statusPath = options.refreshRelay ? '/status?refresh=true' : '/status';

  const [summary, activeRuns, queueRuns, completedRuns, failedRuns, needsInputRuns, status] =
    await Promise.all([
      get<MonitorSummary>('/monitor/summary'),
      getRuns('running', 50),
      getRuns('pending', 50),
      getRuns('succeeded', 20),
      getRuns('failed', 20),
      getRuns('needs_input', 20),
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
    completedRuns,
    failedRuns,
    needsInputRuns,
    relayHealth: status.relay,
  };
}
