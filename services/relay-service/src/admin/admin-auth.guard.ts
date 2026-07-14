import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const adminToken = process.env.ADMIN_API_TOKEN;

    if (!adminToken) {
      this.logger.debug('ADMIN_API_TOKEN not configured, admin endpoints disabled');
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-admin-token'];

    if (!token || token !== adminToken) {
      this.logger.warn('Unauthorized admin API access attempt');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    return true;
  }
}
