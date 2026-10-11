import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { DispatcherConfig } from '../../config/config';
import { errorMessage } from '../../common/error-message';

// How often to re-verify the subscriber against relay-service while the
// process stays up. Deliberately independent of (and much slower than) the
// monitor-tui's own poll interval — the TUI just reads whatever is cached
// here rather than triggering a relay-service call on every poll.
const VERIFY_INTERVAL_MS = 60 * 1000;
const VERIFY_TIMEOUT_MS = 5 * 1000;

type SubscriberCheckResult =
  | 'verified' // relay-service confirmed the subscriber exists (200)
  | 'not_found' // relay-service confirmed the subscriber is gone (404)
  | 'unreachable'; // no trustworthy answer: network failure, timeout, or any
// other non-2xx (5xx, or a 502/503/504 from a dead proxy/tunnel). Always
// falls back here rather than reusing the last good result — a broken
// tunnel must never be able to keep showing "verified" just because the
// previous check happened to succeed.

interface RelayHealthStatus {
  // null until the first check completes, or when relay isn't configured at all.
  result: SubscriberCheckResult | null;
  lastCheckedAt: string | null;
  error: string | null;
}

/**
 * Periodically confirms the subscriber this dispatcher holds credentials for
 * still exists in relay-service, rather than trusting the RELAY_ENABLED env
 * flag set once by `connect-relay` forever after. Without this, the
 * monitor-tui's "Connected" indicator stays green even after relay-service
 * reaps the subscriber (see SubscriberRegistry.deleteStaleSubscribers).
 */
@Injectable()
export class RelayHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayHealthService.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private status: RelayHealthStatus = { result: null, lastCheckedAt: null, error: null };
  // Dedupes concurrent on-demand refreshes (e.g. several monitor-tui first-polls
  // arriving close together) into a single relay-service call.
  private pendingVerify?: Promise<void>;

  constructor(@Inject('DispatcherConfig') private readonly config: DispatcherConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.relay.enabled) return;

    await this.verify();
    this.intervalHandle = setInterval(() => {
      void this.verify();
    }, VERIFY_INTERVAL_MS);
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  getStatus(): RelayHealthStatus {
    return this.status;
  }

  // On-demand check for callers that need a value fresher than the next
  // scheduled tick (e.g. monitor-tui's first poll after opening).
  async refresh(): Promise<RelayHealthStatus> {
    if (!this.config.relay.enabled) return this.status;

    if (!this.pendingVerify) {
      this.pendingVerify = this.verify().finally(() => {
        this.pendingVerify = undefined;
      });
    }
    await this.pendingVerify;
    return this.status;
  }

  private async verify(): Promise<void> {
    const { url, subscriberId } = this.config.relay;
    if (!url || !subscriberId) {
      this.setStatus('unreachable', 'RELAY_URL or RELAY_SUBSCRIBER_ID not configured');
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, '')}/subscribers/${subscriberId}`, {
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
    } catch (error) {
      const errorMsg = errorMessage(error);
      this.logger.warn(`Relay-service unreachable: ${errorMsg}`);
      this.setStatus('unreachable', errorMsg);
      return;
    }

    if (res.status === 404) {
      this.setStatus('not_found', null);
      return;
    }
    if (!res.ok) {
      const errorMsg = `Relay responded with ${res.status}`;
      this.logger.warn(errorMsg);
      this.setStatus('unreachable', errorMsg);
      return;
    }

    this.setStatus('verified', null);
  }

  private setStatus(result: SubscriberCheckResult, error: string | null): void {
    this.status = { result, lastCheckedAt: new Date().toISOString(), error };
  }
}
