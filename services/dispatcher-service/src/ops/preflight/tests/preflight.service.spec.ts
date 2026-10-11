import { Test } from '@nestjs/testing';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { PreflightService } from '../preflight.service';
import { PreflightModule } from '../preflight.module';
import { DispatcherConfigModule } from '../../../config/dispatcher-config.module';
import { RoutingConfigService } from '../../../config/routing-config.service';
import type { DispatcherConfig } from '../../../config/config';
import { makeDispatcherConfig } from '../../../test-utils/dispatcher-config';

jest.mock('child_process');
jest.mock('fs');

const mockExecFile = execFile as unknown as jest.Mock;
const mockExistsSync = existsSync as jest.Mock;

const makeConfig = makeDispatcherConfig;

function makeRoutingConfig(
  repos: Array<{ label: string; path: string; issueLabelToSkill?: Record<string, string> }> = [],
): jest.Mocked<RoutingConfigService> {
  return {
    getAllRepositories: jest.fn().mockReturnValue(repos),
  } as unknown as jest.Mocked<RoutingConfigService>;
}

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

function succeedExecFile(): void {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], callback: ExecFileCallback) => {
    callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
  });
}

async function buildService(
  configOverrides: Partial<DispatcherConfig>,
  routingConfig: jest.Mocked<RoutingConfigService>,
): Promise<PreflightService> {
  const module = await Test.createTestingModule({
    imports: [PreflightModule, DispatcherConfigModule],
  })
    .overrideProvider('DispatcherConfig')
    .useValue(makeConfig(configOverrides))
    .overrideProvider(RoutingConfigService)
    .useValue(routingConfig)
    .compile();

  return module.get(PreflightService);
}

describe('PreflightService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('skips validation entirely when PREFLIGHT_SKIP is set', async () => {
    const service = await buildService({ preflight: { skip: true } }, makeRoutingConfig());

    await service.onModuleInit();

    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('passes when the claude binary is found and all repos are fully configured', async () => {
    succeedExecFile();
    mockExistsSync.mockReturnValue(true);
    const routingConfig = makeRoutingConfig([
      {
        label: 'repo-a',
        path: '/repos/repo-a',
        issueLabelToSkill: { 'agent-implement': 'implement' },
      },
    ]);
    const service = await buildService({}, routingConfig);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('throws when the claude binary cannot be found', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], callback: ExecFileCallback) => {
      callback(new Error('not found'), { stdout: '', stderr: '' });
    });
    mockExistsSync.mockReturnValue(true);
    const service = await buildService({}, makeRoutingConfig());

    await expect(service.onModuleInit()).rejects.toThrow('Preflight validation failed');
  });

  it('rejects a claudeBinPath containing shell metacharacters before ever calling execFile', async () => {
    const service = await buildService(
      { executor: { claudeBinPath: 'claude; rm -rf /', allowedEnvVars: [], timeout: 1000 } },
      makeRoutingConfig(),
    );

    await expect(service.onModuleInit()).rejects.toThrow('Preflight validation failed');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('throws when a configured repo path does not exist', async () => {
    succeedExecFile();
    mockExistsSync.mockReturnValue(false);
    const routingConfig = makeRoutingConfig([{ label: 'repo-a', path: '/repos/missing' }]);
    const service = await buildService({}, routingConfig);

    await expect(service.onModuleInit()).rejects.toThrow('Preflight validation failed');
  });

  it('throws when a mapped skill does not exist in the repo', async () => {
    succeedExecFile();
    mockExistsSync.mockImplementation((p: string) => !p.includes('.claude'));
    const routingConfig = makeRoutingConfig([
      {
        label: 'repo-a',
        path: '/repos/repo-a',
        issueLabelToSkill: { 'agent-implement': 'implement' },
      },
    ]);
    const service = await buildService({}, routingConfig);

    await expect(service.onModuleInit()).rejects.toThrow('Preflight validation failed');
  });

  it('throws when a repo exposes no skills', async () => {
    succeedExecFile();
    mockExistsSync.mockReturnValue(true);
    const service = await buildService(
      {},
      makeRoutingConfig([{ label: 'repo-a', path: '/repos/repo-a' }]),
    );

    await expect(service.onModuleInit()).rejects.toThrow('Preflight validation failed');
  });
});
