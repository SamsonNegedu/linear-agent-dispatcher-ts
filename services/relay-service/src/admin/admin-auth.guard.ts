import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const adminToken = process.env.ADMIN_API_TOKEN;

    if (!adminToken) {
      this.logger.debug('ADMIN_API_TOKEN not configured, admin endpoints disabled');
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.headers['x-admin-token'];
    const tokenStr = Array.isArray(token) ? token[0] : token;

    if (!tokenStr || !this.tokensMatch(tokenStr, adminToken)) {
      this.logger.warn('Unauthorized admin API access attempt');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    return true;
  }

  // Hash both sides to a fixed-length digest before comparing so neither the
  // length nor the content of the token can be inferred from comparison timing.
  private tokensMatch(provided: string, expected: string): boolean {
    const providedDigest = createHash('sha256').update(provided).digest();
    const expectedDigest = createHash('sha256').update(expected).digest();
    return timingSafeEqual(providedDigest, expectedDigest);
  }
}
