import { spawn } from 'child_process';

type Copier = { cmd: string; args: string[] };

const SYSTEM_COPIERS: Copier[] =
  process.platform === 'darwin'
    ? [{ cmd: 'pbcopy', args: [] }]
    : process.platform === 'win32'
      ? [{ cmd: 'clip', args: [] }]
      : [
          { cmd: 'wl-copy', args: [] },
          { cmd: 'xclip', args: ['-selection', 'clipboard'] },
          { cmd: 'xsel', args: ['--clipboard', '--input'] },
        ];

const tryCopier = (text: string, { cmd, args }: Copier): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.on('error', () => resolve(false));
    child.stdin.end(text);
  });

/**
 * Copy text to the system clipboard. Prefers the OS tool (works in every
 * terminal, including ones without OSC 52 such as Terminal.app), then falls
 * back to the terminal's OSC 52 escape (also works over SSH where supported).
 */
export async function copyToClipboard(
  text: string,
  osc52: (text: string) => boolean,
): Promise<boolean> {
  for (const copier of SYSTEM_COPIERS) {
    if (await tryCopier(text, copier)) return true;
  }
  return osc52(text);
}
