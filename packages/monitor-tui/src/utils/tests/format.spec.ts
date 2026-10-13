import { describe, expect, test } from 'bun:test';
import { displayWidth, formatTime, pad, truncate } from '../format';

describe('displayWidth', () => {
  test('counts terminal cells, not characters', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本語')).toBe(6);
    expect(displayWidth('🚀')).toBe(2);
    expect(displayWidth('é')).toBe(1); // e + combining acute
  });
});

describe('truncate', () => {
  test('leaves text that fits untouched', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('cuts with an ellipsis, staying within the width', () => {
    expect(truncate('hello world', 6)).toBe('hello…');
  });

  test('never splits a wide character or exceeds the width', () => {
    const cut = truncate('日本語テキスト', 6);
    expect(displayWidth(cut)).toBeLessThanOrEqual(6);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncate('日本語テキスト', 6)).toBe('日本…');
  });

  test('does not split an emoji with a skin-tone modifier', () => {
    expect(truncate('👍🏽 nice work', 3)).toBe('👍🏽…');
  });

  test('gives an empty string for a non-positive width', () => {
    expect(truncate('hello', 0)).toBe('');
    expect(truncate('hello', -3)).toBe('');
  });
});

describe('pad', () => {
  test('pads short text to the width', () => {
    expect(pad('ab', 5)).toBe('ab   ');
    expect(displayWidth(pad('日本', 6))).toBe(6);
  });

  test('cuts long text and adds a one-cell gutter so it never touches the next column', () => {
    const cell = pad('hello world', 6);
    expect(cell).toBe('hello… ');
    expect(displayWidth(cell)).toBe(7);
  });

  test('keeps cut wide text aligned with the same total width', () => {
    expect(displayWidth(pad('日本語テキスト', 6))).toBe(7);
    expect(displayWidth(pad('abcdefghij', 6))).toBe(7);
  });
});

describe('formatTime', () => {
  test('formats seconds, minutes and hours', () => {
    expect(formatTime(5_000)).toBe('5s');
    expect(formatTime(65_000)).toBe('1m 5s');
    expect(formatTime(3_660_000)).toBe('1h 1m');
  });
});

import { ago, columnWidths, fit } from '../format';

describe('ago', () => {
  test('uses the coarsest sensible unit', () => {
    expect(ago(3_000)).toBe('just now');
    expect(ago(42_000)).toBe('42s ago');
    expect(ago(5 * 60_000)).toBe('5m ago');
    expect(ago(3 * 3_600_000)).toBe('3h ago');
    expect(ago(2 * 86_400_000)).toBe('2d ago');
  });
});

describe('columnWidths', () => {
  test('gives the flex column whatever the fixed columns and gaps leave', () => {
    expect(columnWidths(100, [10, 'flex', 8])).toEqual([10, 78, 8]); // 100 - 18 - 2 gaps*2
  });

  test('never shrinks the flex column below its minimum', () => {
    expect(columnWidths(20, [10, 'flex', 8], { minFlex: 12 })).toEqual([10, 12, 8]);
  });

  test('splits the space between several flex columns', () => {
    expect(columnWidths(50, ['flex', 'flex'], { gap: 2 })).toEqual([24, 24]);
  });
});

describe('fit', () => {
  test('always yields exactly the requested width, so columns never drift', () => {
    for (const text of [
      'ab',
      'exactly10!',
      'much longer than the column',
      '日本語テキストです',
      '',
    ]) {
      expect(displayWidth(fit(text, 10))).toBe(10);
    }
    expect(fit('hello world', 6)).toBe('hello…');
  });
});
