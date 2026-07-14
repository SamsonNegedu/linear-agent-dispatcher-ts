export interface WebhookResponse {
  received: boolean;
  message?: string;
  error?: string;
  subscribersNotified?: number;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  timestamp: string;
  subscriberId: string;
  teamKey: string;
  webhookId: string;
  issueId: string;
  issueIdentifier: string;
  status: 'success' | 'timeout' | 'unreachable' | 'verification_failed';
  responseTime?: number;
  errorMessage?: string;
  linearAssigneeId?: string;
  ttl?: number;
}
