export class DuplicatePayloadError extends Error {
  constructor(idempotencyKey: string) {
    super(`Duplicate payload: ${idempotencyKey}`);
    this.name = 'DuplicatePayloadError';
  }
}

export class ActiveRunError extends Error {
  constructor(issueId: string) {
    super(`Active run already exists for issue: ${issueId}`);
    this.name = 'ActiveRunError';
  }
}

export class RecentDuplicateRunError extends Error {
  constructor(issueId: string, withinMs: number) {
    super(`Recent run already exists for issue: ${issueId} (within ${withinMs}ms)`);
    this.name = 'RecentDuplicateRunError';
  }
}

export class DailyCapError extends Error {
  constructor(provider: string) {
    super(`Daily run cap exceeded for provider: ${provider}`);
    this.name = 'DailyCapError';
  }
}

export class NoSessionToResumeError extends Error {
  constructor(issueId: string) {
    super(`No session to resume for issue: ${issueId}`);
    this.name = 'NoSessionToResumeError';
  }
}
