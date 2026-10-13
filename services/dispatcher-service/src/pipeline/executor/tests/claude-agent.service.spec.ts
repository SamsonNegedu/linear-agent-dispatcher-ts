import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { Test } from '@nestjs/testing';
import { ClaudeAgentService, isStopRuleReply } from '../claude-agent.service';
import { McpServerDiscoveryService } from '../mcp-server-discovery.service';
import { ExecutorModule } from '../executor.module';
import { FakeStoreModule } from '../../../test-utils/fake-store.module';
import { StoreModule } from '../../../store/store.module';
import { DispatcherConfigModule } from '../../../config/dispatcher-config.module';
import type { DispatcherConfig } from '../../../config/config';
import { makeDispatcherConfig } from '../../../test-utils/dispatcher-config';

jest.mock('child_process');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ on: jest.fn(), write: jest.fn(), end: jest.fn() })),
}));

const mockSpawn = spawn as jest.Mock;

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 1234;
}

const makeConfig = (overrides: Partial<DispatcherConfig['executor']> = {}): DispatcherConfig =>
  makeDispatcherConfig({
    executor: {
      claudeBinPath: 'claude',
      allowedEnvVars: ['PATH'],
      timeout: 1_800_000,
      ...overrides,
    },
    linear: {},
  });

const mcpAllowRules = jest.fn<Promise<string[]>, [string]>();

async function buildService(
  overrides: Partial<DispatcherConfig['executor']> = {},
): Promise<ClaudeAgentService> {
  const module = await Test.createTestingModule({
    imports: [ExecutorModule, DispatcherConfigModule],
  })
    .overrideModule(StoreModule)
    .useModule(FakeStoreModule)
    .overrideProvider('DispatcherConfig')
    .useValue(makeConfig(overrides))
    .overrideProvider(McpServerDiscoveryService)
    .useValue({ allowRules: mcpAllowRules })
    .compile();

  return module.get(ClaudeAgentService);
}

describe('ClaudeAgentService.spawn', () => {
  let child: FakeChildProcess;

  beforeEach(() => {
    jest.useFakeTimers();
    child = new FakeChildProcess();
    mockSpawn.mockReturnValue(child);
    mcpAllowRules.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('resolves succeeded and parses session/result/cost from stdout JSON on a clean exit', async () => {
    const service = await buildService();
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');

    child.stdout.emit(
      'data',
      Buffer.from(
        [
          JSON.stringify({ type: 'system' }),
          JSON.stringify({
            type: 'result',
            session_id: 'sess_1',
            result: 'did the thing',
            total_cost_usd: 0.5,
          }),
        ].join('\n'),
      ),
    );
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      status: 'succeeded',
      exitCode: 0,
      sessionId: 'sess_1',
      resultText: 'did the thing',
      totalCostUSD: 0.5,
    });
  });

  it('passes allowed tools (comma-joined, last) and the permission mode to claude', async () => {
    const service = await buildService({
      allowedTools: ['Read', 'Bash'],
      permissionMode: 'dontAsk',
    });
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');
    await Promise.resolve();

    expect(mockSpawn.mock.calls[0][1]).toEqual([
      '-p',
      '/implement ISSUE-1',
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      'Read,Bash',
      '--permission-mode',
      'dontAsk',
    ]);

    child.emit('close', 0);
    await resultPromise;
  });

  it('also allows every MCP server discovered for the repo when allowAllMcp is set', async () => {
    mcpAllowRules.mockResolvedValue(['mcp__linear-server', 'mcp__plugin_playwright_playwright']);
    const service = await buildService({ allowedTools: ['Read'], allowAllMcp: true });
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');
    await jest.advanceTimersByTimeAsync(0);

    expect(mcpAllowRules).toHaveBeenCalledWith('/repos/repo-a');
    expect(mockSpawn.mock.calls[0][1]).toContain(
      'Read,mcp__linear-server,mcp__plugin_playwright_playwright',
    );

    child.emit('close', 0);
    await resultPromise;
  });

  it('does not look up MCP servers when allowAllMcp is off', async () => {
    const service = await buildService({ allowedTools: ['Read'] });
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');
    await Promise.resolve();

    expect(mcpAllowRules).not.toHaveBeenCalled();

    child.emit('close', 0);
    await resultPromise;
  });

  it('omits the permission flags when none are configured', async () => {
    const service = await buildService({ allowedTools: [] });
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');
    await Promise.resolve();

    expect(mockSpawn.mock.calls[0][1]).toEqual([
      '-p',
      '/implement ISSUE-1',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);

    child.emit('close', 0);
    await resultPromise;
  });

  it('resolves needs_input when a clean exit ends with a "Stop rule:" reply', async () => {
    const service = await buildService();
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');
    const reply = 'Stop rule: the issue conflicts with an RFC. I recommend option A.';

    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ type: 'result', session_id: 'sess_1', result: reply })),
    );
    child.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      status: 'needs_input',
      exitCode: 0,
      sessionId: 'sess_1',
      resultText: reply,
      errorSnippet: reply,
    });
  });

  it('resolves failed with a stderr snippet when the process exits non-zero with no JSON stdout', async () => {
    const service = await buildService();
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');

    child.stderr.emit('data', Buffer.from('fatal: something broke'));
    child.emit('close', 1);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        status: 'failed',
        exitCode: 1,
        errorSnippet: 'fatal: something broke',
      }),
    );
  });

  it('resolves failed when stdout JSON reports is_error even on exit code 0', async () => {
    const service = await buildService();
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'result',
          session_id: 'sess_1',
          result: 'refused: ambiguous request',
          is_error: true,
        }),
      ),
    );
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ status: 'failed', errorSnippet: 'refused: ambiguous request' }),
    );
  });

  it('rejects when the child process itself errors (e.g. binary not found)', async () => {
    const service = await buildService();
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a');

    child.emit('error', new Error('spawn claude ENOENT'));

    await expect(resultPromise).rejects.toThrow('spawn claude ENOENT');
  });

  it('passes --resume with the session id when resuming a prior Claude session', async () => {
    const service = await buildService();
    const resultPromise = service.spawn('implement', 'ISSUE-1', '/repos/repo-a', {
      resumeSessionId: 'claude_sess_1',
    });

    child.emit('close', 0);
    await resultPromise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--resume', 'claude_sess_1']),
      expect.anything(),
    );
  });

  it('sends SIGTERM to the process group after the configured timeout elapses', async () => {
    const service = await buildService({ timeout: 5000 });
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    void service.spawn('implement', 'ISSUE-1', '/repos/repo-a');
    jest.advanceTimersByTime(5000);

    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM');
    killSpy.mockRestore();
  });
});

describe('isStopRuleReply', () => {
  it.each([
    ['Stop rule: needs a decision', true],
    ['**Stop rule:** needs a decision', true],
    ['  stop rule: lower case', true],
    ['Done. Stop rule: not at the start', false],
    ['The stop rule was not triggered', false],
    ['', false],
    [undefined, false],
  ])('%j -> %s', (text, expected) => {
    expect(isStopRuleReply(text)).toBe(expected);
  });
});
