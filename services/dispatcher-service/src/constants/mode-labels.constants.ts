/**
 * Mode label routing constants.
 * Mode labels determine which Claude skill to invoke for an issue.
 * Format: agent-<skill-name> (e.g., agent-implement, agent-plan)
 *
 * Mode labels are REQUIRED on every issue. There is no default fallback.
 * This enforces explicit skill selection and prevents accidental misrouting.
 */

/**
 * Prefix for mode labels in Linear issues.
 * Issues MUST have exactly one label matching this pattern:
 * - agent-implement
 * - agent-plan
 * - agent-resume
 * - or custom modes defined in repos.config.json
 */
export const MODE_LABEL_PREFIX = 'agent-';

/**
 * Pattern to test if a label is a mode label.
 * Used to filter labels and validate mode label format.
 */
export const MODE_LABEL_PATTERN = /^[a-zA-Z0-9_-]+$/;
