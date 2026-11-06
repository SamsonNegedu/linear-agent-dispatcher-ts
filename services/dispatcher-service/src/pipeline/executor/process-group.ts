import type { Logger } from '@nestjs/common';
import { errorMessage } from '../../common/error-message';

// How long after SIGTERM before escalating to SIGKILL.
const SIGKILL_GRACE_MS = 10_000;

/**
 * process.kill() throws if the group already exited (a real race between the timeout and
 * the signal), and an uncaught throw in a timer callback would crash the whole dispatcher.
 */
export const killProcessGroup = (
  pid: number | undefined,
  signal: NodeJS.Signals,
  logger: Logger,
): void => {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const message = errorMessage(error);
    logger.debug(`killProcessGroup(${pid}, ${signal}) failed (likely already exited): ${message}`);
  }
};

/** SIGTERMs a process group, then SIGKILLs it if it is still alive after a grace period. */
export class ProcessGroupTerminator {
  private escalation: NodeJS.Timeout | null = null;

  constructor(
    private readonly pid: number | undefined,
    private readonly label: string,
    private readonly logger: Logger,
  ) {}

  terminate(reason: string): void {
    this.logger.warn(`Claude run ${reason}, sending SIGTERM: ${this.label} pid=${this.pid}`);
    killProcessGroup(this.pid, 'SIGTERM', this.logger);
    this.clear();
    this.escalation = setTimeout(() => {
      this.logger.error(
        `Claude run still alive ${SIGKILL_GRACE_MS}ms after SIGTERM, sending SIGKILL: ${this.label} pid=${this.pid}`,
      );
      killProcessGroup(this.pid, 'SIGKILL', this.logger);
    }, SIGKILL_GRACE_MS);
  }

  /** Call once the process has exited; the pending SIGKILL is no longer needed. */
  clear(): void {
    if (this.escalation) clearTimeout(this.escalation);
    this.escalation = null;
  }
}
