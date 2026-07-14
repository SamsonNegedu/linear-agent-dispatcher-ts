import { VerifiedEvent } from '@webhook-verify/core';
import { MODE_LABEL_PREFIX } from '../constants/mode-labels.constants';

export class LabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelValidationError';
  }
}

export class LabelTriggerService {
  private static readonly logger = console;

  /**
   * Check if this webhook is a label trigger event.
   * Label triggers are Issue webhooks where a mode label was added.
   */
  static isLabelTrigger(event: VerifiedEvent): boolean {
    // Must be an Issue webhook with label changes
    if (event.type !== 'Issue' || !event.labelChange) {
      return false;
    }

    // Must have a mode label in the added labels
    const modeLabelsAdded = event.labelChange.added.filter((label) =>
      label.startsWith(MODE_LABEL_PREFIX),
    );

    return modeLabelsAdded.length > 0;
  }

  /**
   * Validate that the issue has exactly one domain label and exactly one mode label.
   * Throws LabelValidationError if validation fails.
   */
  static validateLabels(labels: string[]): { domainLabel: string; modeLabel: string } {
    const modeLabels = labels.filter((label) => label.startsWith(MODE_LABEL_PREFIX));

    if (modeLabels.length === 0) {
      throw new LabelValidationError(
        `Issue is missing a required mode label (e.g., agent-implement, agent-plan, agent-resume). ` +
          `Add exactly one mode label to the issue in Linear.`,
      );
    }

    if (modeLabels.length > 1) {
      throw new LabelValidationError(
        `Issue has multiple mode labels: ${modeLabels.join(', ')}. ` +
          `Issues must have exactly one mode label.`,
      );
    }

    const modeLabel = modeLabels[0];

    // Note: Domain label validation is delegated to dispatcher's resolveRepoPath()
    // which returns default if no domain label found. This is intentional — label
    // trigger should work with default repo too.
    const domainLabel = this.findDomainLabel(labels);

    this.logger.debug(`Label trigger validated: domain="${domainLabel}", mode="${modeLabel}"`);

    return { domainLabel, modeLabel };
  }

  /**
   * Find the domain label in the issue labels.
   * Returns an empty string if no domain label found (uses default repo).
   */
  private static findDomainLabel(labels: string[]): string {
    // Filter out mode labels and return non-prefix labels as potential domain labels
    // Note: Full domain label resolution happens in dispatcher.resolveRepoPath()
    // This just identifies which label is being used for routing
    for (const label of labels) {
      if (!label.startsWith(MODE_LABEL_PREFIX)) {
        return label;
      }
    }
    return ''; // Will use default repo
  }
}
