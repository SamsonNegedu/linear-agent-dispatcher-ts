import { WebhookRetentionService, WEBHOOK_RETENTION_DAYS } from '../webhook-retention.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('WebhookRetentionService', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const cutoff = new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * DAY_MS);

  it('deletes failed queue rows and processed keys older than the retention window', async () => {
    const queueRepository = { delete: jest.fn().mockResolvedValue({ affected: 2 }) };
    const processedRepository = { delete: jest.fn().mockResolvedValue({ affected: 5 }) };
    const service = new WebhookRetentionService(
      queueRepository as never,
      processedRepository as never,
    );

    await service.cleanup(now);

    const queueWhere = queueRepository.delete.mock.calls[0][0];
    expect(queueWhere.status).toBe('failed');
    expect(queueWhere.updatedAt.value).toEqual(cutoff);
    expect(processedRepository.delete.mock.calls[0][0].processedAt.value).toEqual(cutoff);
  });

  it('logs and swallows a database error so the timer keeps running', async () => {
    const queueRepository = { delete: jest.fn().mockRejectedValue(new Error('db locked')) };
    const processedRepository = { delete: jest.fn() };
    const service = new WebhookRetentionService(
      queueRepository as never,
      processedRepository as never,
    );

    await expect(service.cleanup(now)).resolves.toBeUndefined();
    expect(processedRepository.delete).not.toHaveBeenCalled();
  });
});
