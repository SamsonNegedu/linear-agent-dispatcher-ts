import { useKeyboard } from '@opentui/react';
import { restartDispatcherServer } from '../services/dispatcher-process.service';

interface UseGlobalShortcutsOptions {
  onExit: () => void;
  onRestartStart: () => void;
  onRestartSettled: () => void;
}

export function useGlobalShortcuts({ onExit, onRestartStart, onRestartSettled }: UseGlobalShortcutsOptions): void {
  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      onExit();
      return;
    }
    if (key.ctrl && key.name === 'r') {
      onRestartStart();
      restartDispatcherServer(onRestartSettled);
    }
  });
}
