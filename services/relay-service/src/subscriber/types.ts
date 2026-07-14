/**
 * DynamoDB record types for relay service
 */

export interface SubscriberRecord {
  subscriberId: string;
  teamKey: string;
  linearUserId: string;
  domains: Set<string>;
  localEndpoint: string;
  subscriberSecret: string;
  registeredAt: string;
  lastSeenAt: string;
  lastWebhookAt?: string; // Timestamp of last successful webhook delivery; used for stale cleanup
  version: number;
}
