import * as crypto from 'crypto';

/**
 * Constant-time string comparison that never throws.
 *
 * `crypto.timingSafeEqual` throws a RangeError when its inputs differ in length, so a
 * malformed or truncated signature header would crash the handler (and leak the expected
 * length). Hashing both sides first gives equal-length inputs for any pair of strings.
 * A missing value is simply a mismatch.
 */
export const safeEqual = (received: string | undefined | null, expected: string): boolean => {
  if (typeof received !== 'string') return false;
  const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(received), digest(expected));
};
