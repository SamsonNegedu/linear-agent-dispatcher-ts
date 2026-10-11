import { buildUpdateExpression } from './update-expression.util';

describe('buildUpdateExpression', () => {
  it('builds a SET expression with placeholder names and values', () => {
    expect(buildUpdateExpression({ status: 'active', retries: 2 })).toEqual({
      expression: 'SET #k0 = :v0, #k1 = :v1',
      names: { '#k0': 'status', '#k1': 'retries' },
      values: { ':v0': 'active', ':v1': 2 },
    });
  });

  it('aliases attribute names so reserved words like "status" and "name" are safe', () => {
    const result = buildUpdateExpression({ name: 'x' });

    expect(result?.expression).not.toContain('name');
    expect(result?.names['#k0']).toBe('name');
  });

  it('skips undefined values but keeps null, false and 0', () => {
    const result = buildUpdateExpression({ a: undefined, b: null, c: false, d: 0 });

    expect(result?.names).toEqual({ '#k0': 'b', '#k1': 'c', '#k2': 'd' });
    expect(result?.values).toEqual({ ':v0': null, ':v1': false, ':v2': 0 });
  });

  it('returns undefined when there is nothing to update', () => {
    expect(buildUpdateExpression({})).toBeUndefined();
    expect(buildUpdateExpression({ a: undefined })).toBeUndefined();
  });

  it('is not limited to 26 attributes', () => {
    const attributes = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`attr${i}`, i]));
    const result = buildUpdateExpression(attributes);

    expect(Object.keys(result!.names)).toHaveLength(40);
    expect(result!.expression.startsWith('SET #k0 = :v0, #k1 = :v1')).toBe(true);
  });
});
