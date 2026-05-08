import assert from 'node:assert/strict';
import { ATTEMPT_STATUS, PAGE_KIND, SCRIPT } from '../src/core/constants.js';
import {
  GRADE_STATUS,
  answersMatch,
  buildAttemptCompletionPatch,
  buildAttemptScoreSummary,
  inferAttemptScope,
  inferNativeCompletionState,
  normalizeAnswerId,
  shouldManualFinishCompleteAttempt,
} from '../src/scoring/grader.js';
import {
  buildEndExamCompletionPatch,
  deriveActiveExamProgress,
  deriveEndExamReviewState,
  formatActiveExamProgress,
  isEndExamRoute,
  refreshAttemptQBankKeysForEndExam,
} from '../src/ui/active-exam-pill.js';
import {
  isAttemptReviewReady,
  pickLatestEndExamAttempt,
  shouldPreferStoredEndExamAttempt,
} from '../src/review/readiness.js';
import { detectRuntimeContext } from '../src/core/runtime-context.js';
import { createSyntheticAdapterState, createSyntheticAttempt } from './test-utils/fixtures.mjs';

assert.equal(normalizeAnswerId(' A '), 'A');
assert.equal(answersMatch('a', 'A'), true);
assert.equal(answersMatch('', 'A'), false);
assert.equal(detectRuntimeContext(new URL('https://orientation.nbme.org/launch/usmle')).pageKind, PAGE_KIND.LAUNCH);
assert.equal(detectRuntimeContext(new URL('https://orientation.nbme.org/Launch/USMLE')).pageKind, PAGE_KIND.LAUNCH);
assert.equal(SCRIPT.USER_SCRIPT_MATCHES.includes('https://orientation.nbme.org/launch*'), true);
assert.equal(SCRIPT.USER_SCRIPT_MATCHES.includes('https://orientation.nbme.org/launch/*'), true);

const attempt = createSyntheticAttempt({
  id: 'attempt-scoring',
  responses: { q1: 'A', q2: 'B', q3: '', q4: 'D' },
  correctAnswers: { q1: 'A', q2: 'C', q4: '' },
  questionIds: ['q1', 'q2', 'q3', 'q4'],
  questionCount: 4,
  timingByQuestionId: {
    q1: { totalMs: 1000, blockNumber: 1, itemIndex: 1 },
    q2: { totalMs: 2000, blockNumber: 1, itemIndex: 2 },
    q3: { totalMs: 0, blockNumber: 1, itemIndex: 3 },
    q4: { totalMs: 3000, blockNumber: 1, itemIndex: 4 },
  },
  source: {
    itemMetadataByQuestionId: {
      q1: { blockNumber: 1, itemIndex: 1 },
      q2: { blockNumber: 1, itemIndex: 2 },
      q3: { blockNumber: 1, itemIndex: 3 },
      q4: { blockNumber: 1, itemIndex: 4 },
    },
  },
});

const score = buildAttemptScoreSummary(attempt, { reason: 'unit-test' });
assert.equal(score.total, 4);
assert.equal(score.answered, 3);
assert.equal(score.correct, 1);
assert.equal(score.incorrect, 1);
assert.equal(score.omitted, 1);
assert.equal(score.unknown, 1);
assert.equal(score.known, 3);
assert.equal(score.statusCounts[GRADE_STATUS.CORRECT], 1);
assert.equal(score.statusCounts[GRADE_STATUS.INCORRECT], 1);
assert.equal(score.statusCounts[GRADE_STATUS.OMITTED], 1);
assert.equal(score.statusCounts[GRADE_STATUS.UNKNOWN], 1);
assert.equal(score.minimumScore.label, '1/4');
assert.equal(score.knownKeyScore.label, '1/3');
assert.equal(score.overallScore.basis, 'minimum-known-unknown-keys');
assert.equal(score.scoreComplete, false);
assert.equal(score.perBlock.length, 1);
assert.equal(score.questionResults.find((result) => result.questionId === 'q4').status, GRADE_STATUS.UNKNOWN);

const singleBlockScope = inferAttemptScope(attempt, createSyntheticAdapterState({ blockCount: 1 }));
assert.equal(singleBlockScope.isAllBlockLaunch, false);
assert.deepEqual(singleBlockScope.launchedBlockNumbers, [1]);

const allBlockAttempt = createSyntheticAttempt({
  launchedScope: { mode: 'all', blockCount: 3 },
  blockMetadata: [
    { blockNumber: 1, itemCount: 3 },
    { blockNumber: 2, itemCount: 3 },
    { blockNumber: 3, itemCount: 3 },
  ],
  source: {
    itemMetadataByQuestionId: {
      q1: { blockNumber: 1, itemIndex: 1 },
      q2: { blockNumber: 2, itemIndex: 1 },
      q3: { blockNumber: 3, itemIndex: 1 },
    },
  },
});
const incompleteTerminalState = createSyntheticAdapterState({
  launchedScope: { mode: 'all', blockCount: 3 },
  blockCount: 3,
  terminalState: { isTerminal: true, blockComplete: true, examComplete: false, allBlocksComplete: false, currentBlock: 1, completedBlockNumbers: [1] },
});
const incompleteCompletion = inferNativeCompletionState(allBlockAttempt, incompleteTerminalState);
assert.equal(incompleteCompletion.terminalDetected, true);
assert.equal(incompleteCompletion.shouldComplete, false);
assert.equal(incompleteCompletion.reviewLocked, true);
assert.equal(shouldManualFinishCompleteAttempt(allBlockAttempt, incompleteTerminalState), true);

const completeTerminalState = createSyntheticAdapterState({
  launchedScope: { mode: 'all', blockCount: 3 },
  blockCount: 3,
  terminalState: { isTerminal: true, blockComplete: false, examComplete: true, allBlocksComplete: true, currentBlock: 3, completedBlockNumbers: [1, 2, 3] },
});
const completeCompletion = inferNativeCompletionState(allBlockAttempt, completeTerminalState);
assert.equal(completeCompletion.shouldComplete, true);
const nativeCompletionPatch = buildAttemptCompletionPatch(allBlockAttempt, { adapterState: completeTerminalState, reason: 'native-test', completedAt: '2026-05-05T01:00:00.000Z' });
assert.equal(nativeCompletionPatch.status, ATTEMPT_STATUS.COMPLETED);
assert.equal(nativeCompletionPatch.reviewReady, true);
assert.equal(nativeCompletionPatch.scoreSummary.reason, 'native-test');
assert.equal(nativeCompletionPatch.source.completion.allLaunchedBlocksComplete, true);

const eightyQuestionIds = Array.from({ length: 80 }, (_item, index) => `q${index + 1}`);
const blockTwoQuestionIds = eightyQuestionIds.slice(40);
const noisyAllBlockAttempt = createSyntheticAttempt({
  launchedScope: { mode: 'all', blockCount: 2 },
  questionIds: eightyQuestionIds,
  questionCount: 80,
  responses: Object.fromEntries(eightyQuestionIds.map((questionId) => [questionId, 'A'])),
  correctAnswers: Object.fromEntries(eightyQuestionIds.map((questionId) => [questionId, 'A'])),
  source: {
    itemMetadataByQuestionId: Object.fromEntries(eightyQuestionIds.map((questionId, index) => [questionId, {
      blockNumber: Math.floor(index / 40) + 1,
      itemIndex: (index % 40) + 1,
    }])),
  },
});
const scopedCompletionPatch = buildAttemptCompletionPatch(noisyAllBlockAttempt, {
  adapterState: createSyntheticAdapterState({
    currentBlock: 2,
    itemCount: 40,
    itemList: blockTwoQuestionIds.map((questionId, index) => ({ questionId, blockNumber: 2, itemIndex: index + 1 })),
  }),
});
assert.equal(scopedCompletionPatch.scoreSummary.total, 40, 'completion scoring ignores other launched blocks when adapter exposes current-block items');
assert.equal(scopedCompletionPatch.scoreSummary.questionResults[0].questionId, 'q41');
assert.equal(scopedCompletionPatch.scoreSummary.questionResults.some((result) => result.questionId === 'q1'), false);

const skippedCurrentQuestionIds = Array.from({ length: 40 }, (_item, index) => `skip-q${index + 1}`).filter((questionId) => questionId !== 'skip-q9');
const skippedCurrentQuestionAdapterState = createSyntheticAdapterState({
  currentBlock: 1,
  itemCount: 40,
  currentItem: { questionId: 'skip-q9', blockNumber: 1, itemIndex: 9, componentId: 'skip-component-9', medleyId: 'skip-medley', current: true },
  itemList: skippedCurrentQuestionIds.map((questionId) => {
    const itemIndex = Number(questionId.match(/\d+$/)[0]);
    return { questionId, blockNumber: 1, itemIndex, componentId: `skip-component-${itemIndex}`, medleyId: 'skip-medley' };
  }),
});
const skippedCurrentCompletionPatch = buildAttemptCompletionPatch(createSyntheticAttempt({
  id: 'attempt-skipped-current-question',
  questionIds: skippedCurrentQuestionIds,
  questionCount: 40,
  launchedScope: { mode: 'test', block: '1' },
  blockMetadata: [{ blockNumber: 1, itemCount: 40 }],
  responses: Object.fromEntries(skippedCurrentQuestionIds.slice(0, 8).map((questionId) => [questionId, 'A'])),
  correctAnswers: Object.fromEntries([...skippedCurrentQuestionIds, 'skip-q9'].map((questionId) => [questionId, 'A'])),
}), { adapterState: skippedCurrentQuestionAdapterState, completedAt: '2026-05-05T02:00:00.000Z' });
assert.equal(skippedCurrentCompletionPatch.questionIds.length, 40, 'completion includes current unanswered item missing from stale itemList');
assert.equal(skippedCurrentCompletionPatch.questionIds[8], 'skip-q9');
assert.equal(skippedCurrentCompletionPatch.source.itemMetadataByQuestionId['skip-q9'].itemIndex, 9);
assert.equal(skippedCurrentCompletionPatch.scoreSummary.total, 40);
assert.equal(skippedCurrentCompletionPatch.scoreSummary.questionResults.find((result) => result.questionId === 'skip-q9').status, GRADE_STATUS.OMITTED);

const progress = deriveActiveExamProgress({ attempt, adapterState: createSyntheticAdapterState() });
assert.deepEqual(progress, { blockNumber: 1, answered: 2, total: 3, source: 'adapter-state' });
assert.equal(formatActiveExamProgress(progress), '2/3 · Block 1');
const freshBlockTwoItemIds = Array.from({ length: 40 }, (_item, index) => `fresh-b2-q${index + 1}`);
const freshBlockTwoProgress = deriveActiveExamProgress({
  attempt: createSyntheticAttempt({
    launchedScope: { mode: 'test', block: '2' },
    questionIds: ['old-b1-q1', 'old-b1-q2', 'old-b1-q3'],
    questionCount: 40,
    responses: { 'old-b1-q1': 'A', 'old-b1-q2': 'B', 'old-b1-q3': 'C' },
  }),
  adapterState: createSyntheticAdapterState({
    currentBlock: 2,
    itemCount: 40,
    currentItem: { questionId: freshBlockTwoItemIds[0], blockNumber: 2, itemIndex: 1, current: true },
    itemList: freshBlockTwoItemIds.map((questionId, index) => ({ questionId, blockNumber: 2, itemIndex: index + 1 })),
    answers: {},
  }),
});
assert.deepEqual(freshBlockTwoProgress, { blockNumber: 2, answered: 0, total: 40, source: 'adapter-state' });
assert.equal(formatActiveExamProgress(freshBlockTwoProgress), '0/40 · Block 2');
assert.equal(isAttemptReviewReady({ status: ATTEMPT_STATUS.COMPLETED }), true);
assert.equal(isAttemptReviewReady({ status: ATTEMPT_STATUS.IN_PROGRESS, reviewReady: false }), false);
assert.equal(isEndExamRoute(new URL('https://orientation.nbme.org/webfred/#!/endExam')), true);
assert.equal(isEndExamRoute(new URL('https://orientation.nbme.org/webfred/#/main')), false);
assert.deepEqual(deriveEndExamReviewState({
  attempt: { status: ATTEMPT_STATUS.COMPLETED, questionIds: ['q1'], questionCount: 1 },
  adapterState: createSyntheticAdapterState(),
  location: new URL('https://orientation.nbme.org/webfred/#!/endExam'),
}), {
  visible: true,
  enabled: true,
  routeMatched: true,
  terminalDetected: false,
  reviewReady: true,
  reviewEvidence: true,
  reason: 'end-exam-route',
});
assert.equal(deriveEndExamReviewState({
  attempt: { status: ATTEMPT_STATUS.COMPLETED, questionIds: [], questionCount: 0 },
  adapterState: createSyntheticAdapterState(),
  location: new URL('https://orientation.nbme.org/webfred/#!/endExam'),
}).enabled, false);
assert.equal(deriveEndExamReviewState({
  attempt: { status: ATTEMPT_STATUS.IN_PROGRESS, reviewReady: false },
  adapterState: completeTerminalState,
  location: new URL('https://orientation.nbme.org/webfred/#/main'),
}).visible, false);
assert.equal(deriveEndExamReviewState({
  attempt: { status: ATTEMPT_STATUS.IN_PROGRESS, reviewReady: false },
  adapterState: createSyntheticAdapterState(),
  location: new URL('https://orientation.nbme.org/webfred/#/main'),
}).visible, false);
assert.equal(pickLatestEndExamAttempt([
  { id: 'latest-empty', status: ATTEMPT_STATUS.IN_PROGRESS, updatedAt: '2026-05-05T01:00:00.000Z' },
  { id: 'qbank-cache:newer', status: ATTEMPT_STATUS.COMPLETED, questionIds: ['cache-q1'], updatedAt: '2026-05-05T02:00:00.000Z', source: { cacheKind: 'qbank' } },
  { id: 'ready', status: ATTEMPT_STATUS.COMPLETED, questionIds: ['q1'], updatedAt: '2026-05-05T00:00:00.000Z' },
]).id, 'ready');
assert.equal(shouldPreferStoredEndExamAttempt(
  { id: 'stale-tab-attempt', status: ATTEMPT_STATUS.COMPLETED, questionIds: ['old-q1'], updatedAt: '2026-05-05T00:00:00.000Z' },
  { id: 'current-block-attempt', status: ATTEMPT_STATUS.COMPLETED, questionIds: ['new-q1'], updatedAt: '2026-05-05T02:00:00.000Z' }
), true, 'endExam review CTA switches from stale tab attempt to latest stored attempt');
assert.equal(shouldPreferStoredEndExamAttempt(
  { id: 'current-block-attempt', status: ATTEMPT_STATUS.COMPLETED, questionIds: ['new-q1'], updatedAt: '2026-05-05T03:00:00.000Z' },
  { id: 'older-block-attempt', status: ATTEMPT_STATUS.COMPLETED, questionIds: ['old-q1'], updatedAt: '2026-05-05T02:00:00.000Z' }
), false, 'endExam review CTA keeps fresher current attempt');
const endExamPatch = buildEndExamCompletionPatch(allBlockAttempt, createSyntheticAdapterState({ blockCount: 3 }), { completedAt: '2026-05-05T03:00:00.000Z' });
assert.equal(endExamPatch.reviewReady, true);
assert.equal(endExamPatch.status, ATTEMPT_STATUS.COMPLETED);
assert.equal(endExamPatch.source.completion.reason, 'native-end-exam-route');
assert.deepEqual(endExamPatch.source.completion.completedBlockNumbers, [1, 2, 3]);

const staleQBankAttempt = Object.freeze({
  id: 'attempt-endexam-qbank-refresh',
  status: ATTEMPT_STATUS.IN_PROGRESS,
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze(['legacy-live-q1']),
  questionCount: 1,
  responses: Object.freeze({ 'legacy-live-q1': 'A' }),
  correctAnswers: Object.freeze({}),
  answerKeyCapture: Object.freeze({ status: 'failed', source: 'qbank-cache', expectedCount: 1, knownCount: 0, unknownCount: 1, failureReason: 'qbank-cache-no-matches' }),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze({
      'legacy-live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 9, itemIndex: 1 }),
    }),
  }),
});
const qbankAttempt = Object.freeze({ id: 'qbank-cache:USMLE:STPF1:Block1', correctAnswers: Object.freeze({ 'qbank-q1': 'A' }), source: Object.freeze({ cacheKind: 'qbank' }) });
const qbankSnapshot = Object.freeze({
  id: 'qbank-snapshot-1',
  attemptId: qbankAttempt.id,
  questionId: 'qbank-q1',
  blockNumber: 1,
  itemIndex: 1,
  correctAnswerId: 'A',
  renderedHtml: '<div id="item1"><ol class="options"></ol></div>',
  metadata: Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }),
});
const refreshedEndExamAttempt = await refreshAttemptQBankKeysForEndExam({
  async listAttempts() { return [qbankAttempt]; },
  async listQuestionSnapshots() { return [qbankSnapshot]; },
  async updateAttempt(id, patch) { return Object.freeze({ ...staleQBankAttempt, id, ...patch }); },
}, staleQBankAttempt, { warn() {}, debug() {} });
assert.equal(refreshedEndExamAttempt.answerKeyCapture.status, 'complete');
assert.equal(refreshedEndExamAttempt.answerKeyCapture.knownCount, 1);
assert.equal(refreshedEndExamAttempt.correctAnswers['legacy-live-q1'], 'A');
assert.equal(refreshedEndExamAttempt.scoreSummary.unknown, 0);

console.log('scoring and active-exam tests passed');
