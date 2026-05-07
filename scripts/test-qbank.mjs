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
const staleScopeLiveBlockCapture = resolveQBankCaptureForItems(context, {
  launchedScope: Object.freeze({ block: '1', testDefinitionDisplayName: 'Step 1 Block 1' }),
  itemList: [Object.freeze({ questionId: 'live-b5-q1', componentId: 'COMP1', medleyId: 'MED1', blockNumber: 5, itemIndex: 1 })],
  expectedCount: 1,
});
assert.deepEqual(staleScopeLiveBlockCapture.correctAnswers, {}, 'live item block does not fall back to stale launched-scope block keys');
const qbankSnapshots = await loadQBankSnapshotsForAttempt(qbankStorage, {
  questionIds: ['live-q1'],
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({ 'live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }) }) }),
});
assert.equal(qbankSnapshots.length, 1);
assert.equal(qbankSnapshots[0].questionId, 'live-q1');
assert.equal(qbankSnapshots[0].metadata.qbankCacheOriginalQuestionId, qbankSnapshot.questionId);
const metadataOnlyScopeCapture = resolveQBankCaptureForItems(context, {
  attempt: Object.freeze({
    launchedScope: Object.freeze({ mode: 'test', block: '1' }),
    questionIds: Object.freeze(['legacy-live-q1']),
    source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({
      'legacy-live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 9, itemIndex: 1 }),
    }) }),
  }),
  questionIds: ['legacy-live-q1'],
  expectedCount: 1,
});
assert.deepEqual(metadataOnlyScopeCapture.correctAnswers, { 'legacy-live-q1': 'A' }, 'launched scope block repairs stale item metadata at endExam');
assert.equal(metadataOnlyScopeCapture.source.matchSourcesByQuestionId['legacy-live-q1'], 'component-medley');
const metadataOnlyScopeSnapshots = await loadQBankSnapshotsForAttempt(qbankStorage, {
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze(['legacy-live-q1']),
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({
    'legacy-live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 9, itemIndex: 1 }),
  }) }),
}, []);
assert.equal(metadataOnlyScopeSnapshots.length, 1, 'review qbank fallback uses launched scope block when stored metadata drifted');
assert.equal(metadataOnlyScopeSnapshots[0].questionId, 'legacy-live-q1');

const shiftedQBankAttempt = Object.freeze({
  id: 'qbank-cache:USMLE:STPF1:ShiftedBlock1',
  correctAnswers: Object.freeze({
    'webfred:USMLE:STPF1:Block-1:MED1:COMP1': 'A',
    'webfred:USMLE:STPF1:Block-1:MED1:COMP2': 'B',
    'webfred:USMLE:STPF1:Block-1:MED1:COMP3': 'C',
  }),
  source: Object.freeze({ cacheKind: 'qbank' }),
});
const shiftedQBankSnapshots = [1, 2, 3].map((itemIndex) => Object.freeze({
  id: `qbank-shifted-snapshot-${itemIndex}`,
  attemptId: shiftedQBankAttempt.id,
  questionId: `webfred:USMLE:STPF1:Block-1:MED1:COMP${itemIndex}`,
  blockNumber: 1,
  itemIndex,
  correctAnswerId: ['A', 'B', 'C'][itemIndex - 1],
  renderedHtml: `<div id="item${itemIndex}"><div class="NBExposition">Q${itemIndex}</div><ol class="options"></ol></div>`,
  metadata: Object.freeze({ componentId: `COMP${itemIndex}`, medleyId: 'MED1', blockNumber: 1, itemIndex }),
}));
const shiftedQBankStorage = Object.freeze({
  async listAttempts() { return [shiftedQBankAttempt]; },
  async listQuestionSnapshots() { return shiftedQBankSnapshots; },
});
const shiftedLiveSnapshots = await loadQBankSnapshotsForAttempt(shiftedQBankStorage, {
  id: 'attempt-shifted-live-review',
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze([
    'webfred:USMLE:STPF1:Block-1:MED1:COMP2',
    'webfred:USMLE:STPF1:Block-1:MED1:COMP3',
  ]),
  questionCount: 3,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 3 })]),
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({
    'webfred:USMLE:STPF1:Block-1:MED1:COMP2': Object.freeze({ componentId: 'COMP2', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }),
    'webfred:USMLE:STPF1:Block-1:MED1:COMP3': Object.freeze({ componentId: 'COMP3', medleyId: 'MED1', blockNumber: 1, itemIndex: 2 }),
  }) }),
}, []);
assert.deepEqual(shiftedLiveSnapshots.slice().sort((left, right) => left.itemIndex - right.itemIndex).map((snapshot) => snapshot.correctAnswerId), ['A', 'B', 'C'], 'qbank review fallback backfills skipped first item and preserves original positions');
assert.match(shiftedLiveSnapshots.find((snapshot) => snapshot.itemIndex === 1).questionId, /^webfred:review-missing:/);
assert.equal(shiftedLiveSnapshots.find((snapshot) => snapshot.correctAnswerId === 'B').itemIndex, 2);

console.log('qbank cache tests passed');
