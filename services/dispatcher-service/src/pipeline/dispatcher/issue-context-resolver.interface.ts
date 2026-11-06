import type { NormalizedEvent } from '@webhook-verify/core';

/** What the dispatcher needs to know about an issue that its webhook did not carry. */
export interface IssueContext {
  labels: string[];
  identifier?: string;
}

/**
 * Backfills what a provider's webhook left out (labels, identifier) by calling its API. One
 * implementation per provider, looked up by `event.provider`. A provider whose webhooks always
 * carry everything needs none: the dispatcher then uses the webhook's own tags.
 */
export interface IssueContextResolver {
  readonly provider: string;
  resolveIssueContext(event: NormalizedEvent): Promise<IssueContext>;
}

/** Injection token for the `AdapterRegistry<IssueContextResolver>` provider. */
export const ISSUE_CONTEXT_RESOLVER_REGISTRY = Symbol('IssueContextResolverRegistry');
