import { useEffect, useState } from 'react';
import { POLL_INTERVAL_MS } from '../constants';
import { fetchMonitorSnapshot, type MonitorSnapshot } from '../services/monitor-api.service';

/** Polls the dispatcher's monitor API. `snapshot` stays null until the first answer. */
export function useMonitorSnapshot(): { snapshot: MonitorSnapshot | null; error: string | null } {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let first = true;
    const poll = async (): Promise<void> => {
      try {
        // The first poll forces a live relay check so "Connected" is accurate on open.
        setSnapshot(await fetchMonitorSnapshot({ refreshRelay: first }));
        first = false;
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch data');
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { snapshot, error };
}
