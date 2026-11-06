import { HttpException } from '@nestjs/common';
import { MonitorController } from '../monitor.controller';
import type { MonitorService } from '../monitor.service';
import type { ScannerService } from '../../../pipeline/scanner/scanner.service';
import type { ExecutorService } from '../../../pipeline/executor/executor.service';

describe('MonitorController cancel', () => {
  const build = (outcome: 'cancelling' | 'not_found' | 'not_running') => {
    const executor = { cancelRun: jest.fn().mockResolvedValue(outcome) };
    const controller = new MonitorController(
      {} as MonitorService,
      executor as unknown as ExecutorService,
      {} as ScannerService,
    );
    return { controller, executor };
  };

  it('accepts the cancel of a running run', async () => {
    const { controller, executor } = build('cancelling');

    await expect(controller.cancel('run_1')).resolves.toEqual({
      id: 'run_1',
      status: 'cancelling',
    });
    expect(executor.cancelRun).toHaveBeenCalledWith('run_1');
  });

  it('answers 404 for an unknown run', async () => {
    const { controller } = build('not_found');

    await expect(controller.cancel('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 409 when the run is not running', async () => {
    const { controller } = build('not_running');

    const error = await controller.cancel('run_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
  });
});

describe('MonitorController scanner', () => {
  it('returns the scanner report', () => {
    const report = { enabled: true, scopes: [] };
    const controller = new MonitorController(
      {} as MonitorService,
      {} as ExecutorService,
      { getReport: () => report } as unknown as ScannerService,
    );

    expect(controller.scannerReport()).toBe(report);
  });
});
