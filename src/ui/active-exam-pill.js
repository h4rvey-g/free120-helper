import { SCRIPT, ATTEMPT_STATUS } from '../core/constants.js';
import { nowIso } from '../core/logger.js';
import { buildAttemptCompletionPatch, shouldManualFinishCompleteAttempt } from '../scoring/grader.js';

const ACTIVE_EXAM_PILL_STYLE_ID = 'f120-active-exam-pill-style';
const REVIEW_READY_EVENT = 'free120-helper:review-ready';
const MANUAL_FINISH_WARNING = 'Manual finish does not submit, end, or change the native NBME exam. It only marks this local helper attempt review-ready. Grading/review will cover only captured questions, final captured answers, and captured answer keys.';

function isObject(value) {
  return Boolean(value && typeof value === 'object');
}

function normalizeString(value, fallback = '') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function coerceNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function isNonEmptyAnswer(value) {
  return normalizeString(value, '') !== '';
}

function hasFunction(value, name) {
  return Boolean(value && typeof value[name] === 'function');
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

function isAttemptReviewReady(attempt) {
  if (!attempt) {
    return false;
  }
  return Boolean(attempt.reviewReady) || attempt.status === ATTEMPT_STATUS.COMPLETED || attempt.status === ATTEMPT_STATUS.PARTIAL;
}

function buildManualFinishAttemptPatch(attempt, progress, options = {}) {
  const finishedAt = options.finishedAt || nowIso();
  const adapterState = options.adapterState || null;
  const completeEnough = shouldManualFinishCompleteAttempt(attempt, adapterState);
  const completionPatch = buildAttemptCompletionPatch(attempt, {
    adapterState,
    completedAt: finishedAt,
    manual: true,
    partial: !completeEnough,
    reason: normalizeString(options.reason, 'active-exam-ui-manual-finish'),
  });
  const existingSource = isObject(attempt && attempt.source) ? attempt.source : {};
  const completionSource = isObject(completionPatch.source) ? completionPatch.source : {};
  return Object.freeze({
    ...completionPatch,
    source: Object.freeze({
      ...existingSource,
      ...completionSource,
      manualFinish: Object.freeze({
        finishedAt,
        warningAccepted: true,
        reason: normalizeString(options.reason, 'active-exam-ui-manual-finish'),
        answered: coerceNonNegativeInteger(progress && progress.answered, 0),
        total: coerceNonNegativeInteger(progress && progress.total, 0),
        blockNumber: coerceNonNegativeInteger(progress && progress.blockNumber, 1),
        status: completeEnough ? ATTEMPT_STATUS.COMPLETED : ATTEMPT_STATUS.PARTIAL,
        warning: MANUAL_FINISH_WARNING,
      }),
    }),
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
    .f120-active-exam-pill__icon-button,
    .f120-active-exam-pill__action {
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
    .f120-active-exam-pill__icon-button:hover,
    .f120-active-exam-pill__action:hover:not(:disabled) {
      background: #f8fafc;
      border-color: rgba(37, 99, 235, 0.45);
    }
    .f120-active-exam-pill__button:focus-visible,
    .f120-active-exam-pill__icon-button:focus-visible,
    .f120-active-exam-pill__action:focus-visible,
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
    .f120-active-exam-pill__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0;
    }
    .f120-active-exam-pill__action {
      border-radius: 10px;
      padding: 7px 10px;
      font-weight: 700;
      box-shadow: none;
    }
    .f120-active-exam-pill__action:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .f120-active-exam-pill__action--primary {
      background: #2563eb;
      border-color: #1d4ed8;
      color: #fff;
    }
    .f120-active-exam-pill__action--primary:hover:not(:disabled) {
      background: #1d4ed8;
    }
    .f120-active-exam-pill__action--danger {
      background: #fff7ed;
      border-color: #fdba74;
      color: #9a3412;
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

function createElement(adapterDocument, tagName, options = {}, children = []) {
  const element = adapterDocument.createElement(tagName);
  if (options.id) {
    element.id = options.id;
  }
  if (options.className) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = normalizeString(options.text, '');
  }
  if (options.type) {
    element.type = options.type;
  }
  if (options.hidden) {
    element.hidden = true;
  }
  if (isObject(options.attributes)) {
    Object.entries(options.attributes).forEach(([name, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(name, String(value));
      }
    });
  }
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined) {
      return;
    }
    if (typeof child === 'string') {
      element.appendChild(adapterDocument.createTextNode(child));
      return;
    }
    element.appendChild(child);
  });
  return element;
}

function removeChildren(element) {
  while (element && element.firstChild) {
    element.removeChild(element.firstChild);
  }
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

function setMessage(messageElement, message, kind = 'info') {
  const text = normalizeString(message, '');
  messageElement.hidden = !text;
  messageElement.dataset.kind = normalizeString(kind, 'info');
  messageElement.textContent = text;
}

function chooseAnswerKeySummary(result, attempt) {
  const resultSummary = isObject(result && result.summary) ? result.summary : null;
  const attemptSummary = isObject(attempt && attempt.answerKeyCapture) ? attempt.answerKeyCapture : null;
  if (!resultSummary) {
    return attemptSummary || {};
  }
  if (!attemptSummary) {
    return resultSummary;
  }
  const resultExpected = coerceNonNegativeInteger(resultSummary.expectedCount, 0);
  const attemptExpected = coerceNonNegativeInteger(attemptSummary.expectedCount, 0);
  const resultKnown = coerceNonNegativeInteger(resultSummary.knownCount, 0);
  const attemptKnown = coerceNonNegativeInteger(attemptSummary.knownCount, 0);
  if (attemptExpected > resultExpected || attemptKnown > resultKnown) {
    return attemptSummary;
  }
  return resultSummary;
}

function summarizeAnswerKeyCapture(answerKeyCapture, attempt) {
  const result = answerKeyCapture && hasFunction(answerKeyCapture, 'getLastResult') ? answerKeyCapture.getLastResult() : null;
  const resultSummary = isObject(result && result.summary) ? result.summary : null;
  const summary = chooseAnswerKeySummary(result, attempt);
  const status = summary === resultSummary
    ? normalizeString(answerKeyCapture && hasFunction(answerKeyCapture, 'getStatus') ? answerKeyCapture.getStatus() : summary.status, 'idle')
    : normalizeString(summary.status, 'idle');
  return Object.freeze({
    status,
    source: normalizeString(summary.source, 'unavailable'),
    knownCount: coerceNonNegativeInteger(summary.knownCount, 0),
    expectedCount: coerceNonNegativeInteger(summary.expectedCount, 0),
    unknownCount: coerceNonNegativeInteger(summary.unknownCount, 0),
    retryCount: coerceNonNegativeInteger(summary.retryCount, 0),
    manual: Boolean(summary.manual),
    failureReason: normalizeString(summary.failureReason, ''),
    failureDetail: normalizeString(summary.failureDetail, ''),
    active: Boolean(answerKeyCapture && hasFunction(answerKeyCapture, 'isCaptureActive') && answerKeyCapture.isCaptureActive()),
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
  appendDetailRow(adapterDocument, detailContainer, 'Key capture', `${snapshot.keySummary.status} · ${snapshot.keySummary.source}`);
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
  const actions = createElement(adapterDocument, 'div', { className: 'f120-active-exam-pill__actions' });
  const reviewButton = createElement(adapterDocument, 'button', {
    className: 'f120-active-exam-pill__action f120-active-exam-pill__action--primary',
    type: 'button',
    text: 'Review ready',
  });
  const manualFinishButton = createElement(adapterDocument, 'button', {
    className: 'f120-active-exam-pill__action f120-active-exam-pill__action--danger',
    type: 'button',
    text: 'Finish locally…',
  });
  const retryKeyButton = createElement(adapterDocument, 'button', {
    className: 'f120-active-exam-pill__action',
    type: 'button',
    text: 'Retry keys',
  });
  const message = createElement(adapterDocument, 'div', {
    className: 'f120-active-exam-pill__message',
    hidden: true,
    attributes: { role: 'status' },
  });
  const privacy = createElement(adapterDocument, 'p', {
    className: 'f120-active-exam-pill__privacy f120-active-exam-pill__muted',
    text: 'Local only. Does not submit answers, navigate WebFRED, or show correct answers during active exam.',
  });

  actions.append(reviewButton, manualFinishButton, retryKeyButton);
  panel.append(title, visibleLabel, debugLabel, detailContainer, actions, message, privacy);
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
    reviewButton,
    manualFinishButton,
    retryKeyButton,
    message,
  });
}


function createActiveExamPill(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const settingsStore = options.settingsStore || options.settings;
  const trackingEngine = options.trackingEngine || null;
  const answerKeyCapture = options.answerKeyCapture || null;
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
  let manualFinishedAttempt = null;
  let lastSnapshot = null;

  injectActiveExamPillStyles(adapterDocument);
  const dom = buildActiveExamPillDom(adapterDocument);

  function getSettings() {
    try {
      return settingsStore.get();
    } catch (_error) {
      return { pillVisible: true, debug: false };
    }
  }

  function getAttempt() {
    return manualFinishedAttempt
      || (trackingEngine && hasFunction(trackingEngine, 'getAttempt') ? trackingEngine.getAttempt() : null);
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
      keySummary: summarizeAnswerKeyCapture(answerKeyCapture, attempt),
      reviewReady: isAttemptReviewReady(attempt),
    });
  }

  function applyVisibility(settings) {
    const visible = settings.pillVisible !== false;
    dom.visibleInput.checked = visible;
    dom.debugInput.checked = settings.debug === true;
    dom.root.classList.toggle('f120-active-exam-pill--hidden', !visible && !panelOpen);
  }

  function applyReviewState(snapshot) {
    dom.reviewButton.hidden = !snapshot.reviewReady;
    dom.reviewButton.disabled = !snapshot.reviewReady;
    dom.reviewButton.textContent = snapshot.reviewReady ? 'Review ready' : 'Review locked';
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
    applyReviewState(snapshot);
    renderSettingsDetails(adapterDocument, dom.detailContainer, snapshot);
    dom.retryKeyButton.disabled = Boolean(snapshot.keySummary.active);
    dom.manualFinishButton.disabled = !snapshot.attempt || snapshot.reviewReady;
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
    const snapshot = refresh();
    if (!snapshot.attempt || !snapshot.reviewReady) {
      setMessage(dom.message, 'Review locked until attempt is complete or explicitly finished locally.', 'warning');
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

  async function flushTrackingForManualFinish() {
    if (trackingEngine && hasFunction(trackingEngine, 'stop')) {
      await trackingEngine.stop('manual-finish');
      return getAttempt();
    }
    if (trackingEngine && hasFunction(trackingEngine, 'flush')) {
      return trackingEngine.flush('manual-finish');
    }
    return getAttempt();
  }

  async function handleManualFinish() {
    let snapshot = refresh();
    const attempt = snapshot.attempt;
    if (!attempt || !attempt.id) {
      setMessage(dom.message, 'No local in-progress attempt is available yet.', 'warning');
      return;
    }
    if (snapshot.reviewReady) {
      setMessage(dom.message, 'Attempt already review-ready.', 'info');
      return;
    }

    const warning = [
      MANUAL_FINISH_WARNING,
      '',
      `Current helper progress: ${snapshot.progressText}.`,
      '',
      'Continue?',
    ].join('\n');
    const confirmed = typeof adapterWindow.confirm === 'function' ? adapterWindow.confirm(warning) : false;
    if (!confirmed) {
      setMessage(dom.message, 'Manual finish cancelled.', 'info');
      return;
    }

    dom.manualFinishButton.disabled = true;
    setMessage(dom.message, 'Finishing local helper attempt…', 'warning');

    try {
      const flushedAttempt = await flushTrackingForManualFinish();
      snapshot = refresh();
      const latestAttempt = flushedAttempt || snapshot.attempt || attempt;
      const latestAdapterState = getAdapterState();
      const latestProgress = deriveActiveExamProgress({ attempt: latestAttempt, adapterState: latestAdapterState });
      const patch = buildManualFinishAttemptPatch(latestAttempt, latestProgress, { adapterState: latestAdapterState });
      manualFinishedAttempt = storage && hasFunction(storage, 'updateAttempt')
        ? await storage.updateAttempt(latestAttempt.id, patch)
        : Object.freeze({ ...latestAttempt, ...patch });
      dispatchReviewReady(manualFinishedAttempt);
      setMessage(dom.message, `Local attempt finished. ${formatActiveExamProgress(latestProgress)} captured. Review ready.`, 'info');
    } catch (error) {
      logger.warn('Manual finish failed.', error);
      setMessage(dom.message, `Manual finish failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
    } finally {
      refresh();
    }
  }

  async function handleRetryKeys() {
    const snapshot = refresh();
    if (!answerKeyCapture || !hasFunction(answerKeyCapture, 'manualRetry')) {
      setMessage(dom.message, 'Manual key retry unavailable.', 'warning');
      return;
    }
    dom.retryKeyButton.disabled = true;
    setMessage(dom.message, 'Retrying answer-key capture without navigation…', 'info');
    try {
      await answerKeyCapture.manualRetry({
        attemptId: snapshot.attempt && snapshot.attempt.id,
        expectedCount: snapshot.attempt && snapshot.attempt.questionCount,
      });
      if (trackingEngine && hasFunction(trackingEngine, 'flush')) {
        await trackingEngine.flush('settings-key-retry');
      }
      setMessage(dom.message, 'Answer-key retry complete. See key status above.', 'info');
    } catch (error) {
      logger.warn('Manual key retry failed.', error);
      setMessage(dom.message, `Answer-key retry failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
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

  function attach() {
    const target = adapterDocument.body || adapterDocument.documentElement;
    target.appendChild(dom.root);
    dom.pillButton.addEventListener('click', togglePanel);
    dom.settingsButton.addEventListener('click', togglePanel);
    dom.visibleInput.addEventListener('change', handleVisibleSettingChange);
    dom.debugInput.addEventListener('change', handleDebugSettingChange);
    dom.reviewButton.addEventListener('click', handleReviewReady);
    dom.manualFinishButton.addEventListener('click', handleManualFinish);
    dom.retryKeyButton.addEventListener('click', handleRetryKeys);
    adapterDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
    adapterDocument.addEventListener('keydown', handleKeyDown, true);

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
    dom.reviewButton.removeEventListener('click', handleReviewReady);
    dom.manualFinishButton.removeEventListener('click', handleManualFinish);
    dom.retryKeyButton.removeEventListener('click', handleRetryKeys);
    adapterDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    adapterDocument.removeEventListener('keydown', handleKeyDown, true);
    if (dom.root.parentNode) {
      dom.root.parentNode.removeChild(dom.root);
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
      manualFinishWarning: MANUAL_FINISH_WARNING,
    }),
  });
}

export {
  ACTIVE_EXAM_PILL_STYLE_ID,
  REVIEW_READY_EVENT,
  MANUAL_FINISH_WARNING,
  deriveActiveExamProgress,
  formatActiveExamProgress,
  isAttemptReviewReady,
  buildManualFinishAttemptPatch,
  createActiveExamPill,
};

