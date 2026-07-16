import type { RowColumn } from './types';

export const ROW_COLUMNS = {
  active: [
    { label: 'Repo', width: 13 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 24 },
    { label: 'Skill', width: 11 },
    { label: 'Elapsed', width: 8 },
  ] satisfies RowColumn[],
  queue: [
    { label: 'Repo', width: 13 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 32 },
    { label: 'Skill', width: 11 },
  ] satisfies RowColumn[],
  completed: [
    { label: 'Repo', width: 13 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 24 },
    { label: 'Duration', width: 8 },
  ] satisfies RowColumn[],
};

export const TAB_NAMES = ['Dashboard', 'Logs', 'Relay', 'Runs', 'Completed', 'Failed'] as const;
