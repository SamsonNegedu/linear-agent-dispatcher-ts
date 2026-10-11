export const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

// Columns are measured in terminal cells, not characters: CJK and emoji take two cells,
// combining marks none. Counting characters misaligns every column after such text.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export const displayWidth = (text: string): number => Bun.stringWidth(text);

/** The longest prefix of `text` that fits in `width` cells, never splitting a character. */
const takeWidth = (text: string, width: number): string => {
  let taken = '';
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const w = displayWidth(segment);
    if (used + w > width) break;
    taken += segment;
    used += w;
  }
  return taken;
};

/** Fits `text` into `max` cells, ending with `…` when it had to be cut. */
export const truncate = (text: string, max: number): string => {
  if (max <= 0) return '';
  if (displayWidth(text) <= max) return text;
  return `${takeWidth(text, max - 1)}…`;
};

/**
 * Pads (or cuts) `text` to exactly `width` cells. Text that had to be cut gets one extra
 * trailing space, so a truncated cell never touches the next column.
 */
export const pad = (text: string, width: number): string => {
  const w = displayWidth(text);
  if (w <= width) return text + ' '.repeat(width - w);
  const cut = truncate(text, width);
  return cut + ' '.repeat(width - displayWidth(cut) + 1);
};
