import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseLinearWebhook, shouldTriggerDispatch, isTerminalStateType } from './index';

// Real Linear "Issue update" envelope (trimmed of PII/unused fields), captured
// from a live webhook delivery where a label was REMOVED from TMB-8:
// updatedFrom.labelIds had 3 entries, current labelIds has 2 — the removed
// one ("62b6b5e4-...") is gone from both labelIds and labels. This is the
// exact payload that exposed the original bug: the old parser looked for a
// `labelChanges` field Linear never sends, so `labelChange` was always
// undefined and every update looked identical to a self-authored comment.
const REAL_LABEL_REMOVED_PAYLOAD = {
  action: 'update',
  createdAt: '2026-07-17T20:36:21.138Z',
  data: {
    id: '4a41fa2b-5fc9-4c5c-bd29-1f89cadf7498',
    identifier: 'TMB-8',
    title: 'New random issue',
    labelIds: ['cfcd3ac2-38ea-45a9-b0a1-3f8e404e63f0', 'c8ac9dcd-e85d-4f08-869b-e474f5973e1b'],
    teamId: 'cbcffcd5-b767-4cbb-aba0-01c979863751',
    team: { id: 'cbcffcd5-b767-4cbb-aba0-01c979863751', key: 'TMB', name: 'Travel Memory Board' },
    labels: [
      { id: 'c8ac9dcd-e85d-4f08-869b-e474f5973e1b', name: 'agent-implement' },
      { id: 'cfcd3ac2-38ea-45a9-b0a1-3f8e404e63f0', name: 'travel-memory-board' },
    ],
  },
  updatedFrom: {
    labelIds: [
      'cfcd3ac2-38ea-45a9-b0a1-3f8e404e63f0',
      '62b6b5e4-9cc5-493e-af65-8ac4204af18c',
      'c8ac9dcd-e85d-4f08-869b-e474f5973e1b',
    ],
    updatedAt: '2026-07-17T20:24:11.445Z',
  },
  type: 'Issue',
  organizationId: 'f5ea5168-47bf-4638-b899-d8026b6604df',
  webhookId: '738a5ed3-c3f6-4adb-84eb-8283546263dc',
};

// Real Linear "Issue update" envelope, captured from assigning the OAuth
// agent ("Jump") as delegate on TMB-8. updatedFrom contains only
// {updatedAt, delegateId: null} — delegateId is the sole field that changed.
const REAL_DELEGATE_ASSIGNED_PAYLOAD = {
  action: 'update',
  createdAt: '2026-07-17T21:03:55.921Z',
  data: {
    id: '4a41fa2b-5fc9-4c5c-bd29-1f89cadf7498',
    identifier: 'TMB-8',
    title: 'New random issue',
    labelIds: ['cfcd3ac2-38ea-45a9-b0a1-3f8e404e63f0', 'c8ac9dcd-e85d-4f08-869b-e474f5973e1b'],
    teamId: 'cbcffcd5-b767-4cbb-aba0-01c979863751',
    team: { id: 'cbcffcd5-b767-4cbb-aba0-01c979863751', key: 'TMB', name: 'Travel Memory Board' },
    delegateId: 'a736b4c8-ab18-4f84-a526-d60dbecde864',
    state: { id: '263a0ecd-b16a-4f89-9be7-747ee79d5e4a', name: 'Done', type: 'completed' },
    labels: [
      { id: 'c8ac9dcd-e85d-4f08-869b-e474f5973e1b', name: 'agent-implement' },
      { id: 'cfcd3ac2-38ea-45a9-b0a1-3f8e404e63f0', name: 'travel-memory-board' },
    ],
  },
  updatedFrom: {
    updatedAt: '2026-07-17T21:03:48.390Z',
    delegateId: null,
  },
  type: 'Issue',
  organizationId: 'f5ea5168-47bf-4638-b899-d8026b6604df',
  webhookId: '738a5ed3-c3f6-4adb-84eb-8283546263dc',
};

void test('parseLinearWebhook: label removal resolves labelChange.added=[]', () => {
  const event = parseLinearWebhook(REAL_LABEL_REMOVED_PAYLOAD);
  assert.deepEqual(event.labelChange, { added: [], removed: [] });
});

void test('parseLinearWebhook: label removal is a changed field (labelIds)', () => {
  const event = parseLinearWebhook(REAL_LABEL_REMOVED_PAYLOAD);
  assert.deepEqual(event.changedFields, ['labelIds']);
});

void test('parseLinearWebhook: extracts stateType from the real delegate-assignment payload', () => {
  const event = parseLinearWebhook(REAL_DELEGATE_ASSIGNED_PAYLOAD);
  assert.equal(event.stateType, 'completed');
});

void test('isTerminalStateType: completed and canceled are terminal, others are not', () => {
  assert.equal(isTerminalStateType('completed'), true);
  assert.equal(isTerminalStateType('canceled'), true);
  assert.equal(isTerminalStateType('started'), false);
  assert.equal(isTerminalStateType('backlog'), false);
  assert.equal(isTerminalStateType(undefined), false);
});

void test('parseLinearWebhook: delegate assignment is a changed field (delegateId), no labelChange', () => {
  const event = parseLinearWebhook(REAL_DELEGATE_ASSIGNED_PAYLOAD);
  assert.deepEqual(event.changedFields, ['delegateId']);
  assert.equal(event.labelChange, undefined);
});

// UNVERIFIED: only the label-removal shape above comes from a real Linear
// delivery. This case fabricates an addition by editing that real payload's
// updatedFrom.labelIds. It no longer affects the dispatch decision (that's
// now driven by the generic `changedFields` check, confirmed against two
// real payloads above) — this only locks in the label-name-resolution logic
// used for the `triggerSource` observability field. Replace with a real
// captured payload once a real label-add webhook has been observed.
void test('parseLinearWebhook: label addition resolves the added label name [UNVERIFIED shape]', () => {
  const payload = {
    ...REAL_LABEL_REMOVED_PAYLOAD,
    updatedFrom: {
      labelIds: ['cfcd3ac2-38ea-45a9-b0a1-3f8e404e63f0'],
      updatedAt: '2026-07-17T20:24:11.445Z',
    },
  };
  const event = parseLinearWebhook(payload);
  assert.deepEqual(event.labelChange, { added: ['agent-implement'], removed: [] });
});

void test('parseLinearWebhook: update with no changed fields (e.g. a comment) has no labelChange or changedFields', () => {
  const payload = {
    ...REAL_LABEL_REMOVED_PAYLOAD,
    // A comment: Linear bumps updatedAt but touches no other issue field, so
    // updatedFrom contains only updatedAt — not present-but-equal, absent.
    updatedFrom: { updatedAt: '2026-07-17T20:24:11.445Z' },
  };
  const event = parseLinearWebhook(payload);
  assert.equal(event.labelChange, undefined);
  assert.deepEqual(event.changedFields, []);
});

void test('shouldTriggerDispatch: dispatches on label removal (a real field change)', () => {
  const event = parseLinearWebhook(REAL_LABEL_REMOVED_PAYLOAD);
  const decision = shouldTriggerDispatch(event);
  assert.equal(decision.shouldDispatch, true);
});

void test('shouldTriggerDispatch: dispatches on delegate assignment (a real field change)', () => {
  const event = parseLinearWebhook(REAL_DELEGATE_ASSIGNED_PAYLOAD);
  const decision = shouldTriggerDispatch(event);
  assert.equal(decision.shouldDispatch, true);
});

void test('shouldTriggerDispatch: skips update with no changed fields (comment-loop case)', () => {
  const payload = {
    ...REAL_LABEL_REMOVED_PAYLOAD,
    updatedFrom: { updatedAt: '2026-07-17T20:24:11.445Z' },
  };
  const event = parseLinearWebhook(payload);
  const decision = shouldTriggerDispatch(event);
  assert.equal(decision.shouldDispatch, false);
});

void test('shouldTriggerDispatch: always dispatches issue create events', () => {
  const payload = { ...REAL_LABEL_REMOVED_PAYLOAD, action: 'create', updatedFrom: undefined };
  const event = parseLinearWebhook(payload);
  assert.equal(event.changedFields, undefined);
  const decision = shouldTriggerDispatch(event);
  assert.equal(decision.shouldDispatch, true);
});

void test('shouldTriggerDispatch: always dispatches AgentSession events', () => {
  const payload = {
    type: 'AgentSessionEvent',
    action: 'created',
    createdAt: '2026-07-17T20:36:21.138Z',
    organizationId: 'f5ea5168-47bf-4638-b899-d8026b6604df',
    agentSession: { id: 'session-1', issueId: '4a41fa2b-5fc9-4c5c-bd29-1f89cadf7498' },
  };
  const event = parseLinearWebhook(payload);
  const decision = shouldTriggerDispatch(event);
  assert.equal(decision.shouldDispatch, true);
});
