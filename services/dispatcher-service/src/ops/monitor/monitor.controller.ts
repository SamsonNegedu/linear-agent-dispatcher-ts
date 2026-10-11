import { Controller, Get, HttpCode, HttpException, HttpStatus, Logger, Query } from '@nestjs/common';
import type { Run } from '../../store/store.interfaces';
import { MonitorService, type MonitorSummary } from './monitor.service';

@Controller('monitor')
export class MonitorController {
  private readonly logger = new Logger(MonitorController.name);

  constructor(private readonly monitorService: MonitorService) {}

  @Get('summary')
  @HttpCode(200)
  async summary(): Promise<MonitorSummary> {
    try {
      return await this.monitorService.getSummary();
    } catch (error) {
      this.logger.error('Summary request failed:', error);
      throw new HttpException(
        { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('runs')
  @HttpCode(200)
  async runs(
    @Query('status') status?: Run['status'],
    @Query('limit') limitParam?: string,
  ): Promise<Run[]> {
    try {
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 50;
      const validStatuses: Run['status'][] = [
        'running',
        'pending',
        'succeeded',
        'failed',
        'needs_input',
      ];

      if (status && !validStatuses.includes(status)) {
        throw new HttpException({ error: 'Invalid status parameter' }, HttpStatus.BAD_REQUEST);
      }

      return await this.monitorService.getRuns(status, limit);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Runs request failed:', error);
      throw new HttpException(
        { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
