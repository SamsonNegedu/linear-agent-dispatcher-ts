import * as crypto from 'crypto';

// Relay-specific verification: HMAC signature for relay→dispatcher webhooks

export const signWebhookPayload = (payload: string, secret: string): string => {
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hmac}`;
};

export const verifyWebhookSignature = (
  payload: string,
  signature: string,
  secret: string,
): boolean => {
  const expected = signWebhookPayload(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};
