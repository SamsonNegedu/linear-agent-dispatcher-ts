export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'needs_input';

export interface Palette {
  pending: string;
  running: string;
  succeeded: string;
  failed: string;
  needs_input: string;
  muted: string;
  accent: string;
  text: string;
  selectedBg: string;
  selectedFg: string;
  // Panel outlines (quiet, so the accent can mean "focus") and the highlighted list row.
  border: string;
  rowSelected: string;
}

export const darkPalette: Palette = {
  pending: '#F5C542',
  running: '#4FC3F7',
  succeeded: '#4ADE80',
  failed: '#FF6B6B',
  needs_input: '#FB923C',
  muted: '#8A8F98',
  accent: '#22D3EE',
  text: '#E6E6E6',
  selectedBg: '#22D3EE',
  selectedFg: '#0B0F14',
  border: '#3B4252',
  rowSelected: '#1E3A47',
};

export const lightPalette: Palette = {
  pending: '#B8860B',
  running: '#0B6FB8',
  succeeded: '#16A34A',
  failed: '#DC2626',
  needs_input: '#C2410C',
  muted: '#6B7280',
  accent: '#0E7490',
  text: '#1A1A1A',
  selectedBg: '#0E7490',
  selectedFg: '#FFFFFF',
  border: '#C5CCD6',
  rowSelected: '#D5ECF3',
};

export const statusColor = (palette: Palette, status: RunStatus): string => palette[status];
