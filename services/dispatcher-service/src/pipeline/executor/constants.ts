// Max length for error text surfaced to Linear (activity/comment bodies) or
// captured from a child process's stderr. Shared so all three truncation
// sites use one source of truth instead of independently-chosen magic
// numbers that happen to coincide.
export const MAX_ERROR_MESSAGE_LENGTH = 500;
