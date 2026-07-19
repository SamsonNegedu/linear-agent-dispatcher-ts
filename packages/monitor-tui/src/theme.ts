export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface Palette {
  pending: string;
  running: string;
  succeeded: string;
  failed: string;
  muted: string;
  accent: string;
  text: string;
  selectedBg: string;
  selectedFg: string;
}

export const darkPalette: Palette = {
  pending: '#F5C542',
  running: '#4FC3F7',
  succeeded: '#4ADE80',
  failed: '#FF6B6B',
  muted: '#8A8F98',
  accent: '#22D3EE',
  text: '#E6E6E6',
  selectedBg: '#22D3EE',
  selectedFg: '#0B0F14',
};

export const lightPalette: Palette = {
  pending: '#B8860B',
  running: '#0B6FB8',
  succeeded: '#16A34A',
  failed: '#DC2626',
  muted: '#6B7280',
  accent: '#0E7490',
  text: '#1A1A1A',
  selectedBg: '#0E7490',
  selectedFg: '#FFFFFF',
};

export const statusColor = (palette: Palette, status: RunStatus): string => palette[status];
