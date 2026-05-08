import { SCRIPT, DB_SCHEMA, ATTEMPT_STATUS, EXPORT_TYPES, FULL_BACKUP_WARNING } from '../core/constants.js';
import { coerceNonNegativeInteger, coercePositiveInteger, hasFunction, isObject, isPlainObject, normalizeString, uniqueNormalizedStrings as uniqueStrings } from '../core/data.js';
import { createQBankCacheAttemptId, discoverLaunchQuestionDefinitions } from '../qbank/cache-controller.js';
import { canOpenAttemptReview as canOpenReviewFromHistory, isQBankCacheAttempt } from '../review/readiness.js';
import { createElement, removeChildren, setMessage } from './dom.js';

const LAUNCH_HISTORY_STYLE_ID = 'f120-launch-history-style';
const LAUNCH_HISTORY_ROOT_ID = 'f120-launch-history';
const IMPORT_REPLACE_WARNING = 'Replace mode overwrites local attempts when imported attempt ids conflict. This cannot be undone unless you exported a backup first.';

function safeDate(value) {
  const text = normalizeString(value, '');
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(value) {
  const date = safeDate(value);
  if (!date) {
    return '—';
  }
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_error) {
    return date.toISOString();
  }
}

function formatDateForFilename(value) {
  const date = safeDate(value) || new Date();
  return date.toISOString().replace(/[:.]/g, '-');
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.floor(coerceNonNegativeInteger(durationMs, 0) / 1000);
  if (!totalSeconds) {
    return '—';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function dateMs(value) {
  const date = safeDate(value);
  return date ? date.getTime() : 0;
}

function deriveAttemptDurationMs(attempt) {
  if (!isObject(attempt)) {
    return 0;
  }
  const direct = coerceNonNegativeInteger(attempt.durationMs, 0)
    || coerceNonNegativeInteger(attempt.source && attempt.source.durationMs, 0)
    || coerceNonNegativeInteger(attempt.scoreSummary && attempt.scoreSummary.durationMs, 0);
  if (direct > 0) {
    return direct;
  }
  const startedAt = dateMs(attempt.startedAt || attempt.createdAt);
  const completedAt = dateMs(
    attempt.completedAt
    || (attempt.source && attempt.source.completion && attempt.source.completion.completedAt)
    || attempt.updatedAt
  );
  if (!startedAt || !completedAt || completedAt < startedAt) {
    return 0;
  }
  return completedAt - startedAt;
}

function normalizeDisplayText(value) {
  return normalizeString(value, '').replace(/\s+/g, ' ').trim();
}

function extractStepLabel(value) {
  const text = normalizeDisplayText(value);
  const match = text.match(/\bStep\s*(1|2\s*CK|3)\b/i);
  if (match) {
    return `Step ${match[1].replace(/\s+/g, ' ').toUpperCase().replace(/^1$|^3$/, (entry) => entry)}`;
  }
  const codeMatch = text.match(/\bSTPF\s*(1|2|3)\b/i);
  if (!codeMatch) {
    return '';
  }
  return codeMatch[1] === '2' ? 'Step 2 CK' : `Step ${codeMatch[1]}`;
}

function extractBlockNumber(value) {
  const match = normalizeDisplayText(value).match(/\bblock\s*(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}

function formatBlockLabel(value) {
  const text = normalizeDisplayText(value);
  const blockNumber = extractBlockNumber(text) || coercePositiveInteger(text, 0);
  if (blockNumber) {
    return `Block ${blockNumber}`;
  }
  return /^block\b/i.test(text) ? text : '';
}

function isGenericExamPart(value) {
  const text = normalizeDisplayText(value);
  return /^(?:usmle|nbme|nbme exam driver|exam driver)$/i.test(text)
    || /\bnbme\s+exam\s+driver\b/i.test(text);
}

function getAttemptLaunchDefinition(attempt) {
  const source = isObject(attempt && attempt.source) ? attempt.source : {};
  return isPlainObject(source.launchDefinition) ? source.launchDefinition : {};
}

function deriveAttemptStepLabel(attempt) {
  const identity = isPlainObject(attempt && attempt.examIdentity) ? attempt.examIdentity : {};
  const scope = isPlainObject(attempt && attempt.launchedScope) ? attempt.launchedScope : {};
  const launchDefinition = getAttemptLaunchDefinition(attempt);
  return extractStepLabel([
    identity.program,
    scope.program,
    scope.testDefinitionDisplayName,
    scope.displayName,
    identity.section,
    launchDefinition.testDefinitionDisplayName,
    identity.examName,
  ].join(' ')) || (!isGenericExamPart(identity.program) ? normalizeDisplayText(identity.program) : '');
}

function deriveAttemptBlockLabel(attempt, options = {}) {
  const identity = isPlainObject(attempt && attempt.examIdentity) ? attempt.examIdentity : {};
  const scope = isPlainObject(attempt && attempt.launchedScope) ? attempt.launchedScope : {};
  const launchDefinition = getAttemptLaunchDefinition(attempt);
  const metadata = Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : [];
  const displayText = normalizeDisplayText([
    scope.testDefinitionDisplayName,
    scope.displayName,
    launchDefinition.testDefinitionDisplayName,
    identity.section,
    metadata.find((block) => normalizeDisplayText(block && block.label))?.label,
  ].find((value) => normalizeDisplayText(value)) || '');
  if (options.includeStep && extractStepLabel(displayText) && extractBlockNumber(displayText)) {
    return displayText;
  }
  const explicit = formatBlockLabel(scope.block || scope.selectedBlock || scope.launchedBlock);
  if (explicit) {
    return explicit;
  }
  const displayBlock = formatBlockLabel(displayText);
  if (displayBlock) {
    return displayBlock;
  }
  const metadataBlock = metadata.find((block) => coercePositiveInteger(block && (block.blockNumber || block.block || block.index), 0));
  return metadataBlock ? `Block ${coercePositiveInteger(metadataBlock.blockNumber || metadataBlock.block || metadataBlock.index, 1)}` : '';
}

function firstSpecificExamName(attempt) {
  const identity = isPlainObject(attempt && attempt.examIdentity) ? attempt.examIdentity : {};
  const scope = isPlainObject(attempt && attempt.launchedScope) ? attempt.launchedScope : {};
  const launchDefinition = getAttemptLaunchDefinition(attempt);
  return [
    identity.examName,
    identity.formName,
    scope.examName,
    scope.exam,
    launchDefinition.examDisplayName,
    launchDefinition.examName,
  ].map((value) => normalizeDisplayText(value)).find((value) => value && !isGenericExamPart(value) && !extractBlockNumber(value)) || '';
}

function summarizeAttemptExam(attempt) {
  const source = isObject(attempt) ? attempt : {};
  const identity = isPlainObject(source.examIdentity) ? source.examIdentity : {};
  const step = deriveAttemptStepLabel(source);
  const examName = firstSpecificExamName(source);
  const block = deriveAttemptBlockLabel(source);
  const fallbackParts = uniqueStrings([identity.program, identity.examName, identity.section, identity.formName]).filter((part) => {
    const text = normalizeDisplayText(part);
    const stepBlockText = normalizeDisplayText(`${step} ${block}`);
    return text
      && !isGenericExamPart(text)
      && text !== step
      && text !== examName
      && text !== block
      && (!stepBlockText || text !== stepBlockText);
  });
  const parts = uniqueStrings([step, examName, block, ...fallbackParts]);
  return parts.length ? parts.join(' · ') : 'Unknown exam';
}

function summarizeExamIdentity(examIdentity) {
  return summarizeAttemptExam({ examIdentity });
}

function summarizeAttemptScope(attempt) {
  const scope = isPlainObject(attempt && attempt.launchedScope) ? attempt.launchedScope : {};
  const mode = normalizeDisplayText(scope.mode || scope.testMode || scope.scope || scope.launchMode);
  const block = deriveAttemptBlockLabel(attempt, { includeStep: true });
  const test = normalizeDisplayText(scope.test || scope.exam || scope.section);
  const parts = [];
  if (mode) {
    parts.push(mode);
  }
  if (block) {
    parts.push(block);
  }
  if (test && !parts.includes(test) && !isGenericExamPart(test)) {
    parts.push(test);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function summarizeLaunchedScope(scope) {
  return summarizeAttemptScope({ launchedScope: scope });
}

function deriveBlockCount(attempt) {
  if (!isObject(attempt)) {
    return 0;
  }
  const metadataBlocks = uniqueStrings((Array.isArray(attempt.blockMetadata) ? attempt.blockMetadata : [])
    .map((block) => block && (block.blockNumber || block.number || block.index))).length;
  const scoredBlocks = Array.isArray(attempt.scoreSummary && attempt.scoreSummary.perBlock)
    ? attempt.scoreSummary.perBlock.length
    : 0;
  const completionScope = attempt.source && attempt.source.completion && attempt.source.completion.scope;
  const launchedScope = isPlainObject(attempt.launchedScope) ? attempt.launchedScope : {};
  return metadataBlocks
    || scoredBlocks
    || coercePositiveInteger(completionScope && completionScope.blockCount, 0)
    || coercePositiveInteger(launchedScope.blockCount || launchedScope.blocks || launchedScope.totalBlocks, 0)
    || 0;
}

function formatScoreSummary(scoreSummary) {
  if (!isPlainObject(scoreSummary)) {
    return '—';
  }
  const overall = isPlainObject(scoreSummary.overallScore) ? scoreSummary.overallScore : null;
  if (overall && coerceNonNegativeInteger(overall.total, 0) > 0) {
    const percent = Number.isFinite(Number(overall.percent)) ? ` (${overall.percent}%)` : '';
    return `${normalizeString(overall.label, `${overall.correct}/${overall.total}`)}${percent}`;
  }
  const minimum = isPlainObject(scoreSummary.minimumScore) ? scoreSummary.minimumScore : null;
  if (minimum && coerceNonNegativeInteger(minimum.total, 0) > 0) {
    const percent = Number.isFinite(Number(minimum.percent)) ? ` (${minimum.percent}%)` : '';
    return `${normalizeString(minimum.label, `${minimum.correct}/${minimum.total}`)}${percent}`;
  }
  return normalizeString(scoreSummary.summaryText, '—');
}

function formatAttemptStatus(attempt) {
  const status = normalizeString(attempt && attempt.status, 'unknown');
  if (status === ATTEMPT_STATUS.IN_PROGRESS) {
    return 'In progress';
  }
  if (status === ATTEMPT_STATUS.COMPLETED) {
    return 'Completed';
  }
  if (status === ATTEMPT_STATUS.PARTIAL) {
    return 'Partial';
  }
  if (status === ATTEMPT_STATUS.ABANDONED) {
    return 'Abandoned';
  }
  return status || 'Unknown';
}

function getQBankKnownAnswerCount(attempt) {
  if (!isObject(attempt)) {
    return 0;
  }
  const summary = isObject(attempt.answerKeyCapture) ? attempt.answerKeyCapture : {};
  return coerceNonNegativeInteger(summary.knownCount, 0)
    || Object.keys(isObject(attempt.correctAnswers) ? attempt.correctAnswers : {}).length;
}

function isQBankAttemptComplete(attempt) {
  if (!isQBankCacheAttempt(attempt)) {
    return false;
  }
  const questionCount = coerceNonNegativeInteger(attempt.questionCount, Array.isArray(attempt.questionIds) ? attempt.questionIds.length : 0);
  return attempt.status === ATTEMPT_STATUS.COMPLETED
    && Boolean(attempt.reviewReady)
    && questionCount > 0
    && getQBankKnownAnswerCount(attempt) >= questionCount;
}

function summarizeQBankCaptureStorage(attempts, definitions = []) {
  const qbankAttempts = (Array.isArray(attempts) ? attempts : []).filter(isQBankCacheAttempt);
  const definitionIds = (Array.isArray(definitions) ? definitions : []).map(createQBankCacheAttemptId);
  const expectedCount = definitionIds.length || qbankAttempts.length;
  const attemptsById = new Map(qbankAttempts.map((attempt) => [normalizeString(attempt && attempt.id, ''), attempt]));
  const expectedAttempts = definitionIds.length
    ? definitionIds.map((id) => attemptsById.get(id)).filter(Boolean)
    : qbankAttempts;
  const completeAttempts = expectedAttempts.filter(isQBankAttemptComplete);
  const storedQuestions = expectedAttempts.reduce((sum, attempt) => sum + coerceNonNegativeInteger(attempt && attempt.questionCount, Array.isArray(attempt && attempt.questionIds) ? attempt.questionIds.length : 0), 0);
  const knownAnswers = expectedAttempts.reduce((sum, attempt) => sum + getQBankKnownAnswerCount(attempt), 0);
  const failedAttempts = expectedAttempts.filter((attempt) => attempt && !isQBankAttemptComplete(attempt)).length;
  return Object.freeze({
    available: qbankAttempts.length > 0,
    complete: expectedCount > 0 && completeAttempts.length === expectedCount,
    expectedCount,
    storedCount: expectedAttempts.length,
    completeCount: completeAttempts.length,
    failedCount: failedAttempts,
    storedQuestions,
    knownAnswers,
    definitionsKnown: definitionIds.length > 0,
  });
}

function formatQBankStorageStatus(summary) {
  if (!summary || !summary.available) {
    return 'Not captured';
  }
  if (summary.complete) {
    return 'Complete';
  }
  if (summary.completeCount > 0) {
    return 'Partial';
  }
  return 'Incomplete';
}

function formatHistoryAttemptRow(attempt) {
  const source = isObject(attempt) ? attempt : {};
  const startedAt = normalizeString(source.startedAt || source.createdAt, '');
  const blockCount = deriveBlockCount(source);
  return Object.freeze({
    id: normalizeString(source.id, ''),
    startedAt,
    date: formatDateTime(startedAt),
    exam: summarizeAttemptExam(source),
    launchedScope: summarizeAttemptScope(source),
    blockCount: blockCount > 0 ? String(blockCount) : '—',
    duration: formatDurationMs(deriveAttemptDurationMs(source)),
    score: formatScoreSummary(source.scoreSummary),
    status: formatAttemptStatus(source),
    reviewReady: canOpenReviewFromHistory(source),
    questionCount: coerceNonNegativeInteger(source.questionCount, Array.isArray(source.questionIds) ? source.questionIds.length : 0),
  });
}

function cloneJsonCompatible(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function removeQuestionContentFromAttemptForExport(attempt) {
  const sanitized = cloneJsonCompatible(attempt || {});
  delete sanitized.questionSnapshots;
  delete sanitized.snapshots;
  delete sanitized.snapshotsByQuestionId;
  delete sanitized.questionContent;
  delete sanitized.questionHtml;
  delete sanitized.renderedHtml;
  delete sanitized.promptHtml;
  delete sanitized.notesByQuestionId;
  delete sanitized.annotationsByQuestionId;
  return sanitized;
}

function buildHistoryOnlyExportEnvelope(attempts) {
  return Object.freeze({
    exportType: EXPORT_TYPES.HISTORY_ONLY,
    formatVersion: DB_SCHEMA.EXPORT_FORMAT_VERSION,
    schemaVersion: DB_SCHEMA.VERSION,
    script: Object.freeze({
      name: SCRIPT.NAME,
      version: SCRIPT.VERSION,
      storageNamespace: SCRIPT.STORAGE_NAMESPACE,
    }),
    exportedAt: new Date().toISOString(),
    warning: null,
    attempts: (Array.isArray(attempts) ? attempts : []).map(removeQuestionContentFromAttemptForExport),
    questionSnapshots: [],
  });
}

function createHistoryFilename(prefix, attempt = null) {
  const safePrefix = normalizeString(prefix, 'free120-history').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'free120-history';
  const suffix = attempt && attempt.id ? normalizeString(attempt.id, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48) : 'all';
  const date = formatDateForFilename(attempt && (attempt.startedAt || attempt.createdAt));
  return `${safePrefix}-${suffix}-${date}.json`;
}

function downloadTextFile(adapterWindow, adapterDocument, filename, text, type = 'application/json') {
  const BlobCtor = adapterWindow.Blob || (typeof Blob !== 'undefined' ? Blob : null);
  const urlApi = adapterWindow.URL || (typeof URL !== 'undefined' ? URL : null);
  if (!BlobCtor || !urlApi || typeof urlApi.createObjectURL !== 'function') {
    throw new Error('Browser download APIs are unavailable.');
  }
  const blob = new BlobCtor([text], { type });
  const url = urlApi.createObjectURL(blob);
  const anchor = adapterDocument.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  (adapterDocument.body || adapterDocument.documentElement).appendChild(anchor);
  anchor.click();
  if (anchor.parentNode) {
    anchor.parentNode.removeChild(anchor);
  }
  adapterWindow.setTimeout(() => urlApi.revokeObjectURL(url), 1000);
}

function readFileAsText(adapterWindow, file) {
  if (!file) {
    return Promise.reject(new Error('No import file selected.'));
  }
  if (typeof file.text === 'function') {
    return file.text();
  }
  const Reader = adapterWindow.FileReader || (typeof FileReader !== 'undefined' ? FileReader : null);
  if (!Reader) {
    return Promise.reject(new Error('Browser file reader API is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(normalizeString(reader.result, ''));
    reader.onerror = () => reject(reader.error || new Error('Import file read failed.'));
    reader.readAsText(file);
  });
}

function formatImportResult(result) {
  const summary = isPlainObject(result) ? result : {};
  return [
    `${coerceNonNegativeInteger(summary.importedAttempts, 0)} attempts imported`,
    `${coerceNonNegativeInteger(summary.skippedAttempts, 0)} skipped`,
    `${coerceNonNegativeInteger(summary.replacedAttempts, 0)} replaced`,
    `${coerceNonNegativeInteger(summary.importedQuestionSnapshots, 0)} snapshots imported`,
  ].join(' · ');
}

function injectLaunchHistoryStyles(adapterDocument) {
  if (!adapterDocument || adapterDocument.getElementById(LAUNCH_HISTORY_STYLE_ID)) {
    return;
  }

  const style = adapterDocument.createElement('style');
  style.id = LAUNCH_HISTORY_STYLE_ID;
  style.textContent = `
    #${LAUNCH_HISTORY_ROOT_ID} {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: ${SCRIPT.UI_Z_INDEX.MODAL};
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.35;
      color: #111827;
      pointer-events: none;
    }
    #${LAUNCH_HISTORY_ROOT_ID} * {
      box-sizing: border-box;
    }
    .f120-launch-history__button,
    .f120-launch-history__action,
    .f120-launch-history__select,
    .f120-launch-history__file-label {
      font: inherit;
    }
    .f120-launch-history__trigger-group {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      pointer-events: auto;
    }
    .f120-launch-history__button {
      pointer-events: auto;
      border: 1px solid rgba(17, 24, 39, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.97);
      color: #111827;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      cursor: pointer;
      font-weight: 800;
      letter-spacing: 0.01em;
      padding: 8px 12px;
    }
    .f120-launch-history__button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .f120-launch-history__button--danger {
      background: #fff7ed;
      border-color: #fdba74;
      color: #9a3412;
    }
    .f120-launch-history__button:hover,
    .f120-launch-history__action:hover:not(:disabled),
    .f120-launch-history__file-label:hover {
      background: #f8fafc;
      border-color: rgba(37, 99, 235, 0.45);
    }
    .f120-launch-history__button:focus-visible,
    .f120-launch-history__action:focus-visible,
    .f120-launch-history__select:focus-visible,
    .f120-launch-history__file-label:focus-within {
      outline: 3px solid rgba(37, 99, 235, 0.35);
      outline-offset: 2px;
    }
    .f120-launch-history__backdrop {
      position: fixed;
      inset: 0;
      pointer-events: auto;
      background: rgba(15, 23, 42, 0.38);
    }
    .f120-launch-history__backdrop[hidden] {
      display: none !important;
    }
    .f120-launch-history__panel {
      position: fixed;
      top: 64px;
      right: 14px;
      width: min(920px, calc(100vw - 28px));
      max-height: min(720px, calc(100vh - 84px));
      overflow: auto;
      pointer-events: auto;
      background: rgba(255, 255, 255, 0.99);
      color: #111827;
      border: 1px solid rgba(15, 23, 42, 0.15);
      border-radius: 16px;
      box-shadow: 0 22px 60px rgba(15, 23, 42, 0.32);
    }
    .f120-launch-history__panel[hidden] {
      display: none !important;
    }
    .f120-launch-history__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.1);
      position: sticky;
      top: 0;
      background: rgba(255, 255, 255, 0.99);
      z-index: 1;
    }
    .f120-launch-history__title {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 850;
    }
    .f120-launch-history__subtitle {
      margin: 4px 0 0;
      color: #475569;
      font-size: 12px;
    }
    .f120-launch-history__toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.1);
      background: #f8fafc;
    }
    .f120-launch-history__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .f120-launch-history__action,
    .f120-launch-history__file-label {
      border: 1px solid rgba(17, 24, 39, 0.18);
      border-radius: 10px;
      background: #fff;
      color: #111827;
      cursor: pointer;
      font-weight: 750;
      padding: 7px 10px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
    }
    .f120-launch-history__action:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .f120-launch-history__action--primary {
      background: #2563eb;
      border-color: #1d4ed8;
      color: #fff;
    }
    .f120-launch-history__action--primary:hover:not(:disabled) {
      background: #1d4ed8;
    }
    .f120-launch-history__action--danger {
      background: #fff7ed;
      border-color: #fdba74;
      color: #9a3412;
    }
    .f120-launch-history__action--ghost {
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      font-size: 16px;
      padding-inline: 8px;
    }
    .f120-launch-history__select {
      border: 1px solid rgba(17, 24, 39, 0.18);
      border-radius: 10px;
      background: #fff;
      color: #111827;
      min-height: 32px;
      padding: 6px 28px 6px 8px;
    }
    .f120-launch-history__file-input {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      clip-path: inset(50%);
    }
    .f120-launch-history__message {
      margin-left: auto;
      min-width: min(280px, 100%);
      padding: 7px 9px;
      border-radius: 10px;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 12px;
    }
    .f120-launch-history__message[data-kind="warning"] {
      background: #fffbeb;
      color: #92400e;
    }
    .f120-launch-history__message[data-kind="error"] {
      background: #fef2f2;
      color: #991b1b;
    }
    .f120-launch-history__message[data-kind="success"] {
      background: #ecfdf5;
      color: #166534;
    }
    .f120-launch-history__message[hidden] {
      display: none !important;
    }
    .f120-launch-history__body {
      padding: 0;
    }
    .f120-launch-history__empty {
      padding: 24px 16px;
      color: #475569;
      text-align: center;
    }
    .f120-launch-history__table-wrap {
      overflow: auto;
      max-width: 100%;
    }
    .f120-launch-history__table {
      width: 100%;
      min-width: 820px;
      border-collapse: collapse;
      font-size: 12px;
    }
    .f120-launch-history__table th,
    .f120-launch-history__table td {
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
    }
    .f120-launch-history__table th {
      position: sticky;
      top: 61px;
      z-index: 1;
      background: #f8fafc;
      color: #334155;
      font-weight: 850;
      white-space: nowrap;
    }
    .f120-launch-history__row:hover {
      background: #f8fafc;
    }
    .f120-launch-history__cell-main {
      font-weight: 750;
      color: #0f172a;
    }
    .f120-launch-history__cell-sub {
      margin-top: 2px;
      color: #64748b;
      overflow-wrap: anywhere;
    }
    .f120-launch-history__status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-radius: 999px;
      padding: 2px 7px;
      background: #e0f2fe;
      color: #075985;
      font-weight: 800;
      white-space: nowrap;
    }
    .f120-launch-history__status[data-status="in-progress"] {
      background: #fffbeb;
      color: #92400e;
    }
    .f120-launch-history__status[data-status="completed"] {
      background: #ecfdf5;
      color: #166534;
    }
    .f120-launch-history__status[data-status="partial"] {
      background: #fef3c7;
      color: #92400e;
    }
    .f120-launch-history__row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 210px;
    }
    .f120-launch-history__row-actions .f120-launch-history__action {
      padding: 5px 8px;
      min-height: 28px;
      border-radius: 8px;
      font-size: 12px;
    }
    .f120-launch-history__footer {
      padding: 10px 16px 14px;
      border-top: 1px solid rgba(15, 23, 42, 0.1);
      color: #475569;
      font-size: 12px;
      background: #fff;
    }
    .f120-launch-history__panel--qbank {
      width: min(560px, calc(100vw - 28px));
    }
    .f120-launch-history__qbank-body {
      display: grid;
      gap: 12px;
      padding: 16px;
    }
    .f120-launch-history__qbank-copy {
      margin: 0;
      color: #475569;
      line-height: 1.5;
    }
    .f120-launch-history__qbank-storage {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 6px 10px;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 10px;
      background: #f8fafc;
    }
    .f120-launch-history__qbank-storage-label {
      color: #475569;
      font-weight: 750;
      white-space: nowrap;
    }
    .f120-launch-history__qbank-storage-value {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #111827;
    }
    .f120-launch-history__qbank-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .f120-launch-history__qbank-body .f120-launch-history__message {
      margin-left: 0;
      width: 100%;
    }
    @media (max-width: 680px) {
      #${LAUNCH_HISTORY_ROOT_ID} {
        top: 10px;
        right: 10px;
      }
      .f120-launch-history__panel {
        top: 54px;
        right: 8px;
        width: calc(100vw - 16px);
        max-height: calc(100vh - 64px);
      }
      .f120-launch-history__header,
      .f120-launch-history__toolbar {
        padding-inline: 12px;
      }
      .f120-launch-history__message {
        margin-left: 0;
        width: 100%;
      }
    }
  `;
  (adapterDocument.head || adapterDocument.documentElement).appendChild(style);
}

function clearNamespacedStorageArea(storageArea) {
  if (!storageArea || typeof storageArea.length !== 'number') {
    return 0;
  }
  const keys = [];
  for (let index = 0; index < storageArea.length; index += 1) {
    const key = normalizeString(typeof storageArea.key === 'function' ? storageArea.key(index) : '', '');
    if (key && key.startsWith(SCRIPT.STORAGE_NAMESPACE)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storageArea.removeItem(key));
  return keys.length;
}

function clearHelperWebStorage(adapterWindow) {
  return clearNamespacedStorageArea(adapterWindow && adapterWindow.localStorage)
    + clearNamespacedStorageArea(adapterWindow && adapterWindow.sessionStorage);
}

function appendDetailRow(adapterDocument, container, label, value) {
  container.appendChild(createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__qbank-storage-label',
    text: label,
  }));
  container.appendChild(createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__qbank-storage-value',
    text: value,
  }));
}

function appendCellText(adapterDocument, row, text, className = '') {
  const cell = createElement(adapterDocument, 'td', className ? { className } : {});
  cell.textContent = normalizeString(text, '—');
  row.appendChild(cell);
  return cell;
}

function appendMainSubCell(adapterDocument, row, main, sub = '') {
  const cell = createElement(adapterDocument, 'td');
  cell.appendChild(createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__cell-main',
    text: main,
  }));
  const subText = normalizeString(sub, '');
  if (subText) {
    cell.appendChild(createElement(adapterDocument, 'div', {
      className: 'f120-launch-history__cell-sub',
      text: subText,
    }));
  }
  row.appendChild(cell);
  return cell;
}

function createActionButton(adapterDocument, text, action, className = '') {
  return createElement(adapterDocument, 'button', {
    className: `f120-launch-history__action${className ? ` ${className}` : ''}`,
    type: 'button',
    text,
    dataset: { action },
  });
}

function buildLaunchHistoryDom(adapterDocument) {
  const root = createElement(adapterDocument, 'div', {
    id: LAUNCH_HISTORY_ROOT_ID,
    attributes: { 'data-free120-helper': 'launch-history' },
  });
  const triggerGroup = createElement(adapterDocument, 'div', { className: 'f120-launch-history__trigger-group' });
  const triggerButton = createElement(adapterDocument, 'button', {
    className: 'f120-launch-history__button',
    type: 'button',
    text: 'Free120 History',
    attributes: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
  });
  const qbankCaptureButton = createElement(adapterDocument, 'button', {
    className: 'f120-launch-history__button',
    type: 'button',
    text: 'Capture QBank',
    attributes: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
  });
  const cleanCacheButton = createElement(adapterDocument, 'button', {
    className: 'f120-launch-history__button f120-launch-history__button--danger',
    type: 'button',
    text: 'Clean Cache',
    attributes: { 'aria-label': 'Clean Free120 Helper cache', title: 'Delete all local Free120 Helper history, snapshots, and QBank cache.' },
  });
  triggerGroup.append(triggerButton, qbankCaptureButton, cleanCacheButton);
  const backdrop = createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__backdrop',
    hidden: true,
  });
  const panel = createElement(adapterDocument, 'section', {
    className: 'f120-launch-history__panel',
    hidden: true,
    attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Free120 History' },
  });

  const header = createElement(adapterDocument, 'div', { className: 'f120-launch-history__header' });
  const titleWrap = createElement(adapterDocument, 'div');
  const title = createElement(adapterDocument, 'h2', {
    className: 'f120-launch-history__title',
    text: 'Free120 History',
  });
  const subtitle = createElement(adapterDocument, 'p', {
    className: 'f120-launch-history__subtitle',
    text: 'Local browser attempts. Default export excludes stored question content.',
  });
  titleWrap.append(title, subtitle);
  const closeButton = createActionButton(adapterDocument, '×', 'close', 'f120-launch-history__action--ghost');
  closeButton.setAttribute('aria-label', 'Close Free120 History');
  header.append(titleWrap, closeButton);

  const toolbar = createElement(adapterDocument, 'div', { className: 'f120-launch-history__toolbar' });
  const importModeSelect = createElement(adapterDocument, 'select', {
    className: 'f120-launch-history__select',
    attributes: { 'aria-label': 'Import conflict handling' },
  });
  [
    ['skip', 'Import: skip conflicts'],
    ['keep-both', 'Import: keep both'],
    ['replace', 'Import: replace conflicts'],
  ].forEach(([value, label]) => {
    importModeSelect.appendChild(createElement(adapterDocument, 'option', { value, text: label }));
  });
  importModeSelect.value = 'skip';

  const importInput = createElement(adapterDocument, 'input', {
    className: 'f120-launch-history__file-input',
    type: 'file',
    attributes: { accept: 'application/json,.json' },
  });
  const importLabel = createElement(adapterDocument, 'label', { className: 'f120-launch-history__file-label' }, [
    importInput,
    createElement(adapterDocument, 'span', { text: 'Import JSON' }),
  ]);

  const refreshButton = createActionButton(adapterDocument, 'Refresh', 'refresh');
  const exportHistoryButton = createActionButton(adapterDocument, 'Export history', 'export-history');
  const exportFullButton = createActionButton(adapterDocument, 'Full backup…', 'export-full', 'f120-launch-history__action--danger');
  const actions = createElement(adapterDocument, 'div', { className: 'f120-launch-history__actions' }, [
    refreshButton,
    exportHistoryButton,
    exportFullButton,
    importModeSelect,
    importLabel,
  ]);
  const message = createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__message',
    hidden: true,
    attributes: { role: 'status' },
  });
  toolbar.append(actions, message);

  const body = createElement(adapterDocument, 'div', { className: 'f120-launch-history__body' });
  const tableWrap = createElement(adapterDocument, 'div', { className: 'f120-launch-history__table-wrap' });
  const table = createElement(adapterDocument, 'table', { className: 'f120-launch-history__table' });
  const thead = createElement(adapterDocument, 'thead');
  const headRow = createElement(adapterDocument, 'tr');
  ['Date', 'Exam', 'Scope', 'Blocks', 'Duration', 'Score', 'Status', 'Actions'].forEach((label) => {
    headRow.appendChild(createElement(adapterDocument, 'th', { text: label }));
  });
  thead.appendChild(headRow);
  const tbody = createElement(adapterDocument, 'tbody');
  table.append(thead, tbody);
  tableWrap.appendChild(table);
  const empty = createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__empty',
    hidden: true,
    text: 'No Free120 Helper attempts stored yet.',
  });
  body.append(tableWrap, empty);

  const footer = createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__footer',
    text: 'Review/export/import open only from local IndexedDB data. Full backup includes stored question snapshots and may contain NBME content.',
  });

  const qbankPanel = createElement(adapterDocument, 'section', {
    className: 'f120-launch-history__panel f120-launch-history__panel--qbank',
    hidden: true,
    attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Capture QBank' },
  });
  const qbankHeader = createElement(adapterDocument, 'div', { className: 'f120-launch-history__header' });
  const qbankTitleWrap = createElement(adapterDocument, 'div');
  const qbankTitle = createElement(adapterDocument, 'h2', {
    className: 'f120-launch-history__title',
    text: 'Capture QBank',
  });
  const qbankSubtitle = createElement(adapterDocument, 'p', {
    className: 'f120-launch-history__subtitle',
    text: 'Capture all available NBME/Free120 MCQ blocks into local IndexedDB.',
  });
  qbankTitleWrap.append(qbankTitle, qbankSubtitle);
  const qbankCloseButton = createActionButton(adapterDocument, '×', 'close-qbank', 'f120-launch-history__action--ghost');
  qbankCloseButton.setAttribute('aria-label', 'Close Capture QBank');
  qbankHeader.append(qbankTitleWrap, qbankCloseButton);

  const qbankBody = createElement(adapterDocument, 'div', { className: 'f120-launch-history__qbank-body' });
  qbankBody.appendChild(createElement(adapterDocument, 'p', {
    className: 'f120-launch-history__qbank-copy',
    text: 'This creates local review-ready cache attempts with rendered question snapshots and answer keys. Keep stored question content private. Do not export or share full backups.',
  }));
  const qbankStorage = createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__qbank-storage',
    attributes: { role: 'status', 'aria-live': 'polite' },
  });
  const qbankActions = createElement(adapterDocument, 'div', { className: 'f120-launch-history__qbank-actions' });
  const qbankStartButton = createActionButton(adapterDocument, 'Start QBank capture', 'start-qbank-capture', 'f120-launch-history__action--primary');
  qbankActions.append(qbankStartButton);
  const qbankMessage = createElement(adapterDocument, 'div', {
    className: 'f120-launch-history__message',
    hidden: true,
    attributes: { role: 'status' },
  });
  qbankBody.append(qbankStorage, qbankActions, qbankMessage);
  qbankPanel.append(qbankHeader, qbankBody);

  panel.append(header, toolbar, body, footer);
  root.append(triggerGroup, backdrop, panel, qbankPanel);

  return Object.freeze({
    root,
    triggerButton,
    qbankCaptureButton,
    cleanCacheButton,
    backdrop,
    panel,
    qbankPanel,
    closeButton,
    qbankCloseButton,
    qbankStartButton,
    qbankStorage,
    refreshButton,
    exportHistoryButton,
    exportFullButton,
    importModeSelect,
    importInput,
    message,
    qbankMessage,
    tableWrap,
    tbody,
    empty,
  });
}

function createLaunchHistory(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const storage = options.storage || null;
  const logger = options.logger || { debug() {}, warn() {}, error() {} };
  const reviewLauncher = typeof options.reviewLauncher === 'function' ? options.reviewLauncher : null;
  const qbankCache = options.qbankCache || null;

  if (!storage || typeof storage.listAttempts !== 'function') {
    throw new Error('Launch history requires storage with listAttempts().');
  }
  if (!hasFunction(storage, 'clearAllHistory') && !hasFunction(storage, 'deleteAttempt')) {
    throw new Error('Launch history requires storage cleanup support.');
  }

  let destroyed = false;
  let panelOpen = false;
  let qbankPanelOpen = false;
  let attempts = [];
  let qbankStorageSummary = summarizeQBankCaptureStorage([]);
  let refreshRequestId = 0;
  let qbankCaptureInProgress = false;

  injectLaunchHistoryStyles(adapterDocument);
  const dom = buildLaunchHistoryDom(adapterDocument);

  function setBusy(busy) {
    const disabled = Boolean(busy) || qbankCaptureInProgress;
    [
      dom.refreshButton,
      dom.exportHistoryButton,
      dom.exportFullButton,
      dom.importModeSelect,
      dom.importInput,
      dom.qbankCaptureButton,
      dom.qbankStartButton,
      dom.cleanCacheButton,
    ].forEach((element) => {
      if (element) {
        element.disabled = disabled;
      }
    });
  }

  function getAttemptById(attemptId) {
    const id = normalizeString(attemptId, '');
    return attempts.find((attempt) => attempt && attempt.id === id) || null;
  }

  function renderQBankStorageSummary(summary = qbankStorageSummary) {
    removeChildren(dom.qbankStorage);
    appendDetailRow(adapterDocument, dom.qbankStorage, 'Status', formatQBankStorageStatus(summary));
    appendDetailRow(adapterDocument, dom.qbankStorage, 'Blocks', summary.expectedCount > 0 ? `${summary.completeCount}/${summary.expectedCount} complete` : `${summary.storedCount} stored`);
    appendDetailRow(adapterDocument, dom.qbankStorage, 'Questions', String(summary.storedQuestions));
    appendDetailRow(adapterDocument, dom.qbankStorage, 'Answer keys', String(summary.knownAnswers));
  }

  function readLaunchQBankDefinitions() {
    try {
      return discoverLaunchQuestionDefinitions(adapterWindow, adapterDocument).definitions;
    } catch (_error) {
      return [];
    }
  }

  async function refreshQBankStorageSummary(sourceAttempts = attempts) {
    const listed = Array.isArray(sourceAttempts) && sourceAttempts.length
      ? sourceAttempts
      : await storage.listAttempts({ includeInProgress: true });
    qbankStorageSummary = summarizeQBankCaptureStorage(listed, readLaunchQBankDefinitions());
    renderQBankStorageSummary(qbankStorageSummary);
    return qbankStorageSummary;
  }

  function updateOpenState() {
    const anyOpen = panelOpen || qbankPanelOpen;
    dom.panel.hidden = !panelOpen;
    dom.qbankPanel.hidden = !qbankPanelOpen;
    dom.backdrop.hidden = !anyOpen;
    dom.triggerButton.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    dom.qbankCaptureButton.setAttribute('aria-expanded', qbankPanelOpen ? 'true' : 'false');
  }

  function setOpen(open) {
    if (destroyed) {
      return;
    }
    panelOpen = Boolean(open);
    if (panelOpen) {
      qbankPanelOpen = false;
    }
    updateOpenState();
    if (panelOpen) {
      void refreshAttempts();
    }
  }

  function setQBankOpen(open) {
    if (destroyed) {
      return;
    }
    qbankPanelOpen = Boolean(open);
    if (qbankPanelOpen) {
      panelOpen = false;
    }
    updateOpenState();
    if (qbankPanelOpen) {
      void refreshQBankStorageSummary().catch((error) => {
        logger.warn('QBank storage summary refresh failed.', error);
        setMessage(dom.qbankMessage, `QBank storage refresh failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      });
    }
  }

  function openPanel() {
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
  }

  function openQBankPanel() {
    setQBankOpen(true);
  }

  function closeQBankPanel() {
    setQBankOpen(false);
  }

  function closeAllPanels() {
    if (destroyed) {
      return;
    }
    panelOpen = false;
    qbankPanelOpen = false;
    updateOpenState();
  }

  function togglePanel() {
    setOpen(!panelOpen);
  }

  function toggleQBankPanel() {
    setQBankOpen(!qbankPanelOpen);
  }

  function renderAttempts() {
    removeChildren(dom.tbody);
    const hasAttempts = attempts.length > 0;
    dom.empty.hidden = hasAttempts;
    dom.tableWrap.hidden = !hasAttempts;

    attempts.forEach((attempt) => {
      const rowModel = formatHistoryAttemptRow(attempt);
      const row = createElement(adapterDocument, 'tr', {
        className: 'f120-launch-history__row',
        dataset: { attemptId: rowModel.id },
      });
      appendMainSubCell(adapterDocument, row, rowModel.date, rowModel.id);
      appendMainSubCell(adapterDocument, row, rowModel.exam, `${rowModel.questionCount} questions`);
      appendCellText(adapterDocument, row, rowModel.launchedScope);
      appendCellText(adapterDocument, row, rowModel.blockCount);
      appendCellText(adapterDocument, row, rowModel.duration);
      appendCellText(adapterDocument, row, rowModel.score);

      const statusCell = createElement(adapterDocument, 'td');
      statusCell.appendChild(createElement(adapterDocument, 'span', {
        className: 'f120-launch-history__status',
        text: rowModel.status,
        dataset: { status: normalizeString(attempt.status, 'unknown') },
      }));
      statusCell.appendChild(createElement(adapterDocument, 'div', {
        className: 'f120-launch-history__cell-sub',
        text: rowModel.reviewReady ? 'Review ready' : 'Review locked',
      }));
      row.appendChild(statusCell);

      const actionsCell = createElement(adapterDocument, 'td');
      const actions = createElement(adapterDocument, 'div', { className: 'f120-launch-history__row-actions' });
      const reviewButton = createActionButton(adapterDocument, 'Review', 'review', 'f120-launch-history__action--primary');
      reviewButton.disabled = !rowModel.reviewReady;
      reviewButton.title = rowModel.reviewReady ? 'Open local review tab.' : 'Attempt not complete or locally finished yet.';
      const exportButton = createActionButton(adapterDocument, 'Export', 'export-attempt');
      const deleteButton = createActionButton(adapterDocument, 'Delete', 'delete', 'f120-launch-history__action--danger');
      actions.append(reviewButton, exportButton, deleteButton);
      actionsCell.appendChild(actions);
      row.appendChild(actionsCell);

      dom.tbody.appendChild(row);
    });
  }

  async function refreshAttempts() {
    if (destroyed) {
      return attempts;
    }
    const requestId = refreshRequestId + 1;
    refreshRequestId = requestId;
    setBusy(true);
    try {
      const listed = await storage.listAttempts({ includeInProgress: true });
      if (requestId !== refreshRequestId) {
        return attempts;
      }
      attempts = Array.isArray(listed) ? listed : [];
      renderAttempts();
      qbankStorageSummary = summarizeQBankCaptureStorage(attempts, readLaunchQBankDefinitions());
      renderQBankStorageSummary(qbankStorageSummary);
      setMessage(dom.message, attempts.length ? `${attempts.length} attempts loaded.` : 'No attempts stored yet.', attempts.length ? 'info' : 'warning');
      return attempts;
    } catch (error) {
      logger.warn('Launch history refresh failed.', error);
      setMessage(dom.message, `History refresh failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return attempts;
    } finally {
      setBusy(false);
    }
  }

  async function openAttemptReview(attemptId) {
    const attempt = getAttemptById(attemptId) || (hasFunction(storage, 'getAttempt') ? await storage.getAttempt(attemptId) : null);
    if (!attempt || !canOpenReviewFromHistory(attempt)) {
      setMessage(dom.message, 'Review locked until attempt is complete or explicitly finished locally.', 'warning');
      return null;
    }
    if (!reviewLauncher) {
      setMessage(dom.message, 'Review launcher unavailable on this page.', 'error');
      return null;
    }
    try {
      const result = await reviewLauncher(attempt.id, attempt);
      setMessage(dom.message, 'Review opened.', 'success');
      return result;
    } catch (error) {
      logger.warn('Launch history review failed.', error);
      setMessage(dom.message, `Review open failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return null;
    }
  }

  async function deleteAttempt(attemptId) {
    const attempt = getAttemptById(attemptId) || (hasFunction(storage, 'getAttempt') ? await storage.getAttempt(attemptId) : null);
    if (!attempt || !attempt.id) {
      setMessage(dom.message, 'Attempt not found.', 'warning');
      await refreshAttempts();
      return false;
    }
    const rowModel = formatHistoryAttemptRow(attempt);
    const warning = [
      `Delete this local Free120 Helper attempt?`,
      '',
      rowModel.exam,
      rowModel.date,
      '',
      'This deletes the attempt, in-progress state, and stored question snapshots from this browser.',
    ].join('\n');
    const confirmed = typeof adapterWindow.confirm === 'function' ? adapterWindow.confirm(warning) : false;
    if (!confirmed) {
      setMessage(dom.message, 'Delete cancelled.', 'info');
      return false;
    }
    try {
      await storage.deleteAttempt(attempt.id);
      setMessage(dom.message, 'Attempt deleted.', 'success');
      await refreshAttempts();
      return true;
    } catch (error) {
      logger.warn('Launch history delete failed.', error);
      setMessage(dom.message, `Delete failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return false;
    }
  }

  async function clearStoredAttemptsAndSnapshots() {
    if (hasFunction(storage, 'clearAllHistory')) {
      await storage.clearAllHistory();
      return;
    }
    if (!hasFunction(storage, 'deleteAttempt')) {
      throw new Error('Cache cleanup unavailable.');
    }
    const listed = await storage.listAttempts({ includeInProgress: true });
    for (const attempt of Array.isArray(listed) ? listed : []) {
      const id = normalizeString(attempt && attempt.id, '');
      if (id) {
        await storage.deleteAttempt(id);
      }
    }
  }

  async function cleanCache() {
    if (qbankCaptureInProgress) {
      setQBankOpen(true);
      setMessage(dom.qbankMessage, 'Wait for QBank capture to finish before cleaning cache.', 'warning');
      return false;
    }
    const warning = [
      'Clean all local Free120 Helper history and cache from this browser?',
      '',
      'This deletes all attempts, in-progress state, stored question snapshots, and QBank capture cache.',
      'This cannot be undone unless you exported a backup first.',
      '',
      'Continue?',
    ].join('\n');
    const confirmed = typeof adapterWindow.confirm === 'function' ? adapterWindow.confirm(warning) : false;
    if (!confirmed) {
      setMessage(dom.message, 'Clean cache cancelled.', 'info');
      return false;
    }
    setBusy(true);
    try {
      await clearStoredAttemptsAndSnapshots();
      clearHelperWebStorage(adapterWindow);
      if (qbankCache && typeof qbankCache.reset === 'function') {
        qbankCache.reset();
      }
      attempts = [];
      qbankStorageSummary = summarizeQBankCaptureStorage([], readLaunchQBankDefinitions());
      renderAttempts();
      renderQBankStorageSummary(qbankStorageSummary);
      dom.importInput.value = '';
      panelOpen = true;
      qbankPanelOpen = false;
      updateOpenState();
      setMessage(dom.message, 'Cache cleaned: history, in-progress state, question snapshots, and QBank capture deleted.', 'success');
      setMessage(dom.qbankMessage, 'QBank capture cache deleted.', 'success');
      return true;
    } catch (error) {
      logger.warn('Launch history cache cleanup failed.', error);
      panelOpen = true;
      qbankPanelOpen = false;
      updateOpenState();
      setMessage(dom.message, `Clean cache failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function exportHistoryOnly(attempt = null) {
    try {
      const envelope = attempt
        ? buildHistoryOnlyExportEnvelope([attempt])
        : (hasFunction(storage, 'exportHistoryOnly') ? await storage.exportHistoryOnly() : buildHistoryOnlyExportEnvelope(attempts));
      downloadTextFile(
        adapterWindow,
        adapterDocument,
        createHistoryFilename(attempt ? 'free120-attempt-history' : 'free120-history', attempt),
        JSON.stringify(envelope, null, 2)
      );
      setMessage(dom.message, attempt ? 'Attempt history exported without question content.' : 'History exported without question content.', 'success');
      return envelope;
    } catch (error) {
      logger.warn('Launch history export failed.', error);
      setMessage(dom.message, `Export failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return null;
    }
  }

  async function exportFullBackup() {
    const warning = [
      FULL_BACKUP_WARNING,
      '',
      'Full backup may contain official NBME question content stored locally from your exam session.',
      'Keep it private. Do not share it.',
      '',
      'Continue?',
    ].join('\n');
    const confirmed = typeof adapterWindow.confirm === 'function' ? adapterWindow.confirm(warning) : false;
    if (!confirmed) {
      setMessage(dom.message, 'Full backup export cancelled.', 'info');
      return null;
    }
    if (!hasFunction(storage, 'exportFullBackup')) {
      setMessage(dom.message, 'Full backup export unavailable.', 'error');
      return null;
    }
    try {
      const envelope = await storage.exportFullBackup({ acknowledgeWarning: true });
      downloadTextFile(
        adapterWindow,
        adapterDocument,
        createHistoryFilename('free120-full-backup'),
        JSON.stringify(envelope, null, 2)
      );
      setMessage(dom.message, 'Full backup exported with stored question snapshots.', 'success');
      return envelope;
    } catch (error) {
      logger.warn('Launch history full backup export failed.', error);
      setMessage(dom.message, `Full backup failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return null;
    }
  }

  async function captureQBank() {
    setQBankOpen(true);
    if (!qbankCache || typeof qbankCache.captureAllAvailable !== 'function') {
      setMessage(dom.qbankMessage, 'QBank capture unavailable on this page.', 'error');
      return null;
    }
    const summary = await refreshQBankStorageSummary();
    const warning = summary.complete
      ? [
        'QBank capture already appears complete in local storage.',
        '',
        `${summary.completeCount}/${summary.expectedCount} blocks complete, ${summary.storedQuestions} questions, ${summary.knownAnswers} answer keys.`,
        'Capturing again is unnecessary and will replace existing QBank cache attempts.',
        '',
        'Continue anyway?',
      ].join('\n')
      : [
        'Capture all available NBME/Free120 MCQ blocks into local IndexedDB?',
        '',
        'This creates local review-ready cache attempts with rendered question snapshots and answer keys.',
        'Keep stored question content private. Do not export or share full backups.',
        '',
        'Continue?',
      ].join('\n');
    const confirmed = typeof adapterWindow.confirm === 'function' ? adapterWindow.confirm(warning) : false;
    if (!confirmed) {
      setMessage(dom.qbankMessage, 'QBank capture cancelled.', 'info');
      return null;
    }
    qbankCaptureInProgress = true;
    setBusy(true);
    try {
      const result = await qbankCache.captureAllAvailable({
        onProgress(progress) {
          const current = coerceNonNegativeInteger(progress && progress.current, 0);
          const total = coerceNonNegativeInteger(progress && progress.total, 0);
          const label = normalizeString(progress && progress.definition && progress.definition.testDefinitionDisplayName, 'block');
          setMessage(dom.qbankMessage, `Capturing QBank ${current}/${total}: ${label}…`, 'info');
        },
      });
      const captured = coerceNonNegativeInteger(result && result.capturedDefinitions, 0);
      const failed = coerceNonNegativeInteger(result && result.failedDefinitions, 0);
      const questions = coerceNonNegativeInteger(result && result.questionCount, 0);
      const knownAnswers = coerceNonNegativeInteger(result && result.knownAnswerCount, 0);
      const kind = failed ? (captured ? 'warning' : 'error') : 'success';
      setMessage(dom.qbankMessage, `QBank capture ${failed ? 'partial' : 'complete'}: ${captured} blocks, ${questions} questions, ${knownAnswers} answer keys${failed ? `, ${failed} failed` : ''}.`, kind);
      await refreshAttempts();
      await refreshQBankStorageSummary();
      return result;
    } catch (error) {
      logger.warn('QBank capture failed.', error);
      setMessage(dom.qbankMessage, `QBank capture failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return null;
    } finally {
      qbankCaptureInProgress = false;
      setBusy(false);
    }
  }

  async function importHistoryFile(file) {
    if (!hasFunction(storage, 'importJson')) {
      setMessage(dom.message, 'Import unavailable.', 'error');
      return null;
    }
    const conflictMode = normalizeString(dom.importModeSelect.value, 'skip');
    if (conflictMode === 'replace') {
      const confirmed = typeof adapterWindow.confirm === 'function' ? adapterWindow.confirm(IMPORT_REPLACE_WARNING) : false;
      if (!confirmed) {
        setMessage(dom.message, 'Import cancelled.', 'info');
        return null;
      }
    }
    setBusy(true);
    try {
      const text = await readFileAsText(adapterWindow, file);
      const result = await storage.importJson(text, { conflictMode });
      setMessage(dom.message, `Import complete: ${formatImportResult(result)}.`, 'success');
      await refreshAttempts();
      return result;
    } catch (error) {
      logger.warn('Launch history import failed.', error);
      setMessage(dom.message, `Import failed: ${normalizeString(error && error.message, 'unknown error')}`, 'error');
      return null;
    } finally {
      setBusy(false);
      dom.importInput.value = '';
    }
  }

  function findActionTarget(event) {
    if (!event || !event.target || typeof event.target.closest !== 'function') {
      return null;
    }
    return event.target.closest('[data-action]');
  }

  function findAttemptIdForAction(actionElement) {
    const row = actionElement && typeof actionElement.closest === 'function'
      ? actionElement.closest('[data-attempt-id]')
      : null;
    return normalizeString(row && row.dataset && row.dataset.attemptId, '');
  }

  function handlePanelClick(event) {
    const actionElement = findActionTarget(event);
    if (!actionElement) {
      return;
    }
    const action = normalizeString(actionElement.dataset.action, '');
    const attemptId = findAttemptIdForAction(actionElement);
    if (action === 'close') {
      closePanel();
      return;
    }
    if (action === 'refresh') {
      void refreshAttempts();
      return;
    }
    if (action === 'export-history') {
      void exportHistoryOnly();
      return;
    }
    if (action === 'export-full') {
      void exportFullBackup();
      return;
    }
    if (action === 'capture-qbank') {
      void captureQBank();
      return;
    }
    if (action === 'review') {
      void openAttemptReview(attemptId);
      return;
    }
    if (action === 'export-attempt') {
      const attempt = getAttemptById(attemptId);
      if (!attempt) {
        setMessage(dom.message, 'Attempt not found for export.', 'warning');
        return;
      }
      void exportHistoryOnly(attempt);
      return;
    }
    if (action === 'delete') {
      void deleteAttempt(attemptId);
    }
  }

  function handleQBankPanelClick(event) {
    const actionElement = findActionTarget(event);
    if (!actionElement) {
      return;
    }
    const action = normalizeString(actionElement.dataset.action, '');
    if (action === 'close-qbank') {
      closeQBankPanel();
      return;
    }
    if (action === 'start-qbank-capture') {
      void captureQBank();
    }
  }

  function handleImportChange(event) {
    const file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (file) {
      void importHistoryFile(file);
    }
  }

  function handleBackdropClick() {
    closeAllPanels();
  }

  function handleKeyDown(event) {
    if (event && event.key === 'Escape' && (panelOpen || qbankPanelOpen)) {
      closeAllPanels();
    }
  }

  function attach() {
    const target = adapterDocument.body || adapterDocument.documentElement;
    target.appendChild(dom.root);
    renderQBankStorageSummary();
    dom.triggerButton.addEventListener('click', togglePanel);
    dom.qbankCaptureButton.addEventListener('click', toggleQBankPanel);
    dom.cleanCacheButton.addEventListener('click', cleanCache);
    dom.backdrop.addEventListener('click', handleBackdropClick);
    dom.panel.addEventListener('click', handlePanelClick);
    dom.qbankPanel.addEventListener('click', handleQBankPanelClick);
    dom.importInput.addEventListener('change', handleImportChange);
    adapterDocument.addEventListener('keydown', handleKeyDown, true);
    void refreshAttempts().catch(() => {});
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    dom.triggerButton.removeEventListener('click', togglePanel);
    dom.qbankCaptureButton.removeEventListener('click', toggleQBankPanel);
    dom.cleanCacheButton.removeEventListener('click', cleanCache);
    dom.backdrop.removeEventListener('click', handleBackdropClick);
    dom.panel.removeEventListener('click', handlePanelClick);
    dom.qbankPanel.removeEventListener('click', handleQBankPanelClick);
    dom.importInput.removeEventListener('change', handleImportChange);
    adapterDocument.removeEventListener('keydown', handleKeyDown, true);
    if (dom.root.parentNode) {
      dom.root.parentNode.removeChild(dom.root);
    }
  }

  attach();

  return Object.freeze({
    open: openPanel,
    close: closePanel,
    openQBank: openQBankPanel,
    closeQBank: closeQBankPanel,
    refresh: refreshAttempts,
    destroy,
    exportHistoryOnly,
    exportFullBackup,
    importHistoryFile,
    captureQBank,
    cleanCache,
    getState() {
      return Object.freeze({
        open: panelOpen,
        qbankOpen: qbankPanelOpen,
        attempts: attempts.slice(),
      });
    },
  });
}

export {
  LAUNCH_HISTORY_STYLE_ID,
  LAUNCH_HISTORY_ROOT_ID,
  IMPORT_REPLACE_WARNING,
  formatHistoryAttemptRow,
  canOpenReviewFromHistory,
  summarizeQBankCaptureStorage,
  formatQBankStorageStatus,
  createLaunchHistory,
};
