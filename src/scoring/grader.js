import { ATTEMPT_STATUS } from '../core/constants.js';
import { nowIso } from '../core/logger.js';
import { isPlainObject, normalizeString } from '../storage/attempt-store.js';

const GRADE_STATUS = Object.freeze({
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  OMITTED: 'omitted',
  UNKNOWN: 'unknown',
});

function coerceNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function coercePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeString(value, '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function normalizeAnswerId(value) {
  return normalizeString(value, '');
}

function answersMatch(left, right) {
  const normalizedLeft = normalizeAnswerId(left);
  const normalizedRight = normalizeAnswerId(right);
  return Boolean(normalizedLeft && normalizedRight && (
    normalizedLeft === normalizedRight || normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
  ));
}

function scoreValue(correct, total) {
  const normalizedCorrect = coerceNonNegativeInteger(correct, 0);
  const normalizedTotal = coerceNonNegativeInteger(total, 0);
  const ratio = normalizedTotal > 0 ? normalizedCorrect / normalizedTotal : 0;
  return Object.freeze({
    correct: normalizedCorrect,
    total: normalizedTotal,
    ratio,
    percent: Math.round(ratio * 1000) / 10,
    label: `${normalizedCorrect}/${normalizedTotal}`,
  });
}

function parseBlockNumbers(value) {
  const text = normalizeString(value, '').toLowerCase();
  if (!text || /\b(?:all|full|entire|whole|complete)\b/.test(text)) {
    return [];
  }
  return uniqueStrings((text.match(/\d+/g) || [])).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
}

function getMetadataByQuestionId(attempt) {
  const source = isPlainObject(attempt && attempt.source) ? attempt.source : {};
  return isPlainObject(source.itemMetadataByQuestionId) ? source.itemMetadataByQuestionId : {};
}

function getQuestionIdsForScoring(attempt, options = {}) {
  const metadata = getMetadataByQuestionId(attempt);
  return uniqueStrings([
    ...(Array.isArray(options.questionIds) ? options.questionIds : []),
    ...(Array.isArray(attempt && attempt.questionIds) ? attempt.questionIds : []),
    ...Object.keys(isPlainObject(attempt && attempt.responses) ? attempt.responses : {}),
    ...Object.keys(isPlainObject(attempt && attempt.correctAnswers) ? attempt.correctAnswers : {}),
    ...Object.keys(metadata),
  ]);
}

function filterRecordToQuestionIds(record, questionIds) {
  const allowed = new Set(Array.isArray(questionIds) ? questionIds : []);
  return Object.freeze(Object.fromEntries(Object.entries(isPlainObject(record) ? record : {}).filter(([questionId]) => allowed.has(questionId))));
}

function buildScoringAttemptForQuestionIds(attempt, questionIds) {
  if (!Array.isArray(questionIds)) {
    return attempt;
  }
  const ids = uniqueStrings(questionIds);
  const allowed = new Set(ids);
  const source = isPlainObject(attempt && attempt.source) ? attempt.source : {};
  return Object.freeze({
    ...attempt,
    questionIds: Object.freeze(ids),
    questionCount: ids.length,
    responses: filterRecordToQuestionIds(attempt && attempt.responses, ids),
    correctAnswers: filterRecordToQuestionIds(attempt && attempt.correctAnswers, ids),
    timingByQuestionId: filterRecordToQuestionIds(attempt && attempt.timingByQuestionId, ids),
    markedQuestionIds: Object.freeze((Array.isArray(attempt && attempt.markedQuestionIds) ? attempt.markedQuestionIds : []).filter((questionId) => allowed.has(questionId))),
    source: Object.freeze({
      ...source,
      itemMetadataByQuestionId: filterRecordToQuestionIds(source.itemMetadataByQuestionId, ids),
    }),
  });
}

function getQuestionMetadata(attempt, questionId) {
  const metadata = getMetadataByQuestionId(attempt);
  const direct = isPlainObject(metadata[questionId]) ? metadata[questionId] : {};
  const timing = isPlainObject(attempt && attempt.timingByQuestionId) && isPlainObject(attempt.timingByQuestionId[questionId])
    ? attempt.timingByQuestionId[questionId]
    : {};
  const timeline = Array.isArray(attempt && attempt.answerTimeline) ? attempt.answerTimeline : [];
  const timelineEntry = timeline.find((entry) => entry && entry.questionId === questionId) || {};
  return Object.freeze({
    questionId,
    blockNumber: coercePositiveInteger(direct.blockNumber || timing.blockNumber || timelineEntry.blockNumber, 1),
    itemIndex: coercePositiveInteger(direct.itemIndex || timing.itemIndex || timelineEntry.itemIndex, 1),
    componentId: normalizeString(direct.componentId, ''),
    medleyId: normalizeString(direct.medleyId, ''),
  });
}

function buildQuestionScoreResult(attempt, questionId) {
  const responses = isPlainObject(attempt && attempt.responses) ? attempt.responses : {};
  const correctAnswers = isPlainObject(attempt && attempt.correctAnswers) ? attempt.correctAnswers : {};
  const timingByQuestionId = isPlainObject(attempt && attempt.timingByQuestionId) ? attempt.timingByQuestionId : {};
  const selectedAnswerId = normalizeAnswerId(responses[questionId]);
  const correctAnswerId = normalizeAnswerId(correctAnswers[questionId]);
  const answered = Boolean(selectedAnswerId);
  const correctAnswerKnown = Boolean(correctAnswerId);
  const gradable = !answered || correctAnswerKnown;
  const status = (() => {
    if (!answered) {
      return GRADE_STATUS.OMITTED;
    }
    if (!correctAnswerKnown) {
      return GRADE_STATUS.UNKNOWN;
    }
    return answersMatch(selectedAnswerId, correctAnswerId) ? GRADE_STATUS.CORRECT : GRADE_STATUS.INCORRECT;
  })();
  const metadata = getQuestionMetadata(attempt, questionId);
  const timing = isPlainObject(timingByQuestionId[questionId]) ? timingByQuestionId[questionId] : {};
  return Object.freeze({
    questionId,
    blockNumber: metadata.blockNumber,
    itemIndex: metadata.itemIndex,
    componentId: metadata.componentId,
    medleyId: metadata.medleyId,
    selectedAnswerId,
    correctAnswerId,
    answered,
    keyKnown: gradable,
    correctAnswerKnown,
    gradable,
    status,
    marked: Array.isArray(attempt && attempt.markedQuestionIds) && attempt.markedQuestionIds.includes(questionId),
    timingMs: coerceNonNegativeInteger(timing.totalMs || timing.timingMs, 0),
  });
}

function emptyScoreAggregate(blockNumber = 0) {
  return {
    blockNumber,
    total: 0,
    answered: 0,
    correct: 0,
    incorrect: 0,
    omitted: 0,
    unknown: 0,
    known: 0,
    statusCounts: {
      correct: 0,
      incorrect: 0,
      omitted: 0,
      unknown: 0,
    },
  };
}

function addQuestionToAggregate(aggregate, result) {
  aggregate.total += 1;
  aggregate.answered += result.answered ? 1 : 0;
  aggregate.correct += result.status === GRADE_STATUS.CORRECT ? 1 : 0;
  aggregate.incorrect += result.status === GRADE_STATUS.INCORRECT ? 1 : 0;
  aggregate.omitted += result.answered ? 0 : 1;
  aggregate.unknown += result.gradable ? 0 : 1;
  aggregate.known += result.gradable ? 1 : 0;
  aggregate.statusCounts[result.status] = (aggregate.statusCounts[result.status] || 0) + 1;
}

function finalizeScoreAggregate(aggregate) {
  const minimumScore = scoreValue(aggregate.correct, aggregate.total);
  const knownKeyScore = scoreValue(aggregate.correct, aggregate.known);
  const overallScore = aggregate.unknown > 0
    ? Object.freeze({ ...minimumScore, basis: 'minimum-known-unknown-keys' })
    : Object.freeze({ ...knownKeyScore, basis: 'all-keys-known' });
  return Object.freeze({
    ...aggregate,
    statusCounts: Object.freeze({ ...aggregate.statusCounts }),
    minimumScore,
    knownKeyScore,
    overallScore,
    scoreComplete: aggregate.unknown === 0,
    summaryText: `${aggregate.correct}/${aggregate.total} minimum · ${aggregate.correct}/${aggregate.known} graded · ${aggregate.unknown} unknown`,
  });
}

function buildAttemptScoreSummary(attempt, options = {}) {
  const scoredAt = options.scoredAt || nowIso();
  const questionIds = getQuestionIdsForScoring(attempt, options);
  const questionResults = questionIds.map((questionId) => buildQuestionScoreResult(attempt, questionId));
  const overall = emptyScoreAggregate(0);
  const blocks = new Map();
  questionResults.forEach((result) => {
    addQuestionToAggregate(overall, result);
    const blockNumber = coercePositiveInteger(result.blockNumber, 1);
    if (!blocks.has(blockNumber)) {
      blocks.set(blockNumber, emptyScoreAggregate(blockNumber));
    }
    addQuestionToAggregate(blocks.get(blockNumber), result);
  });
  const finalizedOverall = finalizeScoreAggregate(overall);
  return Object.freeze({
    schemaVersion: 1,
    scoredAt,
    reason: normalizeString(options.reason, 'completion'),
    total: finalizedOverall.total,
    answered: finalizedOverall.answered,
    correct: finalizedOverall.correct,
    incorrect: finalizedOverall.incorrect,
    omitted: finalizedOverall.omitted,
    unknown: finalizedOverall.unknown,
    known: finalizedOverall.known,
    statusCounts: finalizedOverall.statusCounts,
    minimumScore: finalizedOverall.minimumScore,
    knownKeyScore: finalizedOverall.knownKeyScore,
    overallScore: finalizedOverall.overallScore,
    scoreComplete: finalizedOverall.scoreComplete,
    summaryText: finalizedOverall.summaryText,
    perBlock: Object.freeze(Array.from(blocks.values()).sort((left, right) => left.blockNumber - right.blockNumber).map(finalizeScoreAggregate)),
    questionResults: Object.freeze(questionResults),
  });
}

function getKnownBlockNumbers(attempt, adapterState = null) {
  const metadata = getMetadataByQuestionId(attempt);
  const fromItems = Object.values(metadata).map((item) => coercePositiveInteger(item && item.blockNumber, 0));
  const fromAttemptBlocks = (Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : [])
    .map((block) => coercePositiveInteger(block && block.blockNumber, 0));
  const fromAdapterBlocks = (Array.isArray(adapterState && adapterState.blockMetadata) ? adapterState.blockMetadata : [])
    .map((block) => coercePositiveInteger(block && block.blockNumber, 0));
  return uniqueStrings([...fromItems, ...fromAttemptBlocks, ...fromAdapterBlocks, adapterState && adapterState.currentBlock])
    .map((entry) => coercePositiveInteger(entry, 0))
    .filter(Boolean)
    .sort((left, right) => left - right);
}

function inferAttemptScope(attempt, adapterState = null) {
  const scope = Object.freeze({
    ...(isPlainObject(attempt && attempt.launchedScope) ? attempt.launchedScope : {}),
    ...(isPlainObject(adapterState && adapterState.launchedScope) ? adapterState.launchedScope : {}),
  });
  const modeText = [scope.mode, scope.testMode, scope.scope, scope.launchMode, scope.deliveryMode].map((value) => normalizeString(value, '')).join(' ').toLowerCase();
  const explicitBlockNumbers = uniqueStrings([
    ...parseBlockNumbers(scope.block),
    ...parseBlockNumbers(scope.selectedBlock),
    ...parseBlockNumbers(scope.launchedBlock),
  ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  const knownBlockNumbers = getKnownBlockNumbers(attempt, adapterState);
  const blockCount = coercePositiveInteger(
    adapterState && adapterState.blockCount,
    Math.max(coercePositiveInteger(scope.blockCount || scope.blocks || scope.totalBlocks, 0), knownBlockNumbers.length)
  );
  const allByMode = /\b(?:all|full|entire|whole|complete)\b/.test(modeText);
  const launchedBlockNumbers = (() => {
    if (explicitBlockNumbers.length && !allByMode) {
      return explicitBlockNumbers;
    }
    if (allByMode || blockCount > 1) {
      return blockCount > 1 ? Array.from({ length: blockCount }, (_item, index) => index + 1) : knownBlockNumbers;
    }
    return knownBlockNumbers.length ? knownBlockNumbers : (blockCount === 1 ? [1] : []);
  })();
  return Object.freeze({
    isAllBlockLaunch: Boolean(allByMode || launchedBlockNumbers.length > 1),
    allByMode,
    blockCount,
    explicitBlockNumbers: Object.freeze(explicitBlockNumbers),
    launchedBlockNumbers: Object.freeze(uniqueStrings(launchedBlockNumbers).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean)),
    scope,
  });
}

function inferNativeCompletionState(attempt, adapterState = null) {
  const scope = inferAttemptScope(attempt, adapterState);
  const terminal = isPlainObject(adapterState && adapterState.terminalState) ? adapterState.terminalState : {};
  const previousCompletion = isPlainObject(attempt && attempt.source && attempt.source.completion) ? attempt.source.completion : {};
  const observedCompletedBlocks = uniqueStrings([
    ...(Array.isArray(previousCompletion.completedBlockNumbers) ? previousCompletion.completedBlockNumbers : []),
    ...(Array.isArray(terminal.completedBlockNumbers) ? terminal.completedBlockNumbers : []),
    terminal.blockComplete ? (terminal.currentBlock || (adapterState && adapterState.currentBlock)) : '',
  ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean).sort((left, right) => left - right);
  const terminalDetected = Boolean(terminal.isTerminal || terminal.blockComplete || terminal.examComplete || terminal.allBlocksComplete);
  const allLaunchedBlocksComplete = scope.launchedBlockNumbers.length > 0
    && !(scope.allByMode && scope.blockCount <= 1)
    && scope.launchedBlockNumbers.every((blockNumber) => observedCompletedBlocks.includes(blockNumber));
  const shouldComplete = terminalDetected && (scope.isAllBlockLaunch
    ? Boolean(terminal.examComplete || terminal.allBlocksComplete || allLaunchedBlocksComplete)
    : true);
  return Object.freeze({
    terminalDetected,
    shouldComplete,
    reviewLocked: Boolean(terminalDetected && scope.isAllBlockLaunch && !shouldComplete),
    completionStatus: shouldComplete ? ATTEMPT_STATUS.COMPLETED : ATTEMPT_STATUS.IN_PROGRESS,
    reason: shouldComplete ? 'native-terminal-complete' : (terminalDetected ? 'native-terminal-incomplete-all-block' : 'not-terminal'),
    completedBlockNumbers: Object.freeze(observedCompletedBlocks),
    allLaunchedBlocksComplete,
    scope,
    terminalState: Object.freeze({ ...terminal }),
  });
}

function hasCapturedAllLaunchedBlocks(attempt, adapterState = null) {
  const scope = inferAttemptScope(attempt, adapterState);
  if (!scope.isAllBlockLaunch) {
    return true;
  }
  if (scope.allByMode && scope.blockCount <= 1) {
    return false;
  }
  const knownBlocks = getKnownBlockNumbers(attempt, adapterState);
  return scope.launchedBlockNumbers.length > 0 && scope.launchedBlockNumbers.every((blockNumber) => knownBlocks.includes(blockNumber));
}

function shouldManualFinishCompleteAttempt(attempt, adapterState = null) {
  const nativeCompletion = inferNativeCompletionState(attempt, adapterState);
  if (nativeCompletion.shouldComplete) {
    return true;
  }
  const scope = nativeCompletion.scope;
  return !scope.isAllBlockLaunch || hasCapturedAllLaunchedBlocks(attempt, adapterState);
}

function buildAttemptCompletionPatch(attempt, options = {}) {
  const completedAt = options.completedAt || nowIso();
  const adapterState = options.adapterState || null;
  const nativeCompletion = options.completionState || inferNativeCompletionState(attempt, adapterState);
  const manual = Boolean(options.manual);
  const partial = options.partial === true || (!manual && nativeCompletion.reviewLocked);
  const status = partial ? ATTEMPT_STATUS.PARTIAL : ATTEMPT_STATUS.COMPLETED;
  const existingSource = isPlainObject(attempt && attempt.source) ? attempt.source : {};
  const scoringQuestionIds = Array.isArray(options.questionIds)
    ? options.questionIds
    : (adapterState && Array.isArray(adapterState.itemList) && adapterState.itemList.length
        ? adapterState.itemList.map((item) => item && item.questionId).filter(Boolean)
        : null);
  const scoredAttempt = buildScoringAttemptForQuestionIds(Object.freeze({ ...attempt, status, completedAt }), scoringQuestionIds);
  const scoreSummary = buildAttemptScoreSummary(scoredAttempt, {
    scoredAt: completedAt,
    reason: normalizeString(options.reason, manual ? 'manual-finish' : nativeCompletion.reason),
  });
  return Object.freeze({
    status,
    reviewReady: true,
    completedAt,
    scoreSummary,
    source: Object.freeze({
      ...existingSource,
      completion: Object.freeze({
        ...(isPlainObject(existingSource.completion) ? existingSource.completion : {}),
        completedAt,
        status,
        reviewReady: true,
        manual,
        reason: normalizeString(options.reason, manual ? 'manual-finish' : nativeCompletion.reason),
        completedBlockNumbers: nativeCompletion.completedBlockNumbers,
        allLaunchedBlocksComplete: nativeCompletion.allLaunchedBlocksComplete,
        scope: nativeCompletion.scope,
        terminalState: nativeCompletion.terminalState,
      }),
    }),
  });
}

export {
  GRADE_STATUS,
  normalizeAnswerId,
  answersMatch,
  buildAttemptScoreSummary,
  buildAttemptCompletionPatch,
  inferAttemptScope,
  inferNativeCompletionState,
  shouldManualFinishCompleteAttempt,
};
