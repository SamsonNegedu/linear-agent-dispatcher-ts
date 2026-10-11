import * as crypto from 'crypto';
import { safeEqual } from '../core/safe-equal';

// Relay-specific verification: HMAC signature for relay→dispatcher webhooks

export const signWebhookPayload = (payload: string, secret: string): string => {
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hmac}`;
};

export const verifyWebhookSignature = (
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean => safeEqual(signature, signWebhookPayload(payload, secret));
