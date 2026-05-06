import assert from 'node:assert/strict';
import { createQBankCacheAttemptId, isQuestionBlockDefinition, QBANK_CACHE_ATTEMPT_PREFIX } from '../src/qbank/cache-controller.js';
import { loadQBankCaptureContext, resolveQBankCaptureForItems, loadQBankSnapshotsForAttempt } from '../src/qbank/cache-lookup.js';
import { formatQBankStorageStatus, summarizeQBankCaptureStorage } from '../src/ui/launch-history.js';

assert.equal(QBANK_CACHE_ATTEMPT_PREFIX, 'qbank-cache');
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 1 Block 1' }), true);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 3 FIP Drug Ad Block 2' }), true);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 1 Tutorial' }), false);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 2 All Blocks' }), false);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 3 CCS Tutorial' }), false);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 3 Case 6' }), false);
assert.equal(createQBankCacheAttemptId({
  program: 'USMLE',
  examName: 'STPF1',
  testDefinitionName: 'STPF1C0137',
}), 'qbank-cache:USMLE:STPF1:STPF1C0137');

const qbankStorageSummary = summarizeQBankCaptureStorage([
  Object.freeze({
    id: 'qbank-cache:USMLE:STPF1:STPF1C0137',
    status: 'completed',
    reviewReady: true,
    questionIds: Object.freeze(['cache-q1', 'cache-q2']),
    questionCount: 2,
    correctAnswers: Object.freeze({ 'cache-q1': 'A', 'cache-q2': 'B' }),
    source: Object.freeze({ cacheKind: 'qbank' }),
  }),
], [Object.freeze({ program: 'USMLE', examName: 'STPF1', testDefinitionName: 'STPF1C0137' })]);
assert.equal(qbankStorageSummary.complete, true);
assert.equal(qbankStorageSummary.completeCount, 1);
assert.equal(qbankStorageSummary.expectedCount, 1);
assert.equal(qbankStorageSummary.storedQuestions, 2);
assert.equal(qbankStorageSummary.knownAnswers, 2);
assert.equal(formatQBankStorageStatus(qbankStorageSummary), 'Complete');
const incompleteQBankStorageSummary = summarizeQBankCaptureStorage([
  Object.freeze({
    id: 'qbank-cache:USMLE:STPF1:STPF1C0137',
    status: 'completed',
    reviewReady: true,
    questionIds: Object.freeze(['cache-q1', 'cache-q2']),
    questionCount: 2,
    correctAnswers: Object.freeze({ 'cache-q1': 'A' }),
    source: Object.freeze({ cacheKind: 'qbank' }),
  }),
], [Object.freeze({ program: 'USMLE', examName: 'STPF1', testDefinitionName: 'STPF1C0137' })]);
assert.equal(incompleteQBankStorageSummary.complete, false);
assert.equal(formatQBankStorageStatus(incompleteQBankStorageSummary), 'Incomplete');

const qbankAttempt = Object.freeze({
  id: 'qbank-cache:USMLE:STPF1:Block1',
  correctAnswers: Object.freeze({ 'webfred:USMLE:STPF1:MED1:COMP1': 'A' }),
  source: Object.freeze({ cacheKind: 'qbank' }),
});
const qbankSnapshot = Object.freeze({
  id: 'qbank-snapshot-1',
  attemptId: qbankAttempt.id,
  questionId: 'webfred:USMLE:STPF1:MED1:COMP1',
  blockNumber: 1,
  itemIndex: 1,
  correctAnswerId: 'A',
  renderedHtml: '<div id="item1"><ol class="options"></ol></div>',
  metadata: Object.freeze({ componentId: 'COMP1', medleyId: 'MED1' }),
});
const qbankStorage = Object.freeze({
  async listAttempts() { return [qbankAttempt]; },
  async listQuestionSnapshots() { return [qbankSnapshot]; },
});
const context = await loadQBankCaptureContext(qbankStorage);
assert.equal(context.available, true);
const capture = resolveQBankCaptureForItems(context, {
  itemList: [Object.freeze({ questionId: 'live-q1', componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 })],
  expectedCount: 1,
});
assert.deepEqual(capture.correctAnswers, { 'live-q1': 'A' });
assert.equal(capture.summary.source, 'qbank-cache');
assert.equal(capture.source.matchSourcesByQuestionId['live-q1'], 'component-medley');
const blockTwoCapture = resolveQBankCaptureForItems(context, {
  itemList: [Object.freeze({ questionId: 'live-b2-q1', componentId: 'COMP1', medleyId: 'MED1', blockNumber: 2, itemIndex: 1 })],
  expectedCount: 1,
});
assert.deepEqual(blockTwoCapture.correctAnswers, {}, 'qbank component matches stay block-scoped');
const qbankSnapshots = await loadQBankSnapshotsForAttempt(qbankStorage, {
  questionIds: ['live-q1'],
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({ 'live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }) }) }),
});
assert.equal(qbankSnapshots.length, 1);
assert.equal(qbankSnapshots[0].questionId, 'live-q1');
assert.equal(qbankSnapshots[0].metadata.qbankCacheOriginalQuestionId, qbankSnapshot.questionId);

console.log('qbank cache tests passed');
