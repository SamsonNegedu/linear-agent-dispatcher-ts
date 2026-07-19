import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';

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

    if (!token || token !== adminToken) {
      this.logger.warn('Unauthorized admin API access attempt');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    return true;
  }
}
