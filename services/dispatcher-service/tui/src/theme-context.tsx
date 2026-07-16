import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRenderer } from '@opentui/react';
import type { ThemeMode } from '@opentui/core';
import { darkPalette, lightPalette, type Palette } from './theme';

const ThemeContext = createContext<Palette>(darkPalette);

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

// Terminal OSC background-color queries don't succeed everywhere (some older
// terminals/multiplexers time out silently), so this always falls back to
// dark rather than leaving the mode undecided.
function useThemeMode(): ThemeMode {
  const renderer = useRenderer();
  const [mode, setMode] = useState<ThemeMode>(renderer.themeMode ?? 'dark');

  useEffect(() => {
    let cancelled = false;

    renderer
      .waitForThemeMode(1000)
      .then((detected) => {
        if (!cancelled && detected) setMode(detected);
      })
      .catch(() => {});

    const handleChange = (next: ThemeMode): void => setMode(next);
    renderer.on('theme_mode', handleChange);

    return () => {
      cancelled = true;
      renderer.off('theme_mode', handleChange);
    };
  }, [renderer]);

  return mode;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const mode = useThemeMode();
  const palette = mode === 'light' ? lightPalette : darkPalette;
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}
