import { Module } from '@nestjs/common';
import { ExecutorService } from './executor.service';
import { ActivityNotifierService } from './activity-notifier.service';
import { IssueCommentService } from './issue-comment.service';
import { StoreModule } from '../store/store.module';

@Module({
  imports: [StoreModule],
  providers: [ExecutorService, ActivityNotifierService, IssueCommentService],
  exports: [ExecutorService, ActivityNotifierService, IssueCommentService],
})
export class ExecutorModule {}
