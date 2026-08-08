// Prisma-shape contract tests — the guard the fake-db blind spot demands.
//
// A stub suite stays green while a select naming a non-existent column 500s
// every production request. These walk the fields this module actually reads
// and writes against the GENERATED Prisma DMMF, so a schema drift fails here
// rather than at 3am in a customer conversation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

const model = (name) => Prisma.dmmf.datamodel.models.find((m) => m.name === name);

function assertScalars(modelName, fields) {
  const m = model(modelName);
  assert.ok(m, `${modelName} exists in the generated schema`);
  for (const f of fields) {
    const field = m.fields.find((x) => x.name === f);
    assert.ok(field, `${modelName}.${f} exists`);
    assert.notEqual(field.kind, 'object', `${modelName}.${f} is a scalar`);
  }
}

test('the agent models exist with the columns the module reads and writes', () => {
  assertScalars('AgentSettings', [
    'id', 'enabled', 'provider', 'model', 'effort', 'includeGroups',
    'maxMessageAgeMinutes', 'recentMessageCount', 'maxRunsPerSweep', 'updatedById',
  ]);
  assertScalars('AgentCapabilityState', ['key', 'mode', 'conditions', 'updatedById']);
  assertScalars('AgentKnowledgeItem', [
    'id', 'title', 'body', 'category', 'language', 'scope', 'status', 'sortOrder',
    'createdById', 'approvedById', 'approvedAt', 'archivedAt', 'sourceInsightId',
  ]);
  assertScalars('AgentPlaybookRule', [
    'id', 'title', 'whenText', 'thenText', 'category', 'language', 'priority',
    'status', 'createdById', 'approvedById', 'approvedAt', 'archivedAt', 'sourceInsightId',
  ]);
  assertScalars('AgentStyleProfile', [
    'id', 'key', 'name', 'language', 'audience', 'rules', 'status', 'isDefault',
    'createdById', 'approvedById', 'approvedAt', 'archivedAt', 'sourceInsightId',
  ]);
  assertScalars('AgentConfigSnapshot', ['id', 'hash', 'payload', 'itemCounts', 'createdAt']);
  assertScalars('AgentRun', [
    'id', 'trigger', 'status', 'accountId', 'chatId', 'triggerMessageId', 'contactId',
    'dealId', 'authorityMode', 'provider', 'model', 'promptVersion', 'configSnapshotId',
    'contextSources', 'contextPack', 'intent', 'capabilityKey', 'confidence', 'escalate',
    'escalationReason', 'guardFindings', 'latencyMs', 'inputTokens', 'outputTokens',
    'errorCode', 'errorMessage', 'skipReason', 'createdAt',
  ]);
  assertScalars('AgentProposal', [
    'id', 'runId', 'kind', 'capabilityKey', 'proposedText', 'proposedActions', 'status',
    'finalText', 'handledById', 'handledAt', 'rejectReason', 'fpLastMessageId',
    'fpLastMessageAt', 'fpMessageCount', 'fpDealUpdatedAt', 'idempotencyKey',
    'scheduledMessageId', 'createdAt', 'updatedAt',
  ]);
  assertScalars('AgentInsight', [
    'id', 'category', 'title', 'proposedChange', 'rationale', 'strength', 'evidenceCount',
    'evidenceRefs', 'status', 'appliedRecordId', 'reviewedById', 'reviewedAt', 'reviewNote',
    'generatedByRunId', 'createdAt', 'updatedAt',
  ]);
});

test('the idempotency and dedup indexes the runner depends on exist', () => {
  // Losing either of these turns a structural guarantee into a race.
  const run = model('AgentRun');
  const hasRunUnique = (run.uniqueFields || []).some(
    (f) => f.length === 2 && f.includes('chatId') && f.includes('triggerMessageId'),
  );
  assert.ok(hasRunUnique, 'AgentRun must be unique on (chatId, triggerMessageId) — the analyse-once claim');

  const proposal = model('AgentProposal');
  const key = proposal.fields.find((f) => f.name === 'idempotencyKey');
  assert.ok(key?.isUnique, 'AgentProposal.idempotencyKey must be unique — the send-once claim');

  const snapshot = model('AgentConfigSnapshot');
  assert.ok(
    snapshot.fields.find((f) => f.name === 'hash')?.isUnique,
    'AgentConfigSnapshot.hash must be unique — content addressing depends on it',
  );
});

test('the CRM fields the Context Pack projects all exist', () => {
  // Every field the pack reads off a canonical record. This is the test that
  // would have caught participantCount / Location.name / product.name, all of
  // which were wrong on the first write of context/pack.js.
  assertScalars('Deal', [
    'orderNo', 'status', 'activityType', 'participants', 'valueMinor', 'currency',
    'tourDate', 'title', 'updatedAt',
  ]);
  assertScalars('Location', ['nameHe', 'nameEn', 'meetingPointHe', 'meetingPointEn']);
  assertScalars('Product', ['nameHe', 'nameEn']);
  assertScalars('ProductVariant', ['agentDisplayName', 'agentDisplayNameEn']);
  assertScalars('TourEvent', ['date', 'startTime', 'status']);
  assertScalars('Task', ['title', 'dueDate', 'status', 'dealId', 'ownerUserId', 'createdByUserId', 'taskTypeId']);
  assertScalars('Contact', ['firstNameHe', 'lastNameHe', 'firstNameEn', 'lastNameEn']);
  assertScalars('WhatsAppChat', [
    'id', 'accountId', 'contactId', 'type', 'phoneNumber', 'savedContactName',
    'pushName', 'lastMessageAt', 'providerDeletedAt', 'hiddenAt',
  ]);
  assertScalars('WhatsAppMessage', [
    'id', 'chatId', 'direction', 'messageType', 'textContent', 'timestampFromSource', 'createdAt',
  ]);
});
