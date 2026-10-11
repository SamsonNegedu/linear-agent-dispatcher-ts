export const validateTimestamp = (timestamp: number, windowMs: number = 5 * 60 * 1000): boolean => {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff <= windowMs;
};
