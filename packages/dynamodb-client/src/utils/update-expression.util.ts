export interface UpdateExpressionParts {
  /** e.g. `SET #k0 = :v0, #k1 = :v1` */
  expression: string;
  /** Maps each `#kN` placeholder to the real attribute name (safe for reserved words). */
  names: Record<string, string>;
  /** Maps each `:vN` placeholder to its value. */
  values: Record<string, unknown>;
}

/**
 * Builds a DynamoDB `SET` update expression from a plain object.
 *
 * - Attributes whose value is `undefined` are skipped ("no change"), since DynamoDB
 *   cannot store `undefined`.
 * - Returns `undefined` when there is nothing to update, because an empty
 *   UpdateExpression is rejected by DynamoDB; callers should skip the request.
 */
export function buildUpdateExpression<T extends object>(
  attributes: Partial<T>,
): UpdateExpressionParts | undefined {
  const entries = Object.entries(attributes as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return undefined;

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const assignments = entries.map(([attribute, value], i) => {
    names[`#k${i}`] = attribute;
    values[`:v${i}`] = value;
    return `#k${i} = :v${i}`;
  });

  return { expression: `SET ${assignments.join(', ')}`, names, values };
}
