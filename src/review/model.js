import { SCRIPT } from '../core/constants.js';
import { nowIso } from '../core/logger.js';
import {
  arrayOrEmpty,
  coerceNonNegativeInteger,
  coercePositiveInteger,
  isPlainObject,
  normalizeString,
  plainObjectOrEmpty,
  uniqueNormalizedStrings as uniqueStrings,
} from '../core/data.js';
import { buildAttemptScoreSummary, GRADE_STATUS, answersMatch } from '../scoring/grader.js';

const MAX_REVIEW_ITEMS_PER_BLOCK = 40;

function getAttemptItemMetadata(attempt, questionId) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const metadataByQuestionId = plainObjectOrEmpty(source.itemMetadataByQuestionId);
  return plainObjectOrEmpty(metadataByQuestionId[questionId]);
}

function parseBlockNumbers(value) {
  const text = normalizeString(value, '').toLowerCase();
  if (!text || /\b(?:all|full|entire|whole|complete)\b/.test(text)) {
    return [];
  }
  const blockMatches = Array.from(text.matchAll(/\bblock\s*(\d+)\b/g))
    .map((match) => coercePositiveInteger(match[1], 0))
    .filter(Boolean);
  if (blockMatches.length) {
    return uniqueStrings(blockMatches).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  }
  if (/^\d+$/.test(text)) {
    return [coercePositiveInteger(text, 0)].filter(Boolean);
  }
  if (/\bstep\s*(?:1|2\s*ck|3)\b|\bstpf\s*\d+/i.test(text)) {
    return [];
  }
  return uniqueStrings((text.match(/\d+/g) || [])).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
}

function getLaunchedScope(attempt) {
  return plainObjectOrEmpty(attempt && attempt.launchedScope);
}

function launchedScopeSuggestsMultipleBlocks(attempt) {
  const scope = getLaunchedScope(attempt);
  const blockCount = coercePositiveInteger(scope.blockCount || scope.blocks || scope.totalBlocks, 0);
  const modeText = [scope.mode, scope.testMode, scope.scope, scope.launchMode, scope.deliveryMode]
    .map((value) => normalizeString(value, ''))
    .join(' ')
    .toLowerCase();
  const explicitBlockNumbers = uniqueStrings([
    ...parseBlockNumbers(scope.block),
    ...parseBlockNumbers(scope.selectedBlock),
    ...parseBlockNumbers(scope.launchedBlock),
  ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  const allByMode = /\b(?:all|full|entire|whole|complete)\b/.test(modeText);
  if (explicitBlockNumbers.length && !allByMode) {
    return false;
  }
  return blockCount > 1 || allByMode;
}

function getStoredBlockCounts(attempt) {
  const counts = new Map();
  const ids = uniqueStrings([
    ...arrayOrEmpty(attempt && attempt.questionIds),
    ...Object.keys(plainObjectOrEmpty(attempt && attempt.responses)),
    ...Object.keys(plainObjectOrEmpty(attempt && attempt.correctAnswers)),
  ]);
  ids.forEach((questionId) => {
    const metadata = getAttemptItemMetadata(attempt, questionId);
    const blockNumber = coercePositiveInteger(metadata.blockNumber, 0);
    if (blockNumber) {
      counts.set(blockNumber, (counts.get(blockNumber) || 0) + 1);
    }
  });
  return counts;
}

function getDominantStoredBlockNumber(attempt) {
  const counts = getStoredBlockCounts(attempt);
  if (!counts.size) {
    return 0;
  }
  return Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0] - right[0];
  })[0][0];
}

function getSingleProgressBlockNumber(attempt) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const progress = plainObjectOrEmpty(source.progress);
  const byBlock = plainObjectOrEmpty(progress.byBlock);
  const blocks = Object.entries(byBlock).map(([key, block]) => {
    const progressBlock = plainObjectOrEmpty(block);
    return Object.freeze({
      blockNumber: coercePositiveInteger(progressBlock.blockNumber || progressBlock.block || progressBlock.index, coercePositiveInteger(key, 0)),
      total: coercePositiveInteger(progressBlock.total || progressBlock.itemCount || progressBlock.questionCount || progressBlock.itemsCount, 0),
      questionCount: arrayOrEmpty(progressBlock.questionIds).length,
      answeredCount: arrayOrEmpty(progressBlock.answeredQuestionIds).length,
    });
  }).filter((block) => block.blockNumber && (block.total || block.questionCount || block.answeredCount));
  const blockNumbers = uniqueStrings(blocks.map((block) => block.blockNumber))
    .map((entry) => coercePositiveInteger(entry, 0))
    .filter(Boolean);
  return blockNumbers.length === 1 ? blockNumbers[0] : 0;
}

function getSingleBlockMetadataNumber(attempt) {
  const blocks = arrayOrEmpty(attempt && attempt.blockMetadata)
    .map((block, fallbackIndex) => Object.freeze({
      blockNumber: coercePositiveInteger(block && (block.blockNumber || block.block || block.index), fallbackIndex + 1),
      itemCount: coercePositiveInteger(block && (block.itemCount || block.questionCount || block.itemsCount), 0),
    }))
    .filter((block) => block.blockNumber && block.itemCount);
  const blockNumbers = uniqueStrings(blocks.map((block) => block.blockNumber))
    .map((entry) => coercePositiveInteger(entry, 0))
    .filter(Boolean);
  return blockNumbers.length === 1 ? blockNumbers[0] : 0;
}

function getRecordedSingleReviewBlockNumber(attempt) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  return getSingleProgressBlockNumber(attempt)
    || getSingleBlockMetadataNumber(attempt)
    || coercePositiveInteger(source.activeBlock || source.currentBlock, 0);
}

function getSingleReviewBlockNumber(attempt) {
  return getRecordedSingleReviewBlockNumber(attempt)
    || getExplicitReviewBlockNumber(attempt)
    || coercePositiveInteger(getDominantStoredBlockNumber(attempt), 1);
}

function normalizeSingleBlockItemIndex(value, fallback = 1) {
  const index = coercePositiveInteger(value, fallback);
  return ((index - 1) % MAX_REVIEW_ITEMS_PER_BLOCK) + 1;
}

function inferAttemptPositionFromIndex(attempt, attemptIndex) {
  const index = coercePositiveInteger(attemptIndex, 0);
  if (!index) {
    return Object.freeze({ blockNumber: 0, itemIndex: 0 });
  }
  const blocks = arrayOrEmpty(attempt && attempt.blockMetadata)
    .map((block, fallbackIndex) => Object.freeze({
      blockNumber: coercePositiveInteger(block && (block.blockNumber || block.block || block.index), fallbackIndex + 1),
      itemCount: coercePositiveInteger(block && (block.itemCount || block.questionCount || block.itemsCount), MAX_REVIEW_ITEMS_PER_BLOCK),
    }))
    .sort((left, right) => left.blockNumber - right.blockNumber);
  if (blocks.length > 1 && launchedScopeSuggestsMultipleBlocks(attempt)) {
    let remaining = index;
    for (const block of blocks) {
      if (remaining <= block.itemCount) {
        return Object.freeze({ blockNumber: block.blockNumber, itemIndex: remaining });
      }
      remaining -= block.itemCount;
    }
    const overflowOffset = index - blocks.reduce((total, block) => total + block.itemCount, 0) - 1;
    return Object.freeze({
      blockNumber: blocks[blocks.length - 1].blockNumber + Math.floor(Math.max(0, overflowOffset) / MAX_REVIEW_ITEMS_PER_BLOCK) + 1,
      itemIndex: (Math.max(0, overflowOffset) % MAX_REVIEW_ITEMS_PER_BLOCK) + 1,
    });
  }
  if (launchedScopeSuggestsMultipleBlocks(attempt)) {
    return Object.freeze({
      blockNumber: Math.floor((index - 1) / MAX_REVIEW_ITEMS_PER_BLOCK) + 1,
      itemIndex: ((index - 1) % MAX_REVIEW_ITEMS_PER_BLOCK) + 1,
    });
  }
  return Object.freeze({ blockNumber: 1, itemIndex: index });
}

function getReviewScoreSummary(attempt) {
  if (isPlainObject(attempt && attempt.scoreSummary) && Array.isArray(attempt.scoreSummary.questionResults)) {
    return attempt.scoreSummary;
  }
  return buildAttemptScoreSummary(attempt || {}, { reason: 'review-render' });
}

function buildResultByQuestionId(scoreSummary) {
  const resultByQuestionId = new Map();
  arrayOrEmpty(scoreSummary && scoreSummary.questionResults).forEach((result) => {
    const questionId = normalizeString(result && result.questionId, '');
    if (questionId) {
      resultByQuestionId.set(questionId, result);
    }
  });
  return resultByQuestionId;
}

function buildSnapshotByQuestionId(snapshots) {
  const snapshotByQuestionId = new Map();
  arrayOrEmpty(snapshots).forEach((snapshot) => {
    const questionId = normalizeString(snapshot && snapshot.questionId, '');
    if (questionId && !snapshotByQuestionId.has(questionId)) {
      snapshotByQuestionId.set(questionId, snapshot);
    }
  });
  return snapshotByQuestionId;
}

function createQuestionCandidateInfo() {
  return {
    fromAttemptQuestionIds: false,
    fromScore: false,
    fromSnapshot: false,
    fromResponses: false,
    fromCorrectAnswers: false,
    attemptIndex: 0,
  };
}

function getQuestionCandidate(candidateByQuestionId, questionId) {
  const normalizedQuestionId = normalizeString(questionId, '');
  if (!normalizedQuestionId) {
    return null;
  }
  if (!candidateByQuestionId.has(normalizedQuestionId)) {
    candidateByQuestionId.set(normalizedQuestionId, createQuestionCandidateInfo());
  }
  return candidateByQuestionId.get(normalizedQuestionId);
}

function buildQuestionCandidateMap(attempt, snapshots, scoreSummary) {
  const candidateByQuestionId = new Map();
  arrayOrEmpty(attempt && attempt.questionIds).forEach((questionId, index) => {
    const candidate = getQuestionCandidate(candidateByQuestionId, questionId);
    if (candidate) {
      candidate.fromAttemptQuestionIds = true;
      candidate.attemptIndex = candidate.attemptIndex || index + 1;
    }
  });
  arrayOrEmpty(scoreSummary && scoreSummary.questionResults).forEach((result) => {
    const candidate = getQuestionCandidate(candidateByQuestionId, result && result.questionId);
    if (candidate) {
      candidate.fromScore = true;
    }
  });
  arrayOrEmpty(snapshots).forEach((snapshot) => {
    const candidate = getQuestionCandidate(candidateByQuestionId, snapshot && snapshot.questionId);
    if (candidate) {
      candidate.fromSnapshot = true;
    }
  });
  Object.keys(plainObjectOrEmpty(attempt && attempt.responses)).forEach((questionId) => {
    const candidate = getQuestionCandidate(candidateByQuestionId, questionId);
    if (candidate) {
      candidate.fromResponses = true;
    }
  });
  Object.keys(plainObjectOrEmpty(attempt && attempt.correctAnswers)).forEach((questionId) => {
    const candidate = getQuestionCandidate(candidateByQuestionId, questionId);
    if (candidate) {
      candidate.fromCorrectAnswers = true;
    }
  });
  return candidateByQuestionId;
}

function inferFallbackStatus(selectedAnswerId, correctAnswerId) {
  if (!selectedAnswerId) {
    return GRADE_STATUS.OMITTED;
  }
  if (!correctAnswerId) {
    return GRADE_STATUS.UNKNOWN;
  }
  return answersMatch(selectedAnswerId, correctAnswerId) ? GRADE_STATUS.CORRECT : GRADE_STATUS.INCORRECT;
}

function normalizeResponseAliases(attempt) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const aliases = plainObjectOrEmpty(source.responseAliases);
  return Object.freeze({
    byPosition: Object.freeze(plainObjectOrEmpty(aliases.byPosition || source.responsesByPosition)),
    byComponent: Object.freeze(plainObjectOrEmpty(aliases.byComponent || source.responsesByComponent)),
  });
}

function uniqueAliasValue(values) {
  const unique = uniqueStrings(values.map((value) => normalizeString(value, '')).filter(Boolean));
  return unique.length === 1 ? unique[0] : '';
}

function parseComponentAliasKey(key) {
  const parts = normalizeString(key, '').split('\u0000');
  return Object.freeze({
    blockNumber: coercePositiveInteger(parts[0], 0),
    medleyId: normalizeString(parts[1], ''),
    componentId: normalizeString(parts[2], ''),
  });
}

function parsePositionAliasKey(key) {
  const parts = normalizeString(key, '').split('\u0000');
  return Object.freeze({
    blockNumber: coercePositiveInteger(parts[0], 0),
    itemIndex: coercePositiveInteger(parts[1], 0),
  });
}

function getReviewResponseAliasForQuestion(attempt, questionId, snapshot = null, result = null, fallbackIndex = 0) {
  const aliases = normalizeResponseAliases(attempt);
  const byComponent = plainObjectOrEmpty(aliases.byComponent);
  const byPosition = plainObjectOrEmpty(aliases.byPosition);
  if (!Object.keys(byComponent).length && !Object.keys(byPosition).length) {
    return '';
  }
  const metadata = getAttemptItemMetadata(attempt, questionId);
  const timing = getQuestionTimingRecord(attempt, questionId);
  const snapshotMetadata = plainObjectOrEmpty(snapshot && snapshot.metadata);
  const blockCandidates = uniqueStrings([
    metadata.blockNumber,
    timing.blockNumber,
    snapshot && snapshot.blockNumber,
    snapshotMetadata.blockNumber,
    result && result.blockNumber,
    getSingleReviewBlockNumber(attempt),
  ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  const itemIndexCandidates = uniqueStrings([
    metadata.itemIndex,
    timing.itemIndex,
    snapshot && snapshot.itemIndex,
    snapshotMetadata.itemIndex,
    result && result.itemIndex,
    fallbackIndex,
  ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  const componentCandidates = uniqueStrings([
    metadata.componentId,
    snapshotMetadata.componentId,
    result && result.componentId,
  ]);
  const medleyCandidates = uniqueStrings([
    metadata.medleyId,
    snapshotMetadata.medleyId,
    result && result.medleyId,
  ]);

  for (const blockNumber of blockCandidates) {
    for (const medleyId of medleyCandidates) {
      for (const componentId of componentCandidates) {
        const answerId = normalizeString(byComponent[`${blockNumber}\u0000${medleyId}\u0000${componentId}`], '');
        if (answerId) {
          return answerId;
        }
      }
    }
    for (const itemIndex of itemIndexCandidates) {
      const answerId = normalizeString(byPosition[`${blockNumber}\u0000${itemIndex}`], '');
      if (answerId) {
        return answerId;
      }
    }
  }

  for (const medleyId of medleyCandidates) {
    for (const componentId of componentCandidates) {
      const matches = Object.entries(byComponent).filter(([key]) => {
        const parsed = parseComponentAliasKey(key);
        return parsed.medleyId === medleyId && parsed.componentId === componentId;
      }).map(([, answerId]) => answerId);
      const unique = uniqueAliasValue(matches);
      if (unique) {
        return unique;
      }
    }
  }

  for (const itemIndex of itemIndexCandidates) {
    const matches = Object.entries(byPosition).filter(([key]) => parsePositionAliasKey(key).itemIndex === itemIndex).map(([, answerId]) => answerId);
    const unique = uniqueAliasValue(matches);
    if (unique) {
      return unique;
    }
  }
  return '';
}

function choiceAnswerIdMatches(choice, answerId) {
  const normalized = normalizeString(answerId, '').toLowerCase();
  if (!normalized) {
    return false;
  }
  const id = normalizeString(choice && choice.id, '').toLowerCase();
  const index = normalizeString(choice && choice.index, '').toLowerCase();
  const candidates = uniqueStrings([normalized, normalized.includes(':') ? normalized.split(':').pop() : '']).map((entry) => entry.toLowerCase());
  return candidates.includes(id) || candidates.includes(index) || candidates.includes(`option-${index}`);
}

function getSelectedChoiceId(snapshot) {
  return normalizeString(arrayOrEmpty(snapshot && snapshot.choices).find((choice) => choice && choice.selected) && arrayOrEmpty(snapshot && snapshot.choices).find((choice) => choice && choice.selected).id, '');
}

function normalizeSelectedAnswerIdForReview(snapshot, selectedAnswerId) {
  const normalized = normalizeString(selectedAnswerId, '');
  if (!normalized) {
    return '';
  }
  const choices = arrayOrEmpty(snapshot && snapshot.choices);
  const matchingChoice = choices.find((choice) => choiceAnswerIdMatches(choice, normalized));
  if (matchingChoice) {
    return normalizeString(matchingChoice.id, normalized);
  }
  return normalized;
}

function getQuestionTimeline(attempt, questionId) {
  return arrayOrEmpty(attempt && attempt.answerTimeline)
    .filter((entry) => normalizeString(entry && entry.questionId, '') === questionId)
    .map((entry) => Object.freeze({
      id: normalizeString(entry.id, ''),
      changedAt: normalizeString(entry.changedAt, ''),
      fromAnswerId: normalizeString(entry.fromAnswerId, ''),
      toAnswerId: normalizeString(entry.toAnswerId, ''),
      eventType: normalizeString(entry.eventType, ''),
    }));
}

function getQuestionTimingRecord(attempt, questionId) {
  return plainObjectOrEmpty(plainObjectOrEmpty(attempt && attempt.timingByQuestionId)[questionId]);
}

function getQuestionTimingMs(attempt, snapshot, result, questionId) {
  const timing = getQuestionTimingRecord(attempt, questionId);
  return coerceNonNegativeInteger(
    result && result.timingMs,
    coerceNonNegativeInteger(snapshot && snapshot.timingMs, coerceNonNegativeInteger(timing.totalMs || timing.timingMs, 0))
  );
}

function getQuestionNotes(attempt, snapshot, questionId) {
  return normalizeString(
    plainObjectOrEmpty(attempt && attempt.notesByQuestionId)[questionId],
    normalizeString(snapshot && snapshot.notes, '')
  );
}

function getQuestionAnnotations(attempt, snapshot, questionId) {
  const attemptAnnotations = plainObjectOrEmpty(attempt && attempt.annotationsByQuestionId)[questionId];
  if (isPlainObject(attemptAnnotations)) {
    return attemptAnnotations;
  }
  return plainObjectOrEmpty(snapshot && snapshot.annotations);
}

function normalizeChoices(snapshot) {
  return arrayOrEmpty(snapshot && snapshot.choices).map((choice, index) => Object.freeze({
    id: normalizeString(choice && choice.id, `option-${index + 1}`),
    label: normalizeString(choice && choice.label, ''),
    index: coercePositiveInteger(choice && choice.index, index + 1),
    selected: Boolean(choice && choice.selected),
    disabled: Boolean(choice && choice.disabled),
  }));
}

function getSnapshotOriginalItemIndex(snapshot) {
  const metadata = plainObjectOrEmpty(snapshot && snapshot.metadata);
  return coercePositiveInteger(metadata.qbankCacheOriginalItemIndex || metadata.qbankFallbackOriginalItemIndex, 0);
}

function normalizeSnapshotForReview(snapshot) {
  if (!snapshot) {
    return Object.freeze({
      id: '',
      renderedHtml: '',
      promptHtml: '',
      choices: Object.freeze([]),
      resourceUrls: Object.freeze([]),
      metadata: Object.freeze({}),
    });
  }
  return Object.freeze({
    id: normalizeString(snapshot.id, ''),
    capturedAt: normalizeString(snapshot.capturedAt, ''),
    renderedHtml: normalizeString(snapshot.renderedHtml, ''),
    promptHtml: normalizeString(snapshot.promptHtml, ''),
    choices: Object.freeze(normalizeChoices(snapshot)),
    resourceUrls: Object.freeze(arrayOrEmpty(snapshot.resourceUrls).map((url) => normalizeString(url, '')).filter(Boolean)),
    metadata: Object.freeze(plainObjectOrEmpty(snapshot.metadata)),
  });
}

function buildReviewQuestion(attempt, questionId, snapshot, result, candidate = null) {
  const responses = plainObjectOrEmpty(attempt && attempt.responses);
  const correctAnswers = plainObjectOrEmpty(attempt && attempt.correctAnswers);
  const metadata = getAttemptItemMetadata(attempt, questionId);
  const timing = getQuestionTimingRecord(attempt, questionId);
  const responseRecorded = Object.prototype.hasOwnProperty.call(responses, questionId);
  const resultSelectedAnswerId = normalizeString(result && result.selectedAnswerId, '');
  const rawSelectedAnswerId = responseRecorded
    ? normalizeString(responses[questionId], '')
    : (resultSelectedAnswerId || normalizeString(snapshot && snapshot.selectedAnswerId, ''));
  const selectedAnswerId = responseRecorded && !rawSelectedAnswerId
    ? ''
    : normalizeSelectedAnswerIdForReview(snapshot, rawSelectedAnswerId);
  const correctAnswerId = normalizeString(
    result && result.correctAnswerId,
    normalizeString(correctAnswers[questionId], normalizeString(snapshot && snapshot.correctAnswerId, ''))
  );
  const fallbackStatus = inferFallbackStatus(selectedAnswerId, correctAnswerId);
  const resultStatus = normalizeString(result && result.status, '');
  const status = correctAnswerId ? fallbackStatus : normalizeString(resultStatus, fallbackStatus);
  const componentId = normalizeString(
    result && result.componentId,
    normalizeString(metadata.componentId, normalizeString(snapshot && snapshot.metadata && snapshot.metadata.componentId, ''))
  );
  const medleyId = normalizeString(
    result && result.medleyId,
    normalizeString(metadata.medleyId, normalizeString(snapshot && snapshot.metadata && snapshot.metadata.medleyId, ''))
  );
  const resultPositionTrusted = Boolean(componentId || medleyId);
  const candidatePosition = inferAttemptPositionFromIndex(attempt, candidate && candidate.attemptIndex);
  const sourceBlockNumber = coercePositiveInteger(
    metadata.blockNumber,
    coercePositiveInteger(
      timing.blockNumber,
      coercePositiveInteger(snapshot && snapshot.blockNumber, coercePositiveInteger(result && result.blockNumber, 0))
    )
  );
  const singleBlockReview = !launchedScopeSuggestsMultipleBlocks(attempt);
  const metadataBlockNumber = singleBlockReview ? 0 : coercePositiveInteger(metadata.blockNumber, 0);
  const timingBlockNumber = singleBlockReview ? 0 : coercePositiveInteger(timing.blockNumber, 0);
  const snapshotBlockNumber = singleBlockReview ? 0 : coercePositiveInteger(snapshot && snapshot.blockNumber, 0);
  const resultBlockNumber = !singleBlockReview && resultPositionTrusted ? coercePositiveInteger(result && result.blockNumber, 0) : 0;
  const candidateBlockNumber = coercePositiveInteger(candidatePosition.blockNumber, 0);
  const candidateItemIndex = coercePositiveInteger(candidatePosition.itemIndex, 0);
  const originalSnapshotItemIndex = getSnapshotOriginalItemIndex(snapshot);
  const rawItemIndex = coercePositiveInteger(
    originalSnapshotItemIndex,
    coercePositiveInteger(
      metadata.itemIndex,
      coercePositiveInteger(
        timing.itemIndex,
        coercePositiveInteger(
          snapshot && snapshot.itemIndex,
          coercePositiveInteger(candidateItemIndex, coercePositiveInteger(result && result.itemIndex, 1))
        )
      )
    )
  );
  const blockNumber = singleBlockReview
    ? getSingleReviewBlockNumber(attempt)
    : coercePositiveInteger(
        metadataBlockNumber,
        coercePositiveInteger(
          timingBlockNumber,
          coercePositiveInteger(snapshotBlockNumber, coercePositiveInteger(resultBlockNumber, coercePositiveInteger(candidateBlockNumber, 1)))
        )
      );
  const itemIndex = singleBlockReview ? normalizeSingleBlockItemIndex(rawItemIndex) : rawItemIndex;
  const positionTrusted = Boolean(
    coercePositiveInteger(metadata.itemIndex, 0)
      || coercePositiveInteger(timing.itemIndex, 0)
      || coercePositiveInteger(snapshot && snapshot.itemIndex, 0)
      || candidateItemIndex
      || resultPositionTrusted
  );
  return Object.freeze({
    questionId,
    blockNumber,
    itemIndex,
    componentId,
    medleyId,
    status,
    selectedAnswerId,
    correctAnswerId,
    marked: Boolean((result && result.marked) || arrayOrEmpty(attempt && attempt.markedQuestionIds).includes(questionId) || (snapshot && snapshot.marked)),
    timingMs: getQuestionTimingMs(attempt, snapshot, result, questionId),
    notes: getQuestionNotes(attempt, snapshot, questionId),
    annotations: Object.freeze(getQuestionAnnotations(attempt, snapshot, questionId)),
    answerTimeline: Object.freeze(getQuestionTimeline(attempt, questionId)),
    snapshot: normalizeSnapshotForReview(snapshot),
    _positionTrusted: positionTrusted,
    _sourceBlockNumber: sourceBlockNumber,
    _candidate: Object.freeze({ ...(candidate || createQuestionCandidateInfo()) }),
  });
}

function selectReviewShell(snapshots) {
  const shellSnapshot = arrayOrEmpty(snapshots)
    .map((snapshot) => plainObjectOrEmpty(snapshot && snapshot.snapshot).webfredShell)
    .find((shell) => isPlainObject(shell));
  return Object.freeze({
    title: normalizeString(shellSnapshot && shellSnapshot.title, ''),
    navHtml: normalizeString(shellSnapshot && shellSnapshot.navHtml, ''),
    itemShellHtml: normalizeString(shellSnapshot && shellSnapshot.itemShellHtml, ''),
    capturedAt: normalizeString(shellSnapshot && shellSnapshot.capturedAt, ''),
  });
}

function scoreReviewQuestionCandidate(question) {
  const candidate = question && question._candidate ? question._candidate : {};
  return (candidate.fromAttemptQuestionIds ? 100 : 0)
    + (candidate.fromResponses ? 40 : 0)
    + (question && question._positionTrusted ? 40 : 0)
    + (candidate.fromCorrectAnswers ? 20 : 0)
    + (question && question.componentId && question.medleyId ? 20 : 0)
    + (question && question.snapshot && question.snapshot.renderedHtml ? 10 : 0)
    + (candidate.fromScore ? 6 : 0)
    + (candidate.fromSnapshot ? 6 : 0)
    + (question && question.selectedAnswerId ? 3 : 0)
    + (question && question.correctAnswerId ? 3 : 0)
    + (question && !question.questionId.startsWith('webfred:untrusted:') ? 2 : 0);
}

function sortReviewQuestions(questions) {
  return arrayOrEmpty(questions).slice().sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    if (left.itemIndex !== right.itemIndex) {
      return left.itemIndex - right.itemIndex;
    }
    return scoreReviewQuestionCandidate(right) - scoreReviewQuestionCandidate(left);
  });
}

function chooseBetterReviewQuestion(existing, candidate) {
  if (!existing) {
    return candidate;
  }
  const existingScore = scoreReviewQuestionCandidate(existing);
  const candidateScore = scoreReviewQuestionCandidate(candidate);
  if (candidateScore !== existingScore) {
    return candidateScore > existingScore ? candidate : existing;
  }
  return normalizeString(candidate.questionId, '').localeCompare(normalizeString(existing.questionId, '')) < 0 ? candidate : existing;
}

function dedupeReviewPositions(questions) {
  const byPosition = new Map();
  const passthrough = [];
  arrayOrEmpty(questions).forEach((question) => {
    if (!question || !question._positionTrusted) {
      passthrough.push(question);
      return;
    }
    const positionKey = `${coercePositiveInteger(question.blockNumber, 1)}\u0000${coercePositiveInteger(question.itemIndex, 1)}`;
    if (!byPosition.has(positionKey)) {
      byPosition.set(positionKey, []);
    }
    byPosition.get(positionKey).push(question);
  });
  return sortReviewQuestions([
    ...Array.from(byPosition.values()).map((positionQuestions) => (
      positionQuestions.reduce((best, question) => chooseBetterReviewQuestion(best, question), null)
    )).filter(Boolean),
    ...passthrough,
  ]);
}

function limitReviewQuestionsPerBlock(questions) {
  const byBlock = new Map();
  sortReviewQuestions(questions).forEach((question) => {
    const blockNumber = coercePositiveInteger(question && question.blockNumber, 1);
    if (!byBlock.has(blockNumber)) {
      byBlock.set(blockNumber, []);
    }
    byBlock.get(blockNumber).push(question);
  });
  const kept = [];
  Array.from(byBlock.entries()).sort((left, right) => left[0] - right[0]).forEach(([, blockQuestions]) => {
    const preferred = blockQuestions.slice().sort((left, right) => {
      const scoreDelta = scoreReviewQuestionCandidate(right) - scoreReviewQuestionCandidate(left);
      if (scoreDelta) {
        return scoreDelta;
      }
      if (left.itemIndex !== right.itemIndex) {
        return left.itemIndex - right.itemIndex;
      }
      return normalizeString(left.questionId, '').localeCompare(normalizeString(right.questionId, ''));
    }).slice(0, MAX_REVIEW_ITEMS_PER_BLOCK);
    kept.push(...sortReviewQuestions(preferred));
  });
  return sortReviewQuestions(kept);
}

function hasStoredReviewEvidence(question) {
  const candidate = question && question._candidate ? question._candidate : {};
  return Boolean(candidate.fromAttemptQuestionIds || candidate.fromResponses || candidate.fromCorrectAnswers || candidate.fromSnapshot);
}

function getReviewSourceBlockCounts(questions) {
  const counts = new Map();
  arrayOrEmpty(questions).forEach((question) => {
    const blockNumber = coercePositiveInteger(question && question._sourceBlockNumber, 0);
    if (blockNumber) {
      counts.set(blockNumber, (counts.get(blockNumber) || 0) + 1);
    }
  });
  return counts;
}

function getDominantReviewSourceBlockNumber(questions) {
  const counts = getReviewSourceBlockCounts(questions);
  if (!counts.size) {
    return 0;
  }
  return Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0] - right[0];
  })[0][0];
}

function getExplicitReviewBlockNumber(attempt) {
  const scope = getLaunchedScope(attempt);
  return coercePositiveInteger([
    ...parseBlockNumbers(scope.block),
    ...parseBlockNumbers(scope.selectedBlock),
    ...parseBlockNumbers(scope.launchedBlock),
  ][0], 0);
}

function getReviewProgressBlock(attempt) {
  const blockNumber = getSingleReviewBlockNumber(attempt) || getExplicitReviewBlockNumber(attempt);
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const progress = plainObjectOrEmpty(source.progress);
  const byBlock = plainObjectOrEmpty(progress.byBlock);
  return blockNumber ? plainObjectOrEmpty(byBlock[String(blockNumber)] || byBlock[blockNumber]) : {};
}

function getReviewProgressBlockQuestionIds(attempt) {
  return uniqueStrings(arrayOrEmpty(getReviewProgressBlock(attempt).questionIds));
}

function getReviewProgressBlockTotal(attempt) {
  const block = getReviewProgressBlock(attempt);
  return coercePositiveInteger(block.total || block.itemCount || block.questionCount || block.itemsCount, 0);
}

function getReviewBlockMetadataItemCount(attempt, blockNumber) {
  const blocks = arrayOrEmpty(attempt && attempt.blockMetadata);
  const normalizedBlockNumber = coercePositiveInteger(blockNumber, 0);
  const block = blocks.find((entry) => coercePositiveInteger(entry && (entry.blockNumber || entry.block || entry.index), 0) === normalizedBlockNumber)
    || (blocks.length === 1 ? blocks[0] : null);
  return coercePositiveInteger(block && (block.itemCount || block.questionCount || block.itemsCount), 0);
}

function getExpectedSingleReviewItemCount(attempt) {
  if (launchedScopeSuggestsMultipleBlocks(attempt)) {
    return 0;
  }
  const blockNumber = getSingleReviewBlockNumber(attempt);
  const progressTotal = getReviewProgressBlockTotal(attempt);
  const metadataTotal = getReviewBlockMetadataItemCount(attempt, blockNumber);
  const attemptTotal = coercePositiveInteger(attempt && attempt.questionCount, 0);
  const expected = Math.max(progressTotal, metadataTotal, attemptTotal);
  return expected ? Math.min(expected, MAX_REVIEW_ITEMS_PER_BLOCK) : 0;
}

function shouldUseReviewProgressScope(attempt, progressQuestionIds) {
  if (!progressQuestionIds.length) {
    return false;
  }
  const expectedCount = getExpectedSingleReviewItemCount(attempt) || getReviewProgressBlockTotal(attempt);
  return !expectedCount || progressQuestionIds.length >= Math.min(expectedCount, MAX_REVIEW_ITEMS_PER_BLOCK);
}

function selectSingleBlockReviewCandidates(attempt, questions) {
  const list = arrayOrEmpty(questions);
  if (launchedScopeSuggestsMultipleBlocks(attempt)) {
    return list;
  }
  const sourceBlocks = uniqueStrings(list.map((question) => question && question._sourceBlockNumber))
    .map((entry) => coercePositiveInteger(entry, 0))
    .filter(Boolean);
  if (sourceBlocks.length <= 1) {
    return list;
  }
  const recordedBlockNumber = getRecordedSingleReviewBlockNumber(attempt);
  const explicitBlockNumber = getExplicitReviewBlockNumber(attempt);
  const counts = getReviewSourceBlockCounts(list);
  const dominantBlockNumber = getDominantReviewSourceBlockNumber(list);
  const dominantCount = coercePositiveInteger(counts.get(dominantBlockNumber), 0);
  const recordedCount = coercePositiveInteger(counts.get(recordedBlockNumber), 0);
  const explicitCount = coercePositiveInteger(counts.get(explicitBlockNumber), 0);
  const targetBlockNumber = recordedBlockNumber && recordedCount
    ? recordedBlockNumber
    : (explicitBlockNumber && explicitCount >= dominantCount ? explicitBlockNumber : dominantBlockNumber);
  const filtered = list.filter((question) => !coercePositiveInteger(question && question._sourceBlockNumber, 0)
    || coercePositiveInteger(question && question._sourceBlockNumber, 0) === targetBlockNumber);
  return filtered.length ? filtered : list;
}

function stripReviewQuestionInternals(question) {
  const { _positionTrusted, _sourceBlockNumber, _candidate, ...publicQuestion } = question;
  return Object.freeze(publicQuestion);
}

function buildReviewQuestions(sourceAttempt, snapshots, scoreSummary, questionIds = null, candidateByQuestionId = null) {
  const resultByQuestionId = buildResultByQuestionId(scoreSummary);
  const snapshotByQuestionId = buildSnapshotByQuestionId(snapshots);
  const ids = questionIds || Array.from(candidateByQuestionId.keys());
  return sortReviewQuestions(ids.map((questionId) => buildReviewQuestion(
    sourceAttempt,
    questionId,
    snapshotByQuestionId.get(questionId),
    resultByQuestionId.get(questionId),
    candidateByQuestionId && candidateByQuestionId.get(questionId)
  )));
}

function selectValidReviewQuestionIds(sourceAttempt, snapshots, scoreSummary) {
  const candidateByQuestionId = buildQuestionCandidateMap(sourceAttempt, snapshots, scoreSummary);
  const rawQuestions = buildReviewQuestions(sourceAttempt, snapshots, scoreSummary, null, candidateByQuestionId);
  const anchoredQuestions = rawQuestions.filter(hasStoredReviewEvidence);
  const reviewCandidates = anchoredQuestions.length ? anchoredQuestions : rawQuestions;
  const progressQuestionIds = getReviewProgressBlockQuestionIds(sourceAttempt);
  const progressAllowed = new Set(progressQuestionIds);
  const progressScopedCandidates = shouldUseReviewProgressScope(sourceAttempt, progressQuestionIds)
    ? reviewCandidates.filter((question) => progressAllowed.has(normalizeString(question && question.questionId, '')))
    : [];
  const scopedCandidates = progressScopedCandidates.length ? progressScopedCandidates : reviewCandidates;
  return uniqueStrings(limitReviewQuestionsPerBlock(dedupeReviewPositions(selectSingleBlockReviewCandidates(sourceAttempt, scopedCandidates))).map((question) => question.questionId));
}

function filterRecordToQuestionIds(record, questionIds) {
  const allowed = new Set(arrayOrEmpty(questionIds));
  return Object.freeze(Object.fromEntries(Object.entries(plainObjectOrEmpty(record)).filter(([questionId]) => allowed.has(questionId))));
}

function filterSourceToQuestionIds(source, questionIds) {
  const sourceObject = plainObjectOrEmpty(source);
  return Object.freeze({
    ...sourceObject,
    itemMetadataByQuestionId: filterRecordToQuestionIds(sourceObject.itemMetadataByQuestionId, questionIds),
  });
}

function sanitizeMissingReviewQuestionIdPart(value) {
  return normalizeString(value, '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 120) || 'attempt';
}

function createMissingReviewQuestionId(attempt, blockNumber, itemIndex, seenIds) {
  const attemptPart = sanitizeMissingReviewQuestionIdPart(attempt && attempt.id);
  const baseId = `webfred:review-missing:${attemptPart}:block-${blockNumber}:item-${itemIndex}`;
  let candidateId = baseId;
  let suffix = 2;
  while (seenIds.has(candidateId)) {
    candidateId = `${baseId}:${suffix}`;
    suffix += 1;
  }
  return candidateId;
}

function getReviewPaddingItemIndex(sourceAttempt, snapshotByQuestionId, questionId, fallbackIndex) {
  const metadata = getAttemptItemMetadata(sourceAttempt, questionId);
  const timing = getQuestionTimingRecord(sourceAttempt, questionId);
  const snapshot = snapshotByQuestionId.get(questionId);
  return normalizeSingleBlockItemIndex(
    getSnapshotOriginalItemIndex(snapshot),
    coercePositiveInteger(metadata.itemIndex, coercePositiveInteger(timing.itemIndex, coercePositiveInteger(snapshot && snapshot.itemIndex, fallbackIndex)))
  );
}

function padSingleBlockReviewQuestionIds(sourceAttempt, questionIds, snapshots = []) {
  if (launchedScopeSuggestsMultipleBlocks(sourceAttempt)) {
    return arrayOrEmpty(questionIds).slice();
  }
  const expectedCount = getExpectedSingleReviewItemCount(sourceAttempt);
  const ids = uniqueStrings(questionIds);
  if (!expectedCount || ids.length >= expectedCount) {
    return ids;
  }
  const reviewBlockNumber = getSingleReviewBlockNumber(sourceAttempt);
  const snapshotByQuestionId = buildSnapshotByQuestionId(snapshots);
  const seenIds = new Set(ids);
  const usedItemIndexes = new Set();
  ids.forEach((questionId, index) => {
    const itemIndex = getReviewPaddingItemIndex(sourceAttempt, snapshotByQuestionId, questionId, index + 1);
    if (itemIndex >= 1 && itemIndex <= expectedCount) {
      usedItemIndexes.add(itemIndex);
    }
  });
  for (let itemIndex = 1; itemIndex <= expectedCount && ids.length < expectedCount; itemIndex += 1) {
    if (usedItemIndexes.has(itemIndex)) {
      continue;
    }
    const missingQuestionId = createMissingReviewQuestionId(sourceAttempt, reviewBlockNumber, itemIndex, seenIds);
    ids.push(missingQuestionId);
    seenIds.add(missingQuestionId);
    usedItemIndexes.add(itemIndex);
  }
  return ids;
}

function buildScoringAttemptForReview(sourceAttempt, questionIds, snapshots = []) {
  const singleBlockReview = !launchedScopeSuggestsMultipleBlocks(sourceAttempt);
  const ids = singleBlockReview ? padSingleBlockReviewQuestionIds(sourceAttempt, questionIds, snapshots) : arrayOrEmpty(questionIds);
  const allowed = new Set(ids);
  const snapshotByQuestionId = buildSnapshotByQuestionId(snapshots);
  const responses = { ...filterRecordToQuestionIds(sourceAttempt && sourceAttempt.responses, ids) };
  const correctAnswers = { ...filterRecordToQuestionIds(sourceAttempt && sourceAttempt.correctAnswers, ids) };
  allowed.forEach((questionId) => {
    const snapshot = snapshotByQuestionId.get(questionId);
    const responseRecorded = Object.prototype.hasOwnProperty.call(responses, questionId);
    const snapshotSelectedAnswerId = normalizeString(snapshot && snapshot.selectedAnswerId, '');
    if (!responseRecorded && snapshotSelectedAnswerId) {
      responses[questionId] = snapshotSelectedAnswerId;
    }
    if (!normalizeString(correctAnswers[questionId], '') && normalizeString(snapshot && snapshot.correctAnswerId, '')) {
      correctAnswers[questionId] = normalizeString(snapshot.correctAnswerId, '');
    }
  });
  const reviewBlockNumber = getSingleReviewBlockNumber(sourceAttempt);
  const source = filterSourceToQuestionIds(sourceAttempt && sourceAttempt.source, ids);
  const sourceMetadataByQuestionId = plainObjectOrEmpty(source.itemMetadataByQuestionId);
  const metadataByQuestionId = singleBlockReview
    ? Object.freeze(Object.fromEntries(ids.map((questionId, index) => {
        const metadata = plainObjectOrEmpty(sourceMetadataByQuestionId[questionId]);
        return [questionId, Object.freeze({
          ...metadata,
          questionId,
          blockNumber: reviewBlockNumber,
          itemIndex: getReviewPaddingItemIndex(sourceAttempt, snapshotByQuestionId, questionId, index + 1),
        })];
      })))
    : source.itemMetadataByQuestionId;
  return Object.freeze({
    ...sourceAttempt,
    questionIds: Object.freeze(ids),
    questionCount: ids.length,
    blockMetadata: singleBlockReview ? Object.freeze([Object.freeze({ blockNumber: reviewBlockNumber, itemCount: ids.length, label: `Block ${reviewBlockNumber}` })]) : sourceAttempt.blockMetadata,
    responses: Object.freeze(responses),
    correctAnswers: Object.freeze(correctAnswers),
    timingByQuestionId: filterRecordToQuestionIds(sourceAttempt && sourceAttempt.timingByQuestionId, ids),
    markedQuestionIds: Object.freeze(arrayOrEmpty(sourceAttempt && sourceAttempt.markedQuestionIds).filter((questionId) => allowed.has(questionId))),
    source: Object.freeze({ ...source, itemMetadataByQuestionId: metadataByQuestionId }),
    scoreSummary: null,
  });
}

function buildReviewModel(attempt, snapshots = []) {
  const sourceAttempt = plainObjectOrEmpty(attempt);
  const initialScoreSummary = getReviewScoreSummary(sourceAttempt);
  const questionIds = selectValidReviewQuestionIds(sourceAttempt, snapshots, initialScoreSummary);
  const scoringAttempt = buildScoringAttemptForReview(sourceAttempt, questionIds, snapshots);
  const scoringQuestionIds = arrayOrEmpty(scoringAttempt.questionIds);
  const scoreSummary = buildAttemptScoreSummary(scoringAttempt, { reason: 'review-render-filtered' });
  const candidateByQuestionId = buildQuestionCandidateMap(scoringAttempt, snapshots, scoreSummary);
  const questions = buildReviewQuestions(scoringAttempt, snapshots, scoreSummary, scoringQuestionIds, candidateByQuestionId)
    .map(stripReviewQuestionInternals);

  return Object.freeze({
    script: Object.freeze({ name: SCRIPT.NAME, version: SCRIPT.VERSION }),
    generatedAt: nowIso(),
    attempt: Object.freeze({
      id: normalizeString(sourceAttempt.id, ''),
      status: normalizeString(sourceAttempt.status, ''),
      startedAt: normalizeString(sourceAttempt.startedAt, ''),
      completedAt: normalizeString(sourceAttempt.completedAt, ''),
      examIdentity: Object.freeze(plainObjectOrEmpty(sourceAttempt.examIdentity)),
      launchedScope: Object.freeze(plainObjectOrEmpty(sourceAttempt.launchedScope)),
      questionCount: questions.length,
    }),
    scoreSummary,
    shell: selectReviewShell(snapshots),
    questions: Object.freeze(questions),
  });
}

export {
  buildReviewModel,
  getReviewScoreSummary,
  inferFallbackStatus,
};
