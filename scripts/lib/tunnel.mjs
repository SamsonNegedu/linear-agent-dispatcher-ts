/**
 * Public URL for the local relay, so Linear can reach it. In priority order:
 *   1. Cloudflare named tunnel  (CLOUDFLARE_TUNNEL_TOKEN + TUNNEL_HOSTNAME): stable, needs a domain
 *   2. Tailscale Funnel         (when tailscale is running): stable and free, no domain
 *   3. Cloudflare quick tunnel  (cloudflared installed): random URL every run
 * Returns { mode, url, stop }.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { killGroup, startService } from './stack.mjs';

const works = (bin, args = ['version']) => {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// The macOS app bundles its CLI outside PATH.
const TAILSCALE_BINS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

function runningTailscale() {
  const bin = TAILSCALE_BINS.find((b) => works(b));
  if (!bin) return null;
  try {
    const status = JSON.parse(execFileSync(bin, ['status', '--json'], { encoding: 'utf8' }));
    return status.BackendState === 'Running'
      ? { bin, host: status.Self.DNSName.replace(/\.$/, '') }
      : null;
  } catch {
    return null;
  }
}

async function quickTunnelUrl(logFile, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
    const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) return match[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for the Cloudflare tunnel URL; see ${logFile}`);
}

export async function startTunnel({ port, env, logFile }) {
  if (env.CLOUDFLARE_TUNNEL_TOKEN && env.TUNNEL_HOSTNAME) {
    if (!works('cloudflared'))
      throw new Error('cloudflared is not installed (brew install cloudflared)');
    // The token goes in the environment, not the arguments, so it stays out of `ps`.
    const child = startService({
      command: 'cloudflared',
      args: ['tunnel', '--no-autoupdate', 'run'],
      env: { ...process.env, TUNNEL_TOKEN: env.CLOUDFLARE_TUNNEL_TOKEN },
      logFile,
    });
    return { mode: 'named', url: `https://${env.TUNNEL_HOSTNAME}`, stop: () => killGroup(child) };
  }

  const tailscale = runningTailscale();
  if (tailscale) {
    try {
      execFileSync(tailscale.bin, ['funnel', '--bg', String(port)], { stdio: 'inherit' });
    } catch {
      throw new Error(
        'Could not enable Tailscale Funnel. Enable it for your tailnet (admin console > Access controls > funnel) and retry.',
      );
    }
    return {
      mode: 'tailscale',
      url: `https://${tailscale.host}`,
      stop: () => {
        try {
          execFileSync(tailscale.bin, ['funnel', '--https=443', 'off'], { stdio: 'ignore' });
        } catch {}
      },
    };
  }

  if (works('cloudflared')) {
    const child = startService({
      command: 'cloudflared',
      args: ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`],
      logFile,
    });
    try {
      return { mode: 'quick', url: await quickTunnelUrl(logFile), stop: () => killGroup(child) };
    } catch (error) {
      killGroup(child);
      throw error;
    }
  }

  throw new Error(
    'No tunnel available. Install Tailscale (recommended: free, stable URL) or cloudflared (brew install cloudflared).',
  );
}
