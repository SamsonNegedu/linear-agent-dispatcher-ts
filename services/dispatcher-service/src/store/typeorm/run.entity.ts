import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('issue_runs')
@Index(['provider', 'issueId', 'status'])
@Index(['provider', 'issueId', 'domainLabel', 'skill', 'startedAt'])
export class RunEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 50 })
  provider!: string;

  @Column('varchar', { length: 255 })
  issueId!: string;

  @Column('varchar', { length: 255 })
  issueIdentifier!: string;

  @Column('text', { nullable: true })
  issueTitle?: string;

  @Column('varchar', { length: 255 })
  webhookId!: string;

  @Column('varchar', { length: 100 })
  domainLabel!: string;

  @Column('text')
  repoPath!: string;

  @Column('varchar', { length: 100 })
  skill!: string;

  @Column('varchar', { length: 20 })
  status!: 'pending' | 'running' | 'succeeded' | 'failed';

  @Column('varchar', { length: 255, nullable: true })
  claudeSessionId?: string;

  @Column('int', { nullable: true })
  exitCode?: number;

  @Column('text', { nullable: true })
  errorSnippet?: string;

  @Column('text', { nullable: true })
  worktreePath?: string;

  @Column('int', { nullable: true })
  processPgid?: number;

  @CreateDateColumn()
  startedAt!: Date;

  @Column('datetime', { nullable: true })
  finishedAt?: Date;

  @Column('varchar', { length: 100 })
  triggerSource!: string;

  @Column('varchar', { length: 255, nullable: true })
  providerSessionId?: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
