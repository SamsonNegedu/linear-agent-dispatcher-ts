import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { IStoreRepository } from './store.interfaces';
import type { DispatcherConfig } from '../config/config';

// How often to sweep for stale runs while the process stays up. Independent
// of the run timeout itself (config.executor.timeout) — this only needs to
// be frequent enough that a stuck issue doesn't stay blocked for long, not
// tied to how long a single run is allowed to take.
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Sweeps for runs left in 'pending'/'running' status past the executor
 * timeout and marks them 'failed'.
 *
 * Without this, a run only ever leaves 'running' status via
 * ExecutorService's own completion path — if the dispatcher process crashes
 * or is killed mid-run, that row (and the per-issue "one active run" check
 * in TypeORMStoreRepository.enqueueRun) stays stuck forever, silently
 * rejecting every future webhook for that issue with ActiveRunError until
 * someone manually fixes the database row. Runs on startup (catches
 * crash-then-restart) and periodically (catches a hang without a restart).
 */
@Injectable()
export class StaleRunReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleRunReconciliationService.name);
  private intervalHandle?: ReturnType<typeof setInterval>;

  constructor(
    @Inject('IStoreRepository') private readonly store: IStoreRepository,
    @Inject('DispatcherConfig') private readonly config: DispatcherConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
    this.intervalHandle = setInterval(() => {
      this.reconcile().catch((error) => {
        this.logger.error('Stale run reconciliation sweep failed:', error);
      });
    }, RECONCILIATION_INTERVAL_MS);
    // Don't let the interval itself keep the process alive.
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  private async reconcile(): Promise<void> {
    const staleThresholdMs = this.config.executor.timeout;
    await this.store.reconcileStaleRuns(staleThresholdMs);
  }
}
