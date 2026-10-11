import type { RowColumn } from './types';

export const ROW_COLUMNS = {
  active: [
    { label: 'Repo', width: 21 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 16 },
    { label: 'Skill', width: 11 },
    { label: 'Elapsed', width: 8 },
  ] satisfies RowColumn[],
  queue: [
    { label: 'Repo', width: 21 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 24 },
    { label: 'Skill', width: 11 },
  ] satisfies RowColumn[],
  completed: [
    { label: 'Repo', width: 21 },
    { label: 'Issue', width: 9 },
    { label: 'Title', width: 16 },
    { label: 'Skill', width: 11 },
    { label: 'Duration', width: 8 },
    { label: 'Finished', width: 9 },
  ] satisfies RowColumn[],
};

export const POLL_INTERVAL_MS = 1000;
