import { SCRIPT } from '../core/constants.js';
import { nowIso } from '../core/logger.js';
import { buildAttemptScoreSummary, GRADE_STATUS, answersMatch } from '../scoring/grader.js';
import { isPlainObject, normalizeString } from '../storage/attempt-store.js';

function coerceNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function coercePositiveInteger(value, fallback = 1) {
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

function plainObjectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
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

function getQuestionIds(attempt, snapshots, scoreSummary) {
  return uniqueStrings([
    ...arrayOrEmpty(attempt && attempt.questionIds),
    ...arrayOrEmpty(scoreSummary && scoreSummary.questionResults).map((result) => result && result.questionId),
    ...arrayOrEmpty(snapshots).map((snapshot) => snapshot && snapshot.questionId),
    ...Object.keys(plainObjectOrEmpty(attempt && attempt.responses)),
    ...Object.keys(plainObjectOrEmpty(attempt && attempt.correctAnswers)),
  ]);
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

function getQuestionTimingMs(attempt, snapshot, result, questionId) {
  const timing = plainObjectOrEmpty(plainObjectOrEmpty(attempt && attempt.timingByQuestionId)[questionId]);
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

function buildReviewQuestion(attempt, questionId, snapshot, result) {
  const responses = plainObjectOrEmpty(attempt && attempt.responses);
  const correctAnswers = plainObjectOrEmpty(attempt && attempt.correctAnswers);
  const selectedAnswerId = normalizeString(
    result && result.selectedAnswerId,
    normalizeString(responses[questionId], normalizeString(snapshot && snapshot.selectedAnswerId, ''))
  );
  const correctAnswerId = normalizeString(
    result && result.correctAnswerId,
    normalizeString(correctAnswers[questionId], normalizeString(snapshot && snapshot.correctAnswerId, ''))
  );
  const fallbackStatus = inferFallbackStatus(selectedAnswerId, correctAnswerId);
  const resultStatus = normalizeString(result && result.status, '');
  const status = resultStatus === GRADE_STATUS.UNKNOWN && correctAnswerId
    ? fallbackStatus
    : normalizeString(resultStatus, fallbackStatus);
  return Object.freeze({
    questionId,
    blockNumber: coercePositiveInteger(result && result.blockNumber, coercePositiveInteger(snapshot && snapshot.blockNumber, 1)),
    itemIndex: coercePositiveInteger(result && result.itemIndex, coercePositiveInteger(snapshot && snapshot.itemIndex, 1)),
    componentId: normalizeString(result && result.componentId, normalizeString(snapshot && snapshot.metadata && snapshot.metadata.componentId, '')),
    medleyId: normalizeString(result && result.medleyId, normalizeString(snapshot && snapshot.metadata && snapshot.metadata.medleyId, '')),
    status,
    selectedAnswerId,
    correctAnswerId,
    marked: Boolean((result && result.marked) || arrayOrEmpty(attempt && attempt.markedQuestionIds).includes(questionId) || (snapshot && snapshot.marked)),
    timingMs: getQuestionTimingMs(attempt, snapshot, result, questionId),
    notes: getQuestionNotes(attempt, snapshot, questionId),
    annotations: Object.freeze(getQuestionAnnotations(attempt, snapshot, questionId)),
    answerTimeline: Object.freeze(getQuestionTimeline(attempt, questionId)),
    snapshot: normalizeSnapshotForReview(snapshot),
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

function buildReviewModel(attempt, snapshots = []) {
  const sourceAttempt = plainObjectOrEmpty(attempt);
  const scoreSummary = getReviewScoreSummary(sourceAttempt);
  const resultByQuestionId = buildResultByQuestionId(scoreSummary);
  const snapshotByQuestionId = buildSnapshotByQuestionId(snapshots);
  const questions = getQuestionIds(sourceAttempt, snapshots, scoreSummary).map((questionId) => buildReviewQuestion(
    sourceAttempt,
    questionId,
    snapshotByQuestionId.get(questionId),
    resultByQuestionId.get(questionId)
  )).sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.itemIndex - right.itemIndex;
  });

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
      questionCount: coerceNonNegativeInteger(sourceAttempt.questionCount, questions.length),
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
