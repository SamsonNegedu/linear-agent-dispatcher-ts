import { chunk } from './chunk.util';

describe('chunk', () => {
  it('splits into chunks of the given size, with a shorter last chunk', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when the input is smaller than the size', () => {
    expect(chunk([1, 2], 25)).toEqual([[1, 2]]);
  });

  it('returns no chunks for an empty input, so callers send no empty request', () => {
    expect(chunk([], 25)).toEqual([]);
  });

  it('does not mutate the input or share references between chunks', () => {
    const input = [1, 2, 3];
    const result = chunk(input, 2);
    result[0].push(99);

    expect(input).toEqual([1, 2, 3]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid size (%s)', (size) => {
    expect(() => chunk([1], size)).toThrow(RangeError);
  });
});
