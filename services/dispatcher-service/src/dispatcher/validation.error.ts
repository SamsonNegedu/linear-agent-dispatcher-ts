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
