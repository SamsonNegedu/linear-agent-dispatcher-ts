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
