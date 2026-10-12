import { useEffect, useState } from 'react';

/** The current time, refreshed every `intervalMs` so elapsed times keep ticking. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** A braille spinner frame while `active`, otherwise a still dot. */
export function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 100);
    return () => clearInterval(timer);
  }, [active]);
  return active ? FRAMES[frame] : '●';
}
