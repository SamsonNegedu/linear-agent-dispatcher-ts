import { describe, expect, test } from 'bun:test';
import { displayWidth, formatTime, pad, truncate } from './format';

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
