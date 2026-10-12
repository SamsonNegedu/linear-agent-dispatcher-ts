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

/** "just now", "5m ago", "3h ago", "2d ago". */
export const ago = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/**
 * Column widths for a row `total` cells wide. Numbers are fixed widths; 'flex' columns split
 * what is left (never below `minFlex`), so a title column grows with the terminal instead of
 * being cut at a fixed length. `gap` cells separate neighbouring columns.
 */
export const columnWidths = (
  total: number,
  columns: Array<number | 'flex'>,
  { gap = 2, minFlex = 10 }: { gap?: number; minFlex?: number } = {},
): number[] => {
  const shown = columns.filter((c) => c !== 0); // a 0-width column is hidden: no width, no gap
  const fixed = shown.reduce<number>((sum, c) => sum + (c === 'flex' ? 0 : c), 0);
  const flexCount = shown.filter((c) => c === 'flex').length;
  const free = total - fixed - gap * Math.max(0, shown.length - 1);
  const flex = flexCount ? Math.max(minFlex, Math.floor(free / flexCount)) : 0;
  return columns.map((c) => (c === 'flex' ? flex : c));
};

/** Exactly `width` cells: cut with an ellipsis if too long, padded if short (no extra gutter). */
export const fit = (text: string, width: number): string => {
  const cut = truncate(text, width);
  return cut + ' '.repeat(Math.max(0, width - displayWidth(cut)));
};
