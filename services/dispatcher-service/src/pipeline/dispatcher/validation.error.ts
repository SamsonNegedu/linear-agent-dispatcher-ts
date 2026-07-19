/**
 * Validation error: expected failure that triggers user-facing feedback (comment/activity).
 * These are NOT bugs—they're handled gracefully by posting action-required messages to Linear.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Missing-mode-label-only failure: the issue has a valid domain label but no mode
 * label yet. Unlike other validation failures, this is a routine, frequent state
 * for issues still being triaged/refined — not a misconfiguration — so it's handled
 * silently (skip dispatch, no comment) instead of posting user-facing feedback.
 */
export class IncompleteLabelsError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteLabelsError';
  }
}
