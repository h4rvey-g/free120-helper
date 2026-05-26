import { ATTEMPT_STATUS } from '../core/constants.js';
import { coerceNonNegativeInteger, isObject, normalizeString } from '../core/data.js';

function getAttemptReviewEvidenceCount(attempt) {
  if (!isObject(attempt)) {
    return 0;
  }
  const source = isObject(attempt.source) ? attempt.source : {};
  const metadata = isObject(source.itemMetadataByQuestionId) ? source.itemMetadataByQuestionId : {};
  const scoreSummary = isObject(attempt.scoreSummary) ? attempt.scoreSummary : {};
  const scoreTotal = coerceNonNegativeInteger(scoreSummary.total, 0)
    || coerceNonNegativeInteger(scoreSummary.overallScore && scoreSummary.overallScore.total, 0)
    || (Array.isArray(scoreSummary.questionResults) ? scoreSummary.questionResults.length : 0);
  return Math.max(
    Array.isArray(attempt.questionIds) ? attempt.questionIds.length : 0,
    Object.keys(isObject(attempt.responses) ? attempt.responses : {}).length,
    Object.keys(isObject(attempt.correctAnswers) ? attempt.correctAnswers : {}).length,
    Object.keys(metadata).length,
    scoreTotal
  );
}

function hasAttemptReviewEvidence(attempt) {
  return getAttemptReviewEvidenceCount(attempt) > 0;
}

function isAttemptReviewReady(attempt) {
  if (!attempt) {
    return false;
  }
  return Boolean(attempt.reviewReady) || attempt.status === ATTEMPT_STATUS.COMPLETED || attempt.status === ATTEMPT_STATUS.PARTIAL;
}

function canOpenAttemptReview(attempt) {
  return hasAttemptReviewEvidence(attempt) && isAttemptReviewReady(attempt);
}

function isQBankCacheAttempt(attempt) {
  const id = normalizeString(attempt && attempt.id, '');
  const source = isObject(attempt && attempt.source) ? attempt.source : {};
  return id.startsWith('qbank-cache:')
    || normalizeString(source.cacheKind, '') === 'qbank'
    || normalizeString(source.createdBy, '') === 'qbank-cache-controller';
}

function parseDateMs(value) {
  const parsed = Date.parse(normalizeString(value, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAttemptSortTime(attempt) {
  return Math.max(
    parseDateMs(attempt && attempt.updatedAt),
    parseDateMs(attempt && attempt.completedAt),
    parseDateMs(attempt && attempt.startedAt),
    parseDateMs(attempt && attempt.createdAt)
  );
}

function pickLatestEndExamAttempt(attempts) {
  const list = (Array.isArray(attempts) ? attempts.filter(Boolean) : []).filter((attempt) => !isQBankCacheAttempt(attempt));
  if (!list.length) {
    return null;
  }
  const sorted = list.slice().sort((left, right) => {
    const leftEvidence = getAttemptReviewEvidenceCount(left);
    const rightEvidence = getAttemptReviewEvidenceCount(right);
    if (Boolean(leftEvidence) !== Boolean(rightEvidence)) {
      return rightEvidence - leftEvidence;
    }
    return getAttemptSortTime(right) - getAttemptSortTime(left);
  });
  return sorted[0] || null;
}

function shouldPreferStoredEndExamAttempt(currentAttempt, storedAttempt) {
  if (!storedAttempt || isQBankCacheAttempt(storedAttempt)) {
    return false;
  }
  if (!currentAttempt) {
    return true;
  }
  const currentId = normalizeString(currentAttempt.id, '');
  const storedId = normalizeString(storedAttempt.id, '');
  if (currentId && storedId && currentId === storedId) {
    return false;
  }
  const currentEvidence = getAttemptReviewEvidenceCount(currentAttempt);
  const storedEvidence = getAttemptReviewEvidenceCount(storedAttempt);
  if (storedEvidence > 0 && currentEvidence <= 0) {
    return true;
  }
  if (currentEvidence > 0 && storedEvidence <= 0) {
    return false;
  }
  if (isAttemptReviewReady(storedAttempt) && !isAttemptReviewReady(currentAttempt)) {
    return true;
  }
  return getAttemptSortTime(storedAttempt) > getAttemptSortTime(currentAttempt);
}

export {
  hasAttemptReviewEvidence,
  isAttemptReviewReady,
  canOpenAttemptReview,
  isQBankCacheAttempt,
  pickLatestEndExamAttempt,
  shouldPreferStoredEndExamAttempt,
};
