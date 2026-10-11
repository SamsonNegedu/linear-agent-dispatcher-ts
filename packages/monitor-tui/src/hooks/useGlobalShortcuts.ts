import { useKeyboard } from '@opentui/react';
import { restartDispatcherServer } from '../services/dispatcher-process.service';
import { getConfig } from '../utils/config';

interface UseGlobalShortcutsOptions {
  onExit: () => void;
  onRestartStart: () => void;
  onRestartSettled: (error?: Error) => void;
}

export function useGlobalShortcuts({ onExit, onRestartStart, onRestartSettled }: UseGlobalShortcutsOptions): void {
  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      onExit();
      return;
    }
    if (key.ctrl && key.name === 'r') {
      onRestartStart();
      restartDispatcherServer(`http://localhost:${getConfig().port}/monitor/summary`, onRestartSettled);
    }
  });
}
