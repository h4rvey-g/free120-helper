import { SCRIPT } from '../core/constants.js';
import { coerceNonNegativeInteger, hasFunction, isObject, normalizeString } from '../core/data.js';
import { nowIso } from '../core/logger.js';
import { buildAttemptCompletionPatch, buildAttemptScoreSummary } from '../scoring/grader.js';
import { loadQBankCaptureContext, resolveQBankCaptureForItems } from '../qbank/cache-lookup.js';
import { createElement, removeChildren, setMessage } from './dom.js';
import {
  hasAttemptReviewEvidence,
  isAttemptReviewReady,
  pickLatestEndExamAttempt,
  shouldPreferStoredEndExamAttempt,
} from '../review/readiness.js';

const ACTIVE_EXAM_PILL_STYLE_ID = 'f120-active-exam-pill-style';
const END_EXAM_REVIEW_CTA_ID = 'f120-end-exam-review-cta';
const REVIEW_READY_EVENT = 'free120-helper:review-ready';
const END_EXAM_REVIEW_LOCKED_MESSAGE = 'Review unlocks after the helper finishes local grading.';

function isNonEmptyAnswer(value) {
  return normalizeString(value, '') !== '';
}

function truncateMiddle(value, maxLength = 28) {
  const text = normalizeString(value, '');
  if (text.length <= maxLength) {
    return text;
  }
  const edge = Math.max(4, Math.floor((maxLength - 1) / 2));
  return `${text.slice(0, edge)}…${text.slice(-edge)}`;
}

function countAnsweredResponses(responses, questionIds = null) {
  const responseMap = isObject(responses) ? responses : {};
  const ids = Array.isArray(questionIds) && questionIds.length ? questionIds : Object.keys(responseMap);
  return ids.reduce((count, questionId) => count + (isNonEmptyAnswer(responseMap[questionId]) ? 1 : 0), 0);
}

function normalizeProgressBlock(candidate) {
  if (!isObject(candidate)) {
    return null;
  }
  return Object.freeze({
    blockNumber: coerceNonNegativeInteger(candidate.blockNumber, 0),
    answered: coerceNonNegativeInteger(candidate.answered, 0),
    total: coerceNonNegativeInteger(candidate.total, 0),
    questionIds: Array.isArray(candidate.questionIds) ? candidate.questionIds.filter(Boolean) : [],
    answeredQuestionIds: Array.isArray(candidate.answeredQuestionIds) ? candidate.answeredQuestionIds.filter(Boolean) : [],
  });
}

function normalizeProgressByBlock(progress) {
  const byBlock = isObject(progress && progress.byBlock) ? progress.byBlock : {};
  const normalized = {};
  Object.entries(byBlock).forEach(([key, value]) => {
    const block = normalizeProgressBlock(value);
    const blockNumber = block && (block.blockNumber || coerceNonNegativeInteger(key, 0));
    if (block && blockNumber > 0) {
      normalized[String(blockNumber)] = Object.freeze({ ...block, blockNumber });
    }
  });
  return Object.freeze(normalized);
}

function getSortedBlockNumbers(progressByBlock) {
  return Object.keys(isObject(progressByBlock) ? progressByBlock : {})
    .map((key) => coerceNonNegativeInteger(key, 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
}

function chooseCurrentBlockNumber(adapterState, attempt, progressByBlock) {
  const fromState = coerceNonNegativeInteger(adapterState && adapterState.currentBlock, 0)
    || coerceNonNegativeInteger(adapterState && adapterState.currentItem && adapterState.currentItem.blockNumber, 0);
  if (fromState > 0) {
    return fromState;
  }

  const fromAttemptSource = coerceNonNegativeInteger(attempt && attempt.source && attempt.source.activeBlock, 0)
    || coerceNonNegativeInteger(attempt && attempt.source && attempt.source.currentBlock, 0);
  if (fromAttemptSource > 0) {
    return fromAttemptSource;
  }

  const fromBlocks = getSortedBlockNumbers(progressByBlock)[0];
  if (fromBlocks > 0) {
    return fromBlocks;
  }

  const metadata = Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : [];
  const fromMetadata = coerceNonNegativeInteger(metadata[0] && metadata[0].blockNumber, 0);
  return fromMetadata || 1;
}

function mergeResponsesForProgress(attempt, adapterState) {
  return Object.freeze({
    ...(isObject(attempt && attempt.responses) ? attempt.responses : {}),
    ...(isObject(adapterState && adapterState.answers) ? adapterState.answers : {}),
  });
}

function getBlockQuestionIds(adapterState, attempt, blockNumber) {
  const stateItems = Array.isArray(adapterState && adapterState.itemList) ? adapterState.itemList : [];
  const stateIds = stateItems
    .filter((item) => coerceNonNegativeInteger(item && item.blockNumber, blockNumber) === blockNumber)
    .map((item) => normalizeString(item && item.questionId, ''))
    .filter(Boolean);
  if (stateIds.length) {
    return stateIds;
  }

  const progress = attempt && attempt.source && attempt.source.progress;
  const progressByBlock = normalizeProgressByBlock(progress);
  const progressBlock = progressByBlock[String(blockNumber)];
  if (progressBlock && progressBlock.questionIds.length) {
    return progressBlock.questionIds;
  }

  return Array.isArray(attempt && attempt.questionIds) ? attempt.questionIds.filter(Boolean) : [];
}

function inferBlockTotal(adapterState, attempt, blockNumber, questionIds) {
  if (Array.isArray(questionIds) && questionIds.length) {
    return questionIds.length;
  }

  const metadata = Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : [];
  const blockMetadata = metadata.find((block) => coerceNonNegativeInteger(block && block.blockNumber, 0) === blockNumber);
  const metadataTotal = coerceNonNegativeInteger(blockMetadata && blockMetadata.itemCount, 0);
  if (metadataTotal > 0) {
    return metadataTotal;
  }

  const stateTotal = coerceNonNegativeInteger(adapterState && adapterState.itemCount, 0);
  if (stateTotal > 0) {
    return stateTotal;
  }

  return coerceNonNegativeInteger(attempt && attempt.questionCount, 0);
}

function deriveActiveExamProgress(candidate = {}) {
  const attempt = candidate.attempt || null;
  const adapterState = candidate.adapterState || null;
  const progress = attempt && attempt.source && attempt.source.progress ? attempt.source.progress : {};
  const progressByBlock = normalizeProgressByBlock(progress);
  const blockNumber = chooseCurrentBlockNumber(adapterState, attempt, progressByBlock);
  const liveQuestionIds = getBlockQuestionIds(adapterState, attempt, blockNumber);
  if (adapterState && Array.isArray(adapterState.itemList) && adapterState.itemList.length) {
    const responses = mergeResponsesForProgress(attempt, adapterState);
    const total = inferBlockTotal(adapterState, attempt, blockNumber, liveQuestionIds);
    const answered = countAnsweredResponses(responses, liveQuestionIds);
    return Object.freeze({
      blockNumber,
      answered: total > 0 ? Math.min(answered, total) : answered,
      total,
      source: 'adapter-state',
    });
  }
  const progressBlock = progressByBlock[String(blockNumber)];

  if (progressBlock && progressBlock.total > 0) {
    return Object.freeze({
      blockNumber,
      answered: Math.min(progressBlock.answered, progressBlock.total),
      total: progressBlock.total,
      source: 'tracking-progress',
    });
  }

  const overall = normalizeProgressBlock(progress && progress.overall);
  if (overall && overall.total > 0 && !Object.keys(progressByBlock).length) {
    return Object.freeze({
      blockNumber,
      answered: Math.min(overall.answered, overall.total),
      total: overall.total,
      source: 'tracking-overall',
    });
  }

  const responses = mergeResponsesForProgress(attempt, adapterState);
  const questionIds = getBlockQuestionIds(adapterState, attempt, blockNumber);
  const total = inferBlockTotal(adapterState, attempt, blockNumber, questionIds);
  const answered = countAnsweredResponses(responses, questionIds);
  return Object.freeze({
    blockNumber,
    answered: total > 0 ? Math.min(answered, total) : answered,
    total,
    source: 'state-fallback',
  });
}

function formatActiveExamProgress(progress) {
  const normalized = progress || deriveActiveExamProgress();
  const answered = coerceNonNegativeInteger(normalized.answered, 0);
  const total = coerceNonNegativeInteger(normalized.total, 0);
  const blockNumber = coerceNonNegativeInteger(normalized.blockNumber, 1) || 1;
  return `${answered}/${total} · Block ${blockNumber}`;
}

function isEndExamRoute(currentLocation) {
  const href = normalizeString(currentLocation && currentLocation.href, '');
  const hash = normalizeString(currentLocation && currentLocation.hash, '');
  return /(?:#|%23)!?\/endExam(?:[/?#]|$)/i.test(href)
    || /^#!?\/endExam(?:[/?#]|$)/i.test(hash)
    || /\/endExam(?:[/?#]|$)/i.test(hash);
}

function isTerminalAdapterState(adapterState) {
  const terminalState = isObject(adapterState && adapterState.terminalState) ? adapterState.terminalState : {};
  return Boolean(terminalState.isTerminal || terminalState.blockComplete || terminalState.examComplete || terminalState.allBlocksComplete);
}

function deriveEndExamReviewState(candidate = {}) {
  const attempt = candidate.attempt || null;
  const adapterState = candidate.adapterState || null;
  const routeMatched = isEndExamRoute(candidate.location || (candidate.window && candidate.window.location));
  const terminalDetected = isTerminalAdapterState(adapterState);
  const reviewReady = isAttemptReviewReady(attempt);
  const reviewEvidence = hasAttemptReviewEvidence(attempt);
  const visible = Boolean(routeMatched);
  return Object.freeze({
    visible,
    enabled: Boolean(visible && attempt && reviewReady && reviewEvidence),
    routeMatched,
    terminalDetected,
    reviewReady,
    reviewEvidence,
    reason: visible ? 'end-exam-route' : 'not-ended',
  });
}

function uniquePositiveIntegers(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = coerceNonNegativeInteger(value, 0);
    if (normalized > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result.sort((left, right) => left - right);
}

function getAttemptBlockNumbers(attempt, adapterState = null) {
  const source = isObject(attempt && attempt.source) ? attempt.source : {};
  const metadata = isObject(source.itemMetadataByQuestionId) ? source.itemMetadataByQuestionId : {};
  return uniquePositiveIntegers([
    ...((Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : []).map((block) => block && block.blockNumber)),
    ...((Array.isArray(adapterState && adapterState.blockMetadata) ? adapterState.blockMetadata : []).map((block) => block && block.blockNumber)),
    ...Object.values(metadata).map((item) => item && item.blockNumber),
    adapterState && adapterState.currentBlock,
  ]);
}

function buildEndExamCompletionAdapterState(attempt, adapterState = null) {
  const blockNumbers = getAttemptBlockNumbers(attempt, adapterState);
  const blockCount = Math.max(
    coerceNonNegativeInteger(adapterState && adapterState.blockCount, 0),
    coerceNonNegativeInteger(attempt && attempt.launchedScope && attempt.launchedScope.blockCount, 0),
    blockNumbers.length,
    1
  );
  const completedBlockNumbers = blockCount > 0
    ? Array.from({ length: blockCount }, (_item, index) => index + 1)
    : blockNumbers;
  const currentBlock = completedBlockNumbers[completedBlockNumbers.length - 1]
    || coerceNonNegativeInteger(adapterState && adapterState.currentBlock, 0)
    || 1;
  const existingTerminal = isObject(adapterState && adapterState.terminalState) ? adapterState.terminalState : {};
  const attemptItemList = buildItemListFromAttemptMetadata(attempt);
  const adapterItemList = Array.isArray(adapterState && adapterState.itemList) ? adapterState.itemList : [];
  const completionItemList = attemptItemList.length > adapterItemList.length ? attemptItemList : adapterItemList;
  return Object.freeze({
    ...(isObject(adapterState) ? adapterState : {}),
    currentBlock,
    blockCount,
    itemCount: Math.max(completionItemList.length, coerceNonNegativeInteger(adapterState && adapterState.itemCount, 0), coerceNonNegativeInteger(attempt && attempt.questionCount, 0)),
    itemList: Object.freeze(completionItemList),
    terminalState: Object.freeze({
      ...existingTerminal,
      isTerminal: true,
      blockComplete: true,
      examComplete: true,
      allBlocksComplete: true,
      currentBlock,
      completedBlockNumbers: Object.freeze(completedBlockNumbers),
      reason: normalizeString(existingTerminal.reason, 'end-exam-route'),
    }),
  });
}

function buildEndExamCompletionPatch(attempt, adapterState = null, options = {}) {
  const completedAt = options.completedAt || nowIso();
  return buildAttemptCompletionPatch(attempt, {
    adapterState: buildEndExamCompletionAdapterState(attempt, adapterState),
    completedAt,
    reason: normalizeString(options.reason, 'native-end-exam-route'),
  });
}

function hasFailedQBankNoMatch(attempt) {
  const summary = isObject(attempt && attempt.answerKeyCapture) ? attempt.answerKeyCapture : {};
  return normalizeString(summary.status, '') === 'failed'
    && normalizeString(summary.failureReason, '') === 'qbank-cache-no-matches';
}

function getAttemptMetadataByQuestionId(attempt) {
  const source = isObject(attempt && attempt.source) ? attempt.source : {};
  return isObject(source.itemMetadataByQuestionId) ? source.itemMetadataByQuestionId : {};
}

function buildItemListFromAttemptMetadata(attempt) {
  const metadataByQuestionId = getAttemptMetadataByQuestionId(attempt);
  return (Array.isArray(attempt && attempt.questionIds) ? attempt.questionIds : [])
    .map((questionId, index) => {
      const metadata = isObject(metadataByQuestionId[questionId]) ? metadataByQuestionId[questionId] : {};
      return Object.freeze({
        questionId,
        componentId: normalizeString(metadata.componentId, ''),
        medleyId: normalizeString(metadata.medleyId, ''),
        blockNumber: coerceNonNegativeInteger(metadata.blockNumber, 0) || coerceNonNegativeInteger(attempt && attempt.launchedScope && attempt.launchedScope.block, 1) || 1,
        itemIndex: coerceNonNegativeInteger(metadata.itemIndex, index + 1) || index + 1,
        selectedAnswerId: normalizeString(attempt && attempt.responses && attempt.responses[questionId], ''),
        identitySource: normalizeString(metadata.identitySource, ''),
        source: normalizeString(metadata.source, ''),
      });
    })
    .filter((item) => normalizeString(item.questionId, ''));
}

async function refreshAttemptQBankKeysForEndExam(storage, attempt, logger = null) {
  if (!storage || !attempt || !hasFailedQBankNoMatch(attempt)) {
    return attempt;
  }
  const itemList = buildItemListFromAttemptMetadata(attempt);
  if (!itemList.length) {
    return attempt;
  }
  const context = await loadQBankCaptureContext(storage, logger);
  const capture = resolveQBankCaptureForItems(context, {
    attempt,
    itemList,
    questionIds: attempt.questionIds,
    expectedCount: Math.max(itemList.length, coerceNonNegativeInteger(attempt.questionCount, 0)),
    allowScopeBlockRepair: true,
  });
  const summary = capture && capture.summary ? capture.summary : null;
  const correctAnswers = capture && isObject(capture.correctAnswers) ? capture.correctAnswers : {};
  if (!summary || !Object.keys(correctAnswers).length) {
    return attempt;
  }
  const patchedAttempt = Object.freeze({
    ...attempt,
    correctAnswers: Object.freeze({ ...(isObject(attempt.correctAnswers) ? attempt.correctAnswers : {}), ...correctAnswers }),
    answerKeyCapture: Object.freeze({ ...summary }),
    source: Object.freeze({
      ...(isObject(attempt.source) ? attempt.source : {}),
      qbankCache: capture && capture.source ? capture.source : {},
    }),
  });
  return storage.updateAttempt(attempt.id, {
    correctAnswers: patchedAttempt.correctAnswers,
    answerKeyCapture: patchedAttempt.answerKeyCapture,
    scoreSummary: buildAttemptScoreSummary(patchedAttempt, { reason: 'end-exam-qbank-refresh' }),
    source: patchedAttempt.source,
  });
}

function injectActiveExamPillStyles(adapterDocument) {
  if (!adapterDocument || adapterDocument.getElementById(ACTIVE_EXAM_PILL_STYLE_ID)) {
    return;
  }

  const style = adapterDocument.createElement('style');
  style.id = ACTIVE_EXAM_PILL_STYLE_ID;
  style.textContent = `
    #f120-active-exam-pill {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: ${SCRIPT.UI_Z_INDEX.PILL};
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.35;
      color: #111827;
      pointer-events: none;
    }
    #f120-active-exam-pill.f120-active-exam-pill--hidden {
      display: none !important;
    }
    #f120-active-exam-pill * {
      box-sizing: border-box;
    }
    .f120-active-exam-pill__shell {
      display: flex;
      align-items: center;
      gap: 6px;
      pointer-events: auto;
    }
    .f120-active-exam-pill__button,
    .f120-active-exam-pill__icon-button {
      border: 1px solid rgba(17, 24, 39, 0.18);
      background: rgba(255, 255, 255, 0.96);
      color: #111827;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      cursor: pointer;
      font: inherit;
    }
    .f120-active-exam-pill__button {
      min-width: 108px;
      border-radius: 999px;
      padding: 7px 11px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .f120-active-exam-pill__button:hover,
    .f120-active-exam-pill__icon-button:hover {
      background: #f8fafc;
      border-color: rgba(37, 99, 235, 0.45);
    }
    .f120-active-exam-pill__button:focus-visible,
    .f120-active-exam-pill__icon-button:focus-visible,
    .f120-active-exam-pill__checkbox input:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.35);
      outline-offset: 2px;
    }
    .f120-active-exam-pill__icon-button {
      width: 31px;
      height: 31px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      font-size: 15px;
    }
    .f120-active-exam-pill__panel {
      position: absolute;
      top: 40px;
      right: 0;
      width: min(340px, calc(100vw - 24px));
      max-height: min(560px, calc(100vh - 64px));
      overflow: auto;
      pointer-events: auto;
      background: rgba(255, 255, 255, 0.98);
      color: #111827;
      border: 1px solid rgba(15, 23, 42, 0.15);
      border-radius: 14px;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.28);
      padding: 12px;
    }
    .f120-active-exam-pill__panel[hidden] {
      display: none !important;
    }
    .f120-active-exam-pill__title {
      margin: 0 0 8px;
      font-size: 14px;
      font-weight: 800;
    }
    .f120-active-exam-pill__muted {
      color: #475569;
      font-size: 12px;
    }
    .f120-active-exam-pill__checkbox {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 8px 0;
      user-select: none;
    }
    .f120-active-exam-pill__checkbox input {
      margin-top: 2px;
    }
    .f120-active-exam-pill__details {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 6px 10px;
      margin: 10px 0;
      padding: 10px 0;
      border-top: 1px solid rgba(15, 23, 42, 0.1);
      border-bottom: 1px solid rgba(15, 23, 42, 0.1);
    }
    .f120-active-exam-pill__detail-label {
      color: #475569;
      font-weight: 650;
      white-space: nowrap;
    }
    .f120-active-exam-pill__detail-value {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #111827;
    }
    .f120-active-exam-pill__message {
      margin-top: 8px;
      padding: 8px;
      border-radius: 10px;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 12px;
    }
    .f120-active-exam-pill__message[data-kind="warning"] {
      background: #fffbeb;
      color: #92400e;
    }
    .f120-active-exam-pill__message[data-kind="error"] {
      background: #fef2f2;
      color: #991b1b;
    }
    .f120-active-exam-pill__message[hidden] {
      display: none !important;
    }
    #f120-end-exam-review-cta {
      display: block;
      pointer-events: auto;
      max-width: max-content;
      margin: 12px 0;
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
      color: #111827;
    }
    #f120-end-exam-review-cta[hidden] {
      display: none !important;
    }
    .f120-end-exam-review-cta__button {
      width: auto;
      border: 1px solid #1d4ed8;
      border-radius: 6px;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 800;
      padding: 7px 10px;
    }
    .f120-end-exam-review-cta__button:hover:not(:disabled) {
      background: #1d4ed8;
    }
    .f120-end-exam-review-cta__button:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.35);
      outline-offset: 2px;
    }
    .f120-end-exam-review-cta__button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .f120-active-exam-pill__privacy {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid rgba(15, 23, 42, 0.1);
    }
    @media (max-width: 520px) {
      #f120-active-exam-pill {
        top: auto;
        right: 10px;
        bottom: 10px;
      }
      .f120-active-exam-pill__panel {
        top: auto;
        bottom: 40px;
      }
    }
  `;
  (adapterDocument.head || adapterDocument.documentElement).appendChild(style);
}

function appendDetailRow(adapterDocument, container, label, value) {
  container.appendChild(createElement(adapterDocument, 'div', {
    className: 'f120-active-exam-pill__detail-label',
    text: label,
  }));
  container.appendChild(createElement(adapterDocument, 'div', {
    className: 'f120-active-exam-pill__detail-value',
    text: value,
  }));
}

function summarizeQBankKeys(attempt) {
  const summary = isObject(attempt && attempt.answerKeyCapture) ? attempt.answerKeyCapture : {};
  return Object.freeze({
    status: normalizeString(summary.status, 'idle'),
    source: normalizeString(summary.source, 'qbank-cache'),
    knownCount: coerceNonNegativeInteger(summary.knownCount, 0),
    expectedCount: coerceNonNegativeInteger(summary.expectedCount, 0),
    unknownCount: coerceNonNegativeInteger(summary.unknownCount, 0),
    retryCount: 0,
    manual: false,
    failureReason: normalizeString(summary.failureReason, ''),
    failureDetail: normalizeString(summary.failureDetail, ''),
    active: false,
  });
}

function summarizeAdapterState(adapterState) {
  if (!adapterState) {
    return 'unavailable';
  }
  const status = normalizeString(adapterState.status, 'unknown');
  const source = normalizeString(adapterState.source, 'unknown');
  const reasons = Array.isArray(adapterState.degradedReasons) && adapterState.degradedReasons.length
    ? ` · ${adapterState.degradedReasons.slice(0, 2).join(', ')}`
    : '';
  return `${status} · ${source}${reasons}`;
}

function summarizeKeys(summary) {
  const suffix = summary.failureDetail ? ` · ${summary.failureDetail}` : '';
  if (!summary.expectedCount && !summary.knownCount && !summary.unknownCount) {
    return `${summary.status}${suffix}`;
  }
  return `${summary.knownCount}/${summary.expectedCount || summary.knownCount + summary.unknownCount} known · ${summary.unknownCount} unknown${suffix}`;
}

function renderSettingsDetails(adapterDocument, detailContainer, snapshot) {
  removeChildren(detailContainer);
  appendDetailRow(adapterDocument, detailContainer, 'Tracking', snapshot.trackingStatus);
  appendDetailRow(adapterDocument, detailContainer, 'QBank keys', `${snapshot.keySummary.status} · ${snapshot.keySummary.source}`);
  appendDetailRow(adapterDocument, detailContainer, 'Keys', summarizeKeys(snapshot.keySummary));
  if (snapshot.keySummary.failureReason) {
    appendDetailRow(adapterDocument, detailContainer, 'Key failure', snapshot.keySummary.failureDetail || snapshot.keySummary.failureReason);
  }
  appendDetailRow(adapterDocument, detailContainer, 'Adapter', summarizeAdapterState(snapshot.adapterState));
  appendDetailRow(adapterDocument, detailContainer, 'Attempt', snapshot.attempt ? truncateMiddle(snapshot.attempt.id || '', 36) : 'not started');
  appendDetailRow(adapterDocument, detailContainer, 'Progress source', snapshot.progress.source || 'unknown');
}

function buildActiveExamPillDom(adapterDocument) {
  const root = createElement(adapterDocument, 'div', {
    id: 'f120-active-exam-pill',
    attributes: { 'data-free120-helper': 'active-exam-pill' },
  });
  const shell = createElement(adapterDocument, 'div', { className: 'f120-active-exam-pill__shell' });
  const pillButton = createElement(adapterDocument, 'button', {
    className: 'f120-active-exam-pill__button',
    type: 'button',
    text: '0/0 · Block 1',
    attributes: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
  });
  const settingsButton = createElement(adapterDocument, 'button', {
    className: 'f120-active-exam-pill__icon-button',
    type: 'button',
    text: '⚙',
    attributes: { 'aria-label': 'Free120 Helper settings', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
  });
  const panel = createElement(adapterDocument, 'section', {
    className: 'f120-active-exam-pill__panel',
    hidden: true,
    attributes: { role: 'dialog', 'aria-label': 'Free120 Helper active exam settings' },
  });

  const title = createElement(adapterDocument, 'h2', {
    className: 'f120-active-exam-pill__title',
    text: 'Free120 Helper',
  });
  const visibleInput = createElement(adapterDocument, 'input', { type: 'checkbox' });
  const visibleLabel = createElement(adapterDocument, 'label', { className: 'f120-active-exam-pill__checkbox' }, [
    visibleInput,
    createElement(adapterDocument, 'span', { text: 'Show progress pill' }),
  ]);
  const debugInput = createElement(adapterDocument, 'input', { type: 'checkbox' });
  const debugLabel = createElement(adapterDocument, 'label', { className: 'f120-active-exam-pill__checkbox' }, [
    debugInput,
    createElement(adapterDocument, 'span', { text: 'Enable debug logging' }),
  ]);
  const detailContainer = createElement(adapterDocument, 'div', { className: 'f120-active-exam-pill__details' });
  const message = createElement(adapterDocument, 'div', {
    className: 'f120-active-exam-pill__message',
    hidden: true,
    attributes: { role: 'status' },
  });
  const privacy = createElement(adapterDocument, 'p', {
    className: 'f120-active-exam-pill__privacy f120-active-exam-pill__muted',
    text: 'Local only. Does not submit answers, navigate WebFRED, or show correct answers during active exam.',
  });

  panel.append(title, visibleLabel, debugLabel, detailContainer, message, privacy);
  shell.append(pillButton, settingsButton);
  root.append(shell, panel);

  return Object.freeze({
    root,
    shell,
    pillButton,
    settingsButton,
    panel,
    visibleInput,
    debugInput,
    detailContainer,
    message,
  });
}

function buildEndExamReviewCtaDom(adapterDocument) {
  const root = createElement(adapterDocument, 'aside', {
    id: END_EXAM_REVIEW_CTA_ID,
    hidden: true,
    attributes: { 'data-free120-helper': 'end-exam-review-cta', role: 'complementary', 'aria-label': 'Free120 Helper review mode' },
  });
  const button = createElement(adapterDocument, 'button', {
    className: 'f120-end-exam-review-cta__button',
    type: 'button',
    text: 'Review mode',
  });

  root.append(button);
  return Object.freeze({ root, button });
}

function isLaunchCloseLink(element, adapterWindow) {
  if (!element || String(element.tagName || '').toLowerCase() !== 'a') {
    return false;
  }
  if (!/^close$/i.test(normalizeString(element.textContent, ''))) {
    return false;
  }
  const rawHref = normalizeString(typeof element.getAttribute === 'function' ? element.getAttribute('href') : element.href, '');
  if (!rawHref) {
    return false;
  }
  try {
    const baseHref = normalizeString(adapterWindow && adapterWindow.location && adapterWindow.location.href, SCRIPT.ORIGIN);
    const url = new URL(rawHref, baseHref);
    return url.origin === SCRIPT.ORIGIN && /^\/launch(?:\/|$)/i.test(url.pathname || '');
  } catch (_error) {
    return /orientation\.nbme\.org\/launch(?:\/|$)/i.test(rawHref);
  }
}

function findEndExamCloseLink(adapterDocument, adapterWindow) {
  if (!adapterDocument || typeof adapterDocument.querySelectorAll !== 'function') {
    return null;
  }
  return Array.from(adapterDocument.querySelectorAll('a[href]')).find((element) => isLaunchCloseLink(element, adapterWindow)) || null;
}


function createActiveExamPill(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const settingsStore = options.settingsStore || options.settings;
  const trackingEngine = options.trackingEngine || null;
  const webfredAdapter = options.webfredAdapter || null;
  const storage = options.storage || null;
  const logger = options.logger || { debug() {}, warn() {}, error() {} };
  const reviewLauncher = typeof options.reviewLauncher === 'function' ? options.reviewLauncher : null;

  if (!settingsStore || typeof settingsStore.get !== 'function') {
    throw new Error('Active exam pill requires settings store.');
  }

  let destroyed = false;
  let panelOpen = false;
  let refreshTimerId = null;
  let unsubscribeTracking = null;
  let unsubscribeAdapter = null;
  let endExamAttempt = null;
  let endExamAttemptLoading = false;
  let lastSnapshot = null;

  injectActiveExamPillStyles(adapterDocument);
  const dom = buildActiveExamPillDom(adapterDocument);
  const endExamCta = buildEndExamReviewCtaDom(adapterDocument);

  function getSettings() {
    try {
      return settingsStore.get();
    } catch (_error) {
      return { pillVisible: false, debug: false };
    }
  }

  function getAttempt() {
    const trackingAttempt = trackingEngine && hasFunction(trackingEngine, 'getAttempt') ? trackingEngine.getAttempt() : null;
    return (isEndExamRoute(adapterWindow.location) ? endExamAttempt : null)
      || trackingAttempt
      || endExamAttempt;
  }

  function getAdapterState() {
    return (trackingEngine && hasFunction(trackingEngine, 'getLastState') && trackingEngine.getLastState())
      || (webfredAdapter && hasFunction(webfredAdapter, 'getLastState') && webfredAdapter.getLastState())
      || null;
  }

  function getTrackingStatus() {
    if (trackingEngine && hasFunction(trackingEngine, 'getStatus')) {
      return normalizeString(trackingEngine.getStatus(), 'idle');
    }
    return 'unavailable';
  }

  async function syncEndExamAttempt(snapshot) {
    if (destroyed || endExamAttemptLoading || !storage) {
      return;
    }
    const endExamReview = snapshot && snapshot.endExamReview ? snapshot.endExamReview : null;
    if (!endExamReview || !endExamReview.visible) {
      return;
    }

    endExamAttemptLoading = true;
    let shouldRefresh = false;
    try {
      let candidate = snapshot.attempt || null;
      if (hasFunction(storage, 'listAttempts')) {
        const storedCandidate = pickLatestEndExamAttempt(await storage.listAttempts());
        if (shouldPreferStoredEndExamAttempt(candidate, storedCandidate)) {
          candidate = storedCandidate;
        }
      }
      if (!candidate) {
        return;
      }
      const beforeKeyStatus = summarizeQBankKeys(candidate);
      if (endExamReview.routeMatched && hasFunction(storage, 'updateAttempt')) {
        candidate = await refreshAttemptQBankKeysForEndExam(storage, candidate, logger);
      }
      const afterKeyStatus = summarizeQBankKeys(candidate);
      if (endExamReview.routeMatched && !isAttemptReviewReady(candidate) && hasAttemptReviewEvidence(candidate) && hasFunction(storage, 'updateAttempt')) {
        endExamAttempt = await storage.updateAttempt(candidate.id, buildEndExamCompletionPatch(candidate, snapshot.adapterState));
        endExamAttempt = await refreshAttemptQBankKeysForEndExam(storage, endExamAttempt, logger);
        shouldRefresh = true;
        dispatchReviewReady(endExamAttempt);
        return;
      }
      shouldRefresh = !endExamAttempt
        || normalizeString(endExamAttempt.id, '') !== normalizeString(candidate.id, '')
        || isAttemptReviewReady(endExamAttempt) !== isAttemptReviewReady(candidate)
        || beforeKeyStatus.status !== afterKeyStatus.status
        || beforeKeyStatus.knownCount !== afterKeyStatus.knownCount
        || beforeKeyStatus.unknownCount !== afterKeyStatus.unknownCount;
      endExamAttempt = candidate;
    } catch (error) {
      logger.warn('End-exam review CTA sync failed.', error);
    } finally {
      endExamAttemptLoading = false;
      if (shouldRefresh && !destroyed) {
        refresh();
      }
    }
  }

  function readSnapshot() {
    const attempt = getAttempt();
    const adapterState = getAdapterState();
    const progress = deriveActiveExamProgress({ attempt, adapterState });
    const settings = getSettings();
    return Object.freeze({
      settings,
      attempt,
      adapterState,
      progress,
      progressText: formatActiveExamProgress(progress),
      trackingStatus: getTrackingStatus(),
      keySummary: summarizeQBankKeys(attempt),
      reviewReady: isAttemptReviewReady(attempt),
      endExamReview: deriveEndExamReviewState({ attempt, adapterState, window: adapterWindow, location: adapterWindow.location }),
    });
  }

  function applyVisibility(settings) {
    const visible = settings.pillVisible === true;
    dom.visibleInput.checked = visible;
    dom.debugInput.checked = settings.debug === true;
    dom.root.classList.toggle('f120-active-exam-pill--hidden', !visible && !panelOpen);
  }

  function placeEndExamReviewCta() {
    const target = adapterDocument.body || adapterDocument.documentElement;
    const closeLink = findEndExamCloseLink(adapterDocument, adapterWindow);
    if (closeLink && closeLink.parentNode) {
      if (endExamCta.root.parentNode !== closeLink.parentNode || endExamCta.root.nextSibling !== closeLink) {
        closeLink.parentNode.insertBefore(endExamCta.root, closeLink);
      }
      return;
    }
    if (target && !endExamCta.root.parentNode) {
      target.appendChild(endExamCta.root);
    }
  }

  function applyEndExamReviewCta(snapshot) {
    const state = snapshot.endExamReview || deriveEndExamReviewState({ attempt: snapshot.attempt, adapterState: snapshot.adapterState, window: adapterWindow, location: adapterWindow.location });
    placeEndExamReviewCta();
    endExamCta.root.hidden = !state.visible;
    endExamCta.button.disabled = !state.enabled;
    endExamCta.button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
  }

  function refresh() {
    if (destroyed) {
      return lastSnapshot;
    }
    const snapshot = readSnapshot();
    lastSnapshot = snapshot;
    dom.pillButton.textContent = snapshot.progressText;
    dom.pillButton.setAttribute('aria-label', `Free120 Helper progress: ${snapshot.progressText}`);
    dom.pillButton.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    dom.settingsButton.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    dom.panel.hidden = !panelOpen;
    applyVisibility(snapshot.settings);
    applyEndExamReviewCta(snapshot);
    renderSettingsDetails(adapterDocument, dom.detailContainer, snapshot);
    if (snapshot.endExamReview && snapshot.endExamReview.visible) {
      void syncEndExamAttempt(snapshot);
    }
    return snapshot;
  }

  function openPanel() {
    if (destroyed) {
      return;
    }
    panelOpen = true;
    refresh();
    dom.panel.hidden = false;
  }

  function closePanel() {
    if (destroyed) {
      return;
    }
    panelOpen = false;
    refresh();
  }

  function togglePanel() {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function dispatchReviewReady(attempt) {
    const attemptId = normalizeString(attempt && attempt.id, '');
    try {
      const detail = Object.freeze({ attemptId, attempt });
      const event = typeof adapterWindow.CustomEvent === 'function'
        ? new adapterWindow.CustomEvent(REVIEW_READY_EVENT, { detail })
        : null;
      if (event) {
        adapterWindow.dispatchEvent(event);
      }
    } catch (error) {
      logger.debug('Review-ready event dispatch failed.', error);
    }
  }

  async function handleReviewReady() {
    let snapshot = refresh();
    if (snapshot.endExamReview && snapshot.endExamReview.visible) {
      await syncEndExamAttempt(snapshot);
      snapshot = refresh();
    }
    if (!snapshot.attempt || !snapshot.endExamReview || !snapshot.endExamReview.enabled) {
      setMessage(dom.message, snapshot.attempt && !hasAttemptReviewEvidence(snapshot.attempt) ? 'No captured helper questions found for this exam attempt.' : 'Review unlocks after the exam ends and local grading finishes.', 'warning');
      return;
    }

    try {
      dispatchReviewReady(snapshot.attempt);
      if (reviewLauncher) {
        await reviewLauncher(snapshot.attempt.id, snapshot.attempt);
        setMessage(dom.message, 'Review opened.', 'info');
      } else {
        setMessage(dom.message, 'Review-ready signal sent. Review tab generation arrives in later phase.', 'info');
      }
    } catch (error) {
      logger.warn('Review ready action failed.', error);
      setMessage(dom.message, `Review action failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
    } finally {
      refresh();
    }
  }

  function handleVisibleSettingChange() {
    try {
      settingsStore.setPillVisible(Boolean(dom.visibleInput.checked));
      if (!dom.visibleInput.checked) {
        setMessage(dom.message, 'Pill hidden after settings closes. Re-enable via Free120Helper.settings.setPillVisible(true).', 'warning');
      } else {
        setMessage(dom.message, 'Pill visible.', 'info');
      }
    } catch (error) {
      logger.warn('Pill visibility setting failed.', error);
      setMessage(dom.message, 'Could not save pill visibility setting.', 'error');
    }
    refresh();
  }

  function handleDebugSettingChange() {
    if (!hasFunction(settingsStore, 'setDebugLogging')) {
      return;
    }
    try {
      settingsStore.setDebugLogging(Boolean(dom.debugInput.checked));
      setMessage(dom.message, dom.debugInput.checked ? 'Debug logging enabled.' : 'Debug logging disabled.', 'info');
    } catch (error) {
      logger.warn('Debug setting failed.', error);
      setMessage(dom.message, 'Could not save debug setting.', 'error');
    }
    refresh();
  }

  function handleDocumentPointerDown(event) {
    if (!panelOpen || !event || !event.target || dom.root.contains(event.target)) {
      return;
    }
    closePanel();
  }

  function handleKeyDown(event) {
    if (event && event.key === 'Escape' && panelOpen) {
      closePanel();
    }
  }

  function handleLocationChange() {
    refresh();
  }

  function attach() {
    const target = adapterDocument.body || adapterDocument.documentElement;
    target.appendChild(dom.root);
    placeEndExamReviewCta();
    dom.pillButton.addEventListener('click', togglePanel);
    dom.settingsButton.addEventListener('click', togglePanel);
    dom.visibleInput.addEventListener('change', handleVisibleSettingChange);
    dom.debugInput.addEventListener('change', handleDebugSettingChange);
    endExamCta.button.addEventListener('click', handleReviewReady);
    adapterDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
    adapterDocument.addEventListener('keydown', handleKeyDown, true);
    if (hasFunction(adapterWindow, 'addEventListener')) {
      adapterWindow.addEventListener('hashchange', handleLocationChange, true);
      adapterWindow.addEventListener('popstate', handleLocationChange, true);
    }

    if (trackingEngine && hasFunction(trackingEngine, 'onStatusChange')) {
      unsubscribeTracking = trackingEngine.onStatusChange(() => refresh());
    }
    if (webfredAdapter && hasFunction(webfredAdapter, 'onStateChange')) {
      unsubscribeAdapter = webfredAdapter.onStateChange(() => refresh());
    }
    refreshTimerId = adapterWindow.setInterval(() => refresh(), 1500);
    refresh();
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    if (refreshTimerId !== null) {
      adapterWindow.clearInterval(refreshTimerId);
      refreshTimerId = null;
    }
    if (typeof unsubscribeTracking === 'function') {
      unsubscribeTracking();
    }
    if (typeof unsubscribeAdapter === 'function') {
      unsubscribeAdapter();
    }
    dom.pillButton.removeEventListener('click', togglePanel);
    dom.settingsButton.removeEventListener('click', togglePanel);
    dom.visibleInput.removeEventListener('change', handleVisibleSettingChange);
    dom.debugInput.removeEventListener('change', handleDebugSettingChange);
    endExamCta.button.removeEventListener('click', handleReviewReady);
    adapterDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    adapterDocument.removeEventListener('keydown', handleKeyDown, true);
    if (hasFunction(adapterWindow, 'removeEventListener')) {
      adapterWindow.removeEventListener('hashchange', handleLocationChange, true);
      adapterWindow.removeEventListener('popstate', handleLocationChange, true);
    }
    if (dom.root.parentNode) {
      dom.root.parentNode.removeChild(dom.root);
    }
    if (endExamCta.root.parentNode) {
      endExamCta.root.parentNode.removeChild(endExamCta.root);
    }
  }

  attach();

  return Object.freeze({
    refresh,
    destroy,
    openSettings: openPanel,
    closeSettings: closePanel,
    getState() {
      return lastSnapshot || refresh();
    },
    constants: Object.freeze({
      reviewReadyEvent: REVIEW_READY_EVENT,
    }),
  });
}

export {
  deriveActiveExamProgress,
  formatActiveExamProgress,
  isEndExamRoute,
  deriveEndExamReviewState,
  buildEndExamCompletionPatch,
  refreshAttemptQBankKeysForEndExam,
  createActiveExamPill,
};

