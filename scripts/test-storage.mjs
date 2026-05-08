import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './test-utils/fake-indexeddb.mjs';
import { createSyntheticAttempt, createSyntheticSnapshots } from './test-utils/fixtures.mjs';
import { ATTEMPT_STATUS, DB_SCHEMA, EXPORT_TYPES, FULL_BACKUP_WARNING } from '../src/core/constants.js';
import {
  createQuestionSnapshotId,
  normalizeIdArray,
  normalizeRecord,
  normalizeStringArray,
  sanitizeJsonCompatible,
} from '../src/core/data.js';
import {
  createAttemptStore,
  createStorageValidationError,
  normalizeAttemptStatus,
} from '../src/storage/attempt-store.js';

globalThis.window = { indexedDB: createFakeIndexedDB() };

const logger = { warn() {}, error() {}, debug() {} };
const storage = createAttemptStore({ databaseName: 'free120-helper-test-db', logger });
const ready = await storage.ready();
assert.equal(ready.schemaVersion, DB_SCHEMA.VERSION);
assert.equal(ready.stores.ATTEMPTS, DB_SCHEMA.STORES.ATTEMPTS);

const metadata = await storage.getSchemaMetadata();
assert.equal(metadata.schemaVersion, DB_SCHEMA.VERSION);
assert.equal(metadata.migratedFromVersion, 0);
assert.ok(metadata.stores.includes(DB_SCHEMA.STORES.QUESTION_SNAPSHOTS));

assert.equal(normalizeAttemptStatus('completed'), ATTEMPT_STATUS.COMPLETED);
assert.equal(normalizeAttemptStatus('bad-status'), ATTEMPT_STATUS.IN_PROGRESS);
assert.deepEqual(normalizeIdArray([' q1 ', '', 3]), ['q1', '3']);
assert.deepEqual(normalizeStringArray([' a ', null, 'b']), ['a', 'b']);
assert.deepEqual(normalizeRecord({ a: 1, b: undefined }), { a: 1 });
assert.throws(() => {
  const circular = {};
  circular.self = circular;
  sanitizeJsonCompatible(circular);
}, /circular objects/);
const validationError = createStorageValidationError('synthetic validation', { field: 'id' });
assert.equal(validationError.name, 'Free120StorageValidationError');
assert.deepEqual(validationError.details, { field: 'id' });

const attempt = await storage.createAttempt(createSyntheticAttempt({ id: 'attempt-storage', status: ATTEMPT_STATUS.IN_PROGRESS }));
assert.equal(attempt.id, 'attempt-storage');
assert.equal(attempt.status, ATTEMPT_STATUS.IN_PROGRESS);
assert.ok(await storage.getInProgressState('attempt-storage'));

await assert.rejects(() => storage.createAttempt({ id: 'attempt-storage' }), /already exists/);
await assert.rejects(() => storage.updateAttempt('missing-attempt', {}), /Attempt not found/);

const snapshots = createSyntheticSnapshots('attempt-storage');
const savedSnapshot = await storage.saveQuestionSnapshot(snapshots[0]);
assert.equal(savedSnapshot.id, createQuestionSnapshotId('attempt-storage', 'q1'));
assert.equal(savedSnapshot.choices.length, 3);
assert.equal((await storage.getQuestionSnapshot('attempt-storage', 'q1')).questionId, 'q1');
assert.equal((await storage.listQuestionSnapshots('attempt-storage')).length, 1);

const completed = await storage.updateAttempt('attempt-storage', { status: ATTEMPT_STATUS.COMPLETED, reviewReady: true });
assert.equal(completed.status, ATTEMPT_STATUS.COMPLETED);
assert.equal(await storage.getInProgressState('attempt-storage'), null);

const historyEnvelope = await storage.exportHistoryOnly();
assert.equal(historyEnvelope.exportType, EXPORT_TYPES.HISTORY_ONLY);
assert.equal(historyEnvelope.questionSnapshots.length, 0);
assert.equal(historyEnvelope.attempts[0].notesByQuestionId, undefined);
assert.equal(historyEnvelope.attempts[0].renderedHtml, undefined);

await assert.rejects(() => storage.exportFullBackup(), /requires explicit warning/);
const fullEnvelope = await storage.exportFullBackup({ acknowledgeWarning: true });
assert.equal(fullEnvelope.exportType, EXPORT_TYPES.FULL_BACKUP);
assert.equal(fullEnvelope.warning, FULL_BACKUP_WARNING);
assert.equal(fullEnvelope.questionSnapshots.length, 1);
assert.match(fullEnvelope.questionSnapshots[0].renderedHtml, /Synthetic stem/);

await assert.rejects(() => storage.importJson('{bad json'), /malformed/);
await assert.rejects(() => storage.importJson({ formatVersion: 999, attempts: [] }), /Unsupported import format/);
await assert.rejects(() => storage.importJson({ formatVersion: 1, schemaVersion: 999, attempts: [] }), /Unsupported import schema/);
await assert.rejects(() => storage.importJson({ formatVersion: 1, attempts: [{ id: 'dup' }, { id: 'dup' }] }), /duplicate ids/);
await assert.rejects(() => storage.importJson({ formatVersion: 1, attempts: [{ id: 'a' }], questionSnapshots: [{ attemptId: 'missing', questionId: 'q' }] }), /references missing attempt/);
await assert.rejects(() => storage.importJson({ formatVersion: 1, attempts: [{ id: 'a' }], questionSnapshots: [{ attemptId: 'a', questionId: 'q' }, { attemptId: 'a', questionId: 'q' }] }), /duplicate attempt\/question/);

const skipResult = await storage.importJson(fullEnvelope, { conflictMode: 'skip' });
assert.equal(skipResult.skippedAttempts, 1);
assert.equal(skipResult.skippedQuestionSnapshots, 1);

const keepBothResult = await storage.importJson(fullEnvelope, { conflictMode: 'keep-both' });
assert.equal(keepBothResult.importedAttempts, 1);
assert.equal(keepBothResult.importedQuestionSnapshots, 1);
assert.equal((await storage.listAttempts({ includeInProgress: true })).length, 2);

const replacementAttempt = {
  ...historyEnvelope,
  attempts: [
    {
      ...historyEnvelope.attempts[0],
      id: 'attempt-storage',
      status: ATTEMPT_STATUS.ABANDONED,
      reviewReady: false,
    },
  ],
};
const replaceResult = await storage.importJson(replacementAttempt, { conflictMode: 'replace' });
assert.equal(replaceResult.replacedAttempts, 1);
assert.equal((await storage.getAttempt('attempt-storage')).status, ATTEMPT_STATUS.ABANDONED);
assert.equal((await storage.listQuestionSnapshots('attempt-storage')).length, 0);

await storage.clearAllHistory();
assert.equal((await storage.listAttempts({ includeInProgress: true })).length, 0);

console.log('storage tests passed');
