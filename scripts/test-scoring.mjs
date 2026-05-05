import assert from 'node:assert/strict';
import { ATTEMPT_STATUS } from '../src/core/constants.js';
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
  buildManualFinishAttemptPatch,
  deriveActiveExamProgress,
  formatActiveExamProgress,
  isAttemptReviewReady,
} from '../src/ui/active-exam-pill.js';
import { createSyntheticAdapterState, createSyntheticAttempt } from './test-utils/fixtures.mjs';

assert.equal(normalizeAnswerId(' A '), 'A');
assert.equal(answersMatch('a', 'A'), true);
assert.equal(answersMatch('', 'A'), false);

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

const progress = deriveActiveExamProgress({ attempt, adapterState: createSyntheticAdapterState() });
assert.deepEqual(progress, { blockNumber: 1, answered: 2, total: 3, source: 'state-fallback' });
assert.equal(formatActiveExamProgress(progress), '2/3 · Block 1');
assert.equal(isAttemptReviewReady({ status: ATTEMPT_STATUS.COMPLETED }), true);
assert.equal(isAttemptReviewReady({ status: ATTEMPT_STATUS.IN_PROGRESS, reviewReady: false }), false);
const manualPatch = buildManualFinishAttemptPatch(attempt, progress, { adapterState: createSyntheticAdapterState(), finishedAt: '2026-05-05T02:00:00.000Z' });
assert.equal(manualPatch.reviewReady, true);
assert.equal(manualPatch.status, ATTEMPT_STATUS.COMPLETED);
assert.equal(manualPatch.source.completion.manual, true);
assert.equal(manualPatch.source.manualFinish.answered, 2);

console.log('scoring and active-exam tests passed');
