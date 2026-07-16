/**
 * Mode label validation patterns.
 * Mode labels determine which Claude skill to invoke for an issue.
 * Teams define their own mode labels in repos.config.json (any naming convention is allowed).
 * Examples: agent-implement, ready-for-agent, claude-refactor, skill-test, etc.
 */

/**
 * Pattern to test if a string is a valid label format.
 * Used to validate label format in repos.config.json.
 */
export const MODE_LABEL_PATTERN = /^[a-zA-Z0-9_-]+$/;
