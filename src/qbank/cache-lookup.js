import { ANSWER_KEY_CAPTURE_STATUS } from '../core/constants.js';
import { isPlainObject, normalizeString } from '../storage/attempt-store.js';
import { QBANK_CACHE_ATTEMPT_PREFIX } from './cache-controller.js';
function coercePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function plainObjectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}
function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}
function uniqueNormalizedStrings(values) {
  const seen = new Set();
  const result = [];
  arrayOrEmpty(values).forEach((value) => {
    const normalized = normalizeString(value, '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}
function isQBankCacheAttempt(attempt) {
  const id = normalizeString(attempt && attempt.id, '');
  const source = plainObjectOrEmpty(attempt && attempt.source);
  return id.startsWith(`${QBANK_CACHE_ATTEMPT_PREFIX}:`)
    || normalizeString(source.cacheKind, '') === 'qbank'
    || normalizeString(source.createdBy, '') === 'qbank-cache-controller';
}
function getMetadata(candidate) {
  return plainObjectOrEmpty(candidate && candidate.metadata);
}
function qbankUnscopedComponentKey(candidate) {
  const metadata = getMetadata(candidate);
  const componentId = normalizeString((candidate && candidate.componentId) || metadata.componentId, '');
  const medleyId = normalizeString((candidate && candidate.medleyId) || metadata.medleyId, '');
  return componentId && medleyId ? `${medleyId}\u0000${componentId}` : '';
}
function qbankComponentKey(candidate) {
  const metadata = getMetadata(candidate);
  const blockNumber = coercePositiveInteger((candidate && candidate.blockNumber) || metadata.blockNumber, 0);
  const unscopedKey = qbankUnscopedComponentKey(candidate);
  return unscopedKey && blockNumber ? `${blockNumber}\u0000${unscopedKey}` : '';
}
function qbankPositionKey(candidate) {
  const blockNumber = coercePositiveInteger(candidate && candidate.blockNumber, 0);
  const itemIndex = coercePositiveInteger(candidate && candidate.itemIndex, 0);
  return blockNumber && itemIndex ? `${blockNumber}\u0000${itemIndex}` : '';
}
function setIfAbsent(map, key, value) {
  if (key && value !== undefined && value !== null && value !== '' && !map.has(key)) {
    map.set(key, value);
  }
}
function createSnapshotEntry(qbankAttempt, snapshot) {
  const questionId = normalizeString(snapshot && snapshot.questionId, '');
  const attemptCorrectAnswers = plainObjectOrEmpty(qbankAttempt && qbankAttempt.correctAnswers);
  return Object.freeze({
    qbankAttemptId: normalizeString(qbankAttempt && qbankAttempt.id, ''),
    qbankQuestionId: questionId,
    correctAnswerId: normalizeString(snapshot && snapshot.correctAnswerId, normalizeString(attemptCorrectAnswers[questionId], '')),
    componentKey: qbankComponentKey(snapshot),
    positionKey: qbankPositionKey(snapshot),
    snapshot,
  });
}
function createDirectAnswerEntry(questionId, correctAnswerId) {
  return Object.freeze({
    qbankAttemptId: '',
    qbankQuestionId: questionId,
    correctAnswerId,
    componentKey: '',
    positionKey: '',
    snapshot: null,
  });
}
function setUnscopedComponentEntry(context, key, entry) {
  if (!key || !entry) {
    return;
  }
  const existing = context.snapshotEntriesByUnscopedComponentKey.get(key);
  if (!existing) {
    context.snapshotEntriesByUnscopedComponentKey.set(key, entry);
    return;
  }
  if (normalizeString(existing.qbankQuestionId, '') !== normalizeString(entry.qbankQuestionId, '')
    || normalizeString(existing.qbankAttemptId, '') !== normalizeString(entry.qbankAttemptId, '')) {
    context.ambiguousUnscopedComponentKeys.add(key);
  }
}

async function loadQBankCaptureContext(storage, logger = null) {
  const loadedAt = new Date().toISOString();
  const context = {
    loadedAt,
    qbankAttemptIds: [],
    correctAnswersByQuestionId: new Map(),
    snapshotEntriesByQuestionId: new Map(),
    snapshotEntriesByComponentKey: new Map(),
    snapshotEntriesByPositionKey: new Map(),
    snapshotEntriesByUnscopedComponentKey: new Map(),
    ambiguousUnscopedComponentKeys: new Set(),
    loadErrors: [],
  };
  if (!storage || typeof storage.listAttempts !== 'function') {
    return Object.freeze({ ...context, available: false });
  }
  let attempts = [];
  try {
    attempts = (await storage.listAttempts({ includeInProgress: true })).filter(isQBankCacheAttempt);
  } catch (error) {
    context.loadErrors.push(normalizeString(error && error.message, 'qbank attempt load failed'));
    if (logger && typeof logger.warn === 'function') {
      logger.warn('QBank cache attempts could not be loaded.', error);
    }
  }
  for (const qbankAttempt of attempts) {
    const attemptId = normalizeString(qbankAttempt && qbankAttempt.id, '');
    if (attemptId) {
      context.qbankAttemptIds.push(attemptId);
    }
    Object.entries(plainObjectOrEmpty(qbankAttempt && qbankAttempt.correctAnswers)).forEach(([questionId, correctAnswerId]) => {
      const normalizedQuestionId = normalizeString(questionId, '');
      const normalizedCorrectAnswerId = normalizeString(correctAnswerId, '');
      setIfAbsent(context.correctAnswersByQuestionId, normalizedQuestionId, normalizedCorrectAnswerId);
    });
    if (!storage || typeof storage.listQuestionSnapshots !== 'function') {
      continue;
    }
    try {
      const snapshots = await storage.listQuestionSnapshots(attemptId);
      arrayOrEmpty(snapshots).forEach((snapshot) => {
        const entry = createSnapshotEntry(qbankAttempt, snapshot);
        setIfAbsent(context.snapshotEntriesByQuestionId, entry.qbankQuestionId, entry);
        setIfAbsent(context.snapshotEntriesByComponentKey, entry.componentKey, entry);
        setIfAbsent(context.snapshotEntriesByPositionKey, entry.positionKey, entry);
        setUnscopedComponentEntry(context, qbankUnscopedComponentKey(snapshot), entry);
        setIfAbsent(context.correctAnswersByQuestionId, entry.qbankQuestionId, entry.correctAnswerId);
      });
    } catch (error) {
      context.loadErrors.push(normalizeString(error && error.message, `qbank snapshots load failed: ${attemptId}`));
      if (logger && typeof logger.warn === 'function') {
        logger.warn('QBank cache snapshots could not be loaded.', attemptId, error);
      }
    }
  }
  return Object.freeze({
    ...context,
    qbankAttemptIds: Object.freeze(uniqueNormalizedStrings(context.qbankAttemptIds)),
    ambiguousUnscopedComponentKeys: Object.freeze(new Set(context.ambiguousUnscopedComponentKeys)),
    loadErrors: Object.freeze(context.loadErrors.slice()),
    available: context.qbankAttemptIds.length > 0,
  });
}
function resolveQBankEntryForItem(context, item) {
  if (!context) {
    return null;
  }
  const questionId = normalizeString(item && item.questionId, '');
  const directSnapshotEntry = questionId ? context.snapshotEntriesByQuestionId.get(questionId) : null;
  if (directSnapshotEntry) {
    return Object.freeze({ ...directSnapshotEntry, matchSource: 'question-id' });
  }
  const directCorrectAnswerId = questionId ? normalizeString(context.correctAnswersByQuestionId.get(questionId), '') : '';
  if (directCorrectAnswerId) {
    return Object.freeze({ ...createDirectAnswerEntry(questionId, directCorrectAnswerId), matchSource: 'question-id' });
  }
  const componentEntry = context.snapshotEntriesByComponentKey.get(qbankComponentKey(item));
  if (componentEntry) {
    return Object.freeze({ ...componentEntry, matchSource: 'component-medley' });
  }
  const positionEntry = context.snapshotEntriesByPositionKey.get(qbankPositionKey(item));
  if (positionEntry) {
    return Object.freeze({ ...positionEntry, matchSource: 'block-position' });
  }
  const itemMetadata = getMetadata(item);
  const itemBlockNumber = coercePositiveInteger((item && item.blockNumber) || itemMetadata.blockNumber, 0);
  const unscopedComponentKey = !itemBlockNumber ? qbankUnscopedComponentKey(item) : '';
  const unscopedMap = context.snapshotEntriesByUnscopedComponentKey;
  const ambiguousKeys = context.ambiguousUnscopedComponentKeys;
  const unscopedEntry = unscopedMap && unscopedComponentKey && !(ambiguousKeys && ambiguousKeys.has(unscopedComponentKey))
    ? unscopedMap.get(unscopedComponentKey)
    : null;
  if (unscopedEntry) {
    return Object.freeze({ ...unscopedEntry, matchSource: 'component-medley-unscoped' });
  }
  return null;
}
function buildQBankSummary(context, expectedCount, knownCount) {
  if (!context) {
    return null;
  }
  const expected = Math.max(0, Number(expectedCount) || 0);
  const known = Math.max(0, Number(knownCount) || 0);
  const unknown = Math.max(0, expected - known);
  const status = !context.available
    ? ANSWER_KEY_CAPTURE_STATUS.FAILED
    : (expected > 0 && known >= expected
        ? ANSWER_KEY_CAPTURE_STATUS.COMPLETE
        : (known > 0 ? ANSWER_KEY_CAPTURE_STATUS.PARTIAL : ANSWER_KEY_CAPTURE_STATUS.FAILED));
  const failureReason = status === ANSWER_KEY_CAPTURE_STATUS.FAILED
    ? (context.available ? 'qbank-cache-no-matches' : 'qbank-cache-missing')
    : '';
  const failureDetail = failureReason === 'qbank-cache-missing'
    ? 'Run QBank capture from the launch page before starting the exam.'
    : (failureReason === 'qbank-cache-no-matches' ? 'Captured QBank entries did not match this exam attempt.' : '');
  return Object.freeze({
    status,
    source: 'qbank-cache',
    expectedCount: expected,
    knownCount: known,
    unknownCount: unknown,
    retryCount: 0,
    manual: false,
    capturedAt: context.loadedAt,
    noNavigation: true,
    noAnswerMutation: true,
    noSubmit: true,
    qbankAttemptIds: Object.freeze(arrayOrEmpty(context.qbankAttemptIds)),
    failureReason,
    failureDetail,
  });
}

function resolveQBankCaptureForItems(context, options = {}) {
  if (!context) {
    return null;
  }
  const itemList = arrayOrEmpty(options.itemList);
  const currentItem = options.currentItem || null;
  const itemByQuestionId = new Map();
  [...itemList, currentItem].filter(Boolean).forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (questionId && !itemByQuestionId.has(questionId)) {
      itemByQuestionId.set(questionId, item);
    }
  });
  const questionIds = uniqueNormalizedStrings([
    ...arrayOrEmpty(options.questionIds),
    ...itemList.map((item) => item && item.questionId),
    currentItem && currentItem.questionId,
  ]);
  const correctAnswers = {};
  const snapshotsByQuestionId = {};
  const matchedQuestionIds = [];
  const unmatchedQuestionIds = [];
  const matchSourcesByQuestionId = {};
  questionIds.forEach((questionId) => {
    const item = itemByQuestionId.get(questionId) || { questionId };
    const match = resolveQBankEntryForItem(context, item);
    const correctAnswerId = normalizeString(match && match.correctAnswerId, '');
    if (correctAnswerId) {
      correctAnswers[questionId] = correctAnswerId;
      if (match.snapshot) {
        snapshotsByQuestionId[questionId] = cloneQBankSnapshotForQuestion(match, questionId, item);
      }
      matchedQuestionIds.push(questionId);
      matchSourcesByQuestionId[questionId] = normalizeString(match.matchSource, 'qbank-cache');
    } else {
      unmatchedQuestionIds.push(questionId);
    }
  });
  const expectedCount = Math.max(questionIds.length, coercePositiveInteger(options.expectedCount, 0));
  const summary = buildQBankSummary(context, expectedCount, Object.keys(correctAnswers).length);
  return Object.freeze({
    correctAnswers: Object.freeze(correctAnswers),
    snapshotsByQuestionId: Object.freeze(snapshotsByQuestionId),
    summary,
    source: Object.freeze({
      status: summary.status,
      source: summary.source,
      loadedAt: context.loadedAt,
      qbankAttemptIds: summary.qbankAttemptIds,
      matchedQuestionIds: Object.freeze(matchedQuestionIds),
      unmatchedQuestionIds: Object.freeze(unmatchedQuestionIds),
      matchSourcesByQuestionId: Object.freeze(matchSourcesByQuestionId),
      loadErrors: Object.freeze(arrayOrEmpty(context.loadErrors)),
    }),
  });
}
function getAttemptItemMetadata(attempt, questionId) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const metadataByQuestionId = plainObjectOrEmpty(source.itemMetadataByQuestionId);
  return plainObjectOrEmpty(metadataByQuestionId[questionId]);
}
function cloneQBankSnapshotForQuestion(match, questionId, item = {}) {
  const itemBlockNumber = coercePositiveInteger(item && item.blockNumber, 0);
  const itemIndex = coercePositiveInteger(item && item.itemIndex, 0);
  return Object.freeze({
    ...match.snapshot,
    id: `${normalizeString(match.snapshot.id, 'qbank-snapshot')}::qbank::${questionId}`,
    questionId,
    blockNumber: itemBlockNumber || match.snapshot.blockNumber,
    itemIndex: itemIndex || match.snapshot.itemIndex,
    metadata: Object.freeze({
      ...plainObjectOrEmpty(match.snapshot.metadata),
      ...plainObjectOrEmpty(item),
      qbankCacheOriginalQuestionId: normalizeString(match.qbankQuestionId, ''),
      qbankCacheAttemptId: normalizeString(match.qbankAttemptId, ''),
      qbankCacheMatchSource: normalizeString(match.matchSource, 'qbank-cache'),
      qbankFallbackOriginalQuestionId: normalizeString(match.qbankQuestionId, ''),
      qbankFallbackAttemptId: normalizeString(match.qbankAttemptId, ''),
    }),
  });
}
function hasOwnSnapshot(ownSnapshots, questionId) {
  return arrayOrEmpty(ownSnapshots).some((snapshot) => normalizeString(snapshot && snapshot.questionId, '') === questionId
    && normalizeString(snapshot && (snapshot.renderedHtml || snapshot.promptHtml), ''));
}
async function loadQBankSnapshotsForAttempt(storage, attempt, ownSnapshots = [], options = {}) {
  const context = options.context || await loadQBankCaptureContext(storage, options.logger || null);
  const targetQuestionIds = uniqueNormalizedStrings(arrayOrEmpty(attempt && attempt.questionIds));
  if (!targetQuestionIds.length || !context || !context.available) {
    return [];
  }
  const qbankSnapshots = [];
  targetQuestionIds.forEach((questionId) => {
    if (options.onlyMissing === true && hasOwnSnapshot(ownSnapshots, questionId)) {
      return;
    }
    const metadata = getAttemptItemMetadata(attempt, questionId);
    const match = resolveQBankEntryForItem(context, { questionId, ...metadata });
    if (match && match.snapshot) {
      qbankSnapshots.push(cloneQBankSnapshotForQuestion(match, questionId, metadata));
    }
  });
  return qbankSnapshots;
}
export {
  isQBankCacheAttempt,
  loadQBankCaptureContext,
  resolveQBankCaptureForItems,
  loadQBankSnapshotsForAttempt,
};
