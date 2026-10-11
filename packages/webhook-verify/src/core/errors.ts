/**
 * Validation error: expected failure that triggers user-facing feedback (comment/activity).
 * These are NOT bugs—they're handled gracefully by posting action-required messages back
 * to the provider via DispatchAdapter.postFeedback.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Routing-incomplete failure: the event resolves to a valid provider/routing
 * target but is missing the tag(s) needed to fully resolve it (e.g. Linear's
 * mode label not set yet). Unlike other validation failures, this is a
 * routine, frequent state for issues still being triaged/refined — not a
 * misconfiguration — so it's handled silently (skip dispatch, no feedback)
 * instead of posting user-facing feedback.
 */
export class IncompleteLabelsError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteLabelsError';
  }
}
