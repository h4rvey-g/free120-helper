import { ANSWER_KEY_CAPTURE_STATUS } from '../core/constants.js';
import { arrayOrEmpty, coercePositiveInteger, normalizeString, plainObjectOrEmpty, uniqueNormalizedStrings } from '../core/data.js';
import { QBANK_CACHE_ATTEMPT_PREFIX } from './cache-controller.js';

const MAX_QBANK_REVIEW_ITEMS_PER_BLOCK = 40;
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
  const metadata = getMetadata(candidate);
  const blockNumber = coercePositiveInteger((candidate && candidate.blockNumber) || metadata.blockNumber, 0);
  const itemIndex = coercePositiveInteger((candidate && candidate.itemIndex) || metadata.itemIndex, 0);
  return blockNumber && itemIndex ? `${blockNumber}\u0000${itemIndex}` : '';
}

function getCandidateBlockNumber(candidate) {
  const metadata = getMetadata(candidate);
  return coercePositiveInteger((candidate && candidate.blockNumber) || metadata.blockNumber, 0);
}

function parseQuestionIdBlockNumber(questionId) {
  const match = normalizeString(questionId, '').match(/(?:^|:)Block-(\d+)(?::|$)/i);
  return match ? coercePositiveInteger(match[1], 0) : 0;
}

function getEntryBlockNumber(entry) {
  const snapshot = entry && entry.snapshot ? entry.snapshot : null;
  const metadata = plainObjectOrEmpty(snapshot && snapshot.metadata);
  return coercePositiveInteger(
    snapshot && snapshot.blockNumber,
    coercePositiveInteger(metadata.blockNumber, coercePositiveInteger(metadata.qbankCacheOriginalBlockNumber || metadata.qbankFallbackOriginalBlockNumber, 0))
  );
}

function directQuestionIdMatchesCandidateBlock(candidate, entry = null) {
  const candidateBlockNumber = getCandidateBlockNumber(candidate);
  if (!candidateBlockNumber) {
    return true;
  }
  const questionIdBlockNumber = parseQuestionIdBlockNumber(candidate && candidate.questionId);
  if (questionIdBlockNumber && questionIdBlockNumber !== candidateBlockNumber) {
    return false;
  }
  const entryBlockNumber = getEntryBlockNumber(entry);
  return !entryBlockNumber || entryBlockNumber === candidateBlockNumber;
}

function parseExplicitBlockNumber(value) {
  const text = normalizeString(value, '');
  if (!text || /\b(?:all|full|entire|whole|complete)\b/i.test(text)) {
    return 0;
  }
  if (/^\d+$/.test(text)) {
    return coercePositiveInteger(text, 0);
  }
  const match = text.match(/\bblock\s*(\d+)\b/i);
  return match ? coercePositiveInteger(match[1], 0) : 0;
}

function getScopeBlockNumber(scope) {
  const source = plainObjectOrEmpty(scope);
  return parseExplicitBlockNumber(source.block)
    || parseExplicitBlockNumber(source.selectedBlock)
    || parseExplicitBlockNumber(source.launchedBlock)
    || parseExplicitBlockNumber(source.testDefinitionDisplayName)
    || parseExplicitBlockNumber(source.displayName)
    || parseExplicitBlockNumber(source.section)
    || parseExplicitBlockNumber(source.testDefinitionName);
}

function getSingleProgressBlockNumber(attempt) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const progress = plainObjectOrEmpty(source.progress);
  const byBlock = plainObjectOrEmpty(progress.byBlock);
  const blockNumbers = uniqueNormalizedStrings(Object.entries(byBlock).map(([key, block]) => {
    const progressBlock = plainObjectOrEmpty(block);
    const blockNumber = coercePositiveInteger(progressBlock.blockNumber || progressBlock.block || progressBlock.index, coercePositiveInteger(key, 0));
    const hasEvidence = coercePositiveInteger(progressBlock.total || progressBlock.itemCount || progressBlock.questionCount || progressBlock.itemsCount, 0)
      || arrayOrEmpty(progressBlock.questionIds).length
      || arrayOrEmpty(progressBlock.answeredQuestionIds).length;
    return hasEvidence ? blockNumber : 0;
  })).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  return blockNumbers.length === 1 ? blockNumbers[0] : 0;
}

function getSingleBlockMetadataNumber(attempt) {
  const blockNumbers = uniqueNormalizedStrings(arrayOrEmpty(attempt && attempt.blockMetadata).map((block, index) => {
    const blockObject = plainObjectOrEmpty(block);
    const blockNumber = coercePositiveInteger(blockObject.blockNumber || blockObject.block || blockObject.index, index + 1);
    const hasEvidence = coercePositiveInteger(blockObject.itemCount || blockObject.questionCount || blockObject.itemsCount, 0);
    return hasEvidence ? blockNumber : 0;
  })).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  return blockNumbers.length === 1 ? blockNumbers[0] : 0;
}

function getRecordedReviewBlockNumber(attempt) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  return getSingleProgressBlockNumber(attempt)
    || getSingleBlockMetadataNumber(attempt)
    || coercePositiveInteger(source.activeBlock || source.currentBlock, 0);
}

function getAttemptMetadataByQuestionId(attempt) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  return plainObjectOrEmpty(source.itemMetadataByQuestionId);
}

function mergeLookupItem(item, metadata = {}) {
  const itemObject = plainObjectOrEmpty(item);
  const itemMetadata = getMetadata(itemObject);
  const mergedMetadata = Object.freeze({ ...plainObjectOrEmpty(metadata), ...itemMetadata });
  return Object.freeze({
    ...mergedMetadata,
    ...itemObject,
    metadata: mergedMetadata,
  });
}

function getLookupCandidates(item, options = {}) {
  const base = mergeLookupItem(item);
  const scopeBlockNumber = getScopeBlockNumber(options.launchedScope || (options.attempt && options.attempt.launchedScope));
  const recordedBlockNumber = getRecordedReviewBlockNumber(options.attempt);
  const baseBlockNumber = coercePositiveInteger(base.blockNumber || getMetadata(base).blockNumber, 0);
  const allowScopeBlockRepair = options.allowScopeBlockRepair !== false;
  if (!allowScopeBlockRepair) {
    return [base];
  }
  const candidateBlockNumbers = uniqueNormalizedStrings([
    recordedBlockNumber && recordedBlockNumber === baseBlockNumber ? baseBlockNumber : 0,
    recordedBlockNumber,
    !recordedBlockNumber ? scopeBlockNumber : 0,
    baseBlockNumber,
    scopeBlockNumber,
  ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean);
  if (!candidateBlockNumbers.length || (candidateBlockNumbers.length === 1 && candidateBlockNumbers[0] === baseBlockNumber)) {
    return [base];
  }
  return candidateBlockNumbers.map((blockNumber) => {
    if (blockNumber === baseBlockNumber) {
      return base;
    }
    return Object.freeze({
      ...base,
      blockNumber,
      metadata: Object.freeze({ ...getMetadata(base), blockNumber }),
    });
  });
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
function resolveQBankEntryForItem(context, item, options = {}) {
  if (!context) {
    return null;
  }
  const candidates = getLookupCandidates(item, options);
  for (const candidate of candidates) {
    const questionId = normalizeString(candidate && candidate.questionId, '');
    const directSnapshotEntry = questionId ? context.snapshotEntriesByQuestionId.get(questionId) : null;
    if (directSnapshotEntry && directQuestionIdMatchesCandidateBlock(candidate, directSnapshotEntry)) {
      return Object.freeze({ ...directSnapshotEntry, matchSource: 'question-id' });
    }
    const directCorrectAnswerId = questionId ? normalizeString(context.correctAnswersByQuestionId.get(questionId), '') : '';
    if (directCorrectAnswerId && directQuestionIdMatchesCandidateBlock(candidate)) {
      return Object.freeze({ ...createDirectAnswerEntry(questionId, directCorrectAnswerId), matchSource: 'question-id' });
    }
  }
  for (const candidate of candidates) {
    const componentEntry = context.snapshotEntriesByComponentKey.get(qbankComponentKey(candidate));
    if (componentEntry) {
      const matchSource = candidate === candidates[0] ? 'component-medley' : 'component-medley-original-block';
      return Object.freeze({ ...componentEntry, matchSource });
    }
  }
  for (const candidate of candidates) {
    const itemMetadata = getMetadata(candidate);
    const itemBlockNumber = coercePositiveInteger((candidate && candidate.blockNumber) || itemMetadata.blockNumber, 0);
    const allowUnscopedComponentFallback = options.allowUnscopedComponentFallback === true;
    const unscopedComponentKey = (!itemBlockNumber || allowUnscopedComponentFallback) ? qbankUnscopedComponentKey(candidate) : '';
    const unscopedMap = context.snapshotEntriesByUnscopedComponentKey;
    const ambiguousKeys = context.ambiguousUnscopedComponentKeys;
    const unscopedEntry = unscopedMap && unscopedComponentKey && !(ambiguousKeys && ambiguousKeys.has(unscopedComponentKey))
      ? unscopedMap.get(unscopedComponentKey)
      : null;
    if (unscopedEntry) {
      return Object.freeze({ ...unscopedEntry, matchSource: itemBlockNumber ? 'component-medley-unscoped-block-mismatch' : 'component-medley-unscoped' });
    }
  }
  for (const candidate of candidates) {
    const positionEntry = context.snapshotEntriesByPositionKey.get(qbankPositionKey(candidate));
    if (positionEntry) {
      const matchSource = candidate === candidates[0] ? 'block-position' : 'block-position-original-block';
      return Object.freeze({ ...positionEntry, matchSource });
    }
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
  const metadataByQuestionId = getAttemptMetadataByQuestionId(options.attempt);
  const itemByQuestionId = new Map();
  [...itemList, currentItem].filter(Boolean).forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (questionId && !itemByQuestionId.has(questionId)) {
      itemByQuestionId.set(questionId, mergeLookupItem(item, metadataByQuestionId[questionId]));
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
    const liveItem = itemByQuestionId.get(questionId);
    const item = liveItem || mergeLookupItem({ questionId }, metadataByQuestionId[questionId]);
    const allowScopeBlockRepair = Object.prototype.hasOwnProperty.call(options, 'allowScopeBlockRepair')
      ? options.allowScopeBlockRepair !== false
      : !liveItem;
    const match = resolveQBankEntryForItem(context, item, { attempt: options.attempt, launchedScope: options.launchedScope, allowScopeBlockRepair });
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
  const snapshotMetadata = plainObjectOrEmpty(match && match.snapshot && match.snapshot.metadata);
  const originalBlockNumber = coercePositiveInteger(match && match.snapshot && match.snapshot.blockNumber, coercePositiveInteger(snapshotMetadata.blockNumber, 0));
  const originalItemIndex = coercePositiveInteger(match && match.snapshot && match.snapshot.itemIndex, coercePositiveInteger(snapshotMetadata.itemIndex, 0));
  const itemBlockNumber = coercePositiveInteger(item && item.blockNumber, 0);
  const itemIndex = coercePositiveInteger(item && item.itemIndex, 0);
  const unscopedBlockMismatch = normalizeString(match && match.matchSource, '') === 'component-medley-unscoped-block-mismatch';
  const blockNumber = unscopedBlockMismatch && itemBlockNumber ? itemBlockNumber : (originalBlockNumber || itemBlockNumber);
  const clonedItemIndex = unscopedBlockMismatch && itemIndex ? itemIndex : (originalItemIndex || itemIndex);
  return Object.freeze({
    ...match.snapshot,
    id: `${normalizeString(match.snapshot.id, 'qbank-snapshot')}::qbank::${questionId}`,
    questionId,
    blockNumber,
    itemIndex: clonedItemIndex,
    metadata: Object.freeze({
      ...snapshotMetadata,
      ...plainObjectOrEmpty(item),
      blockNumber,
      itemIndex: clonedItemIndex,
      qbankCacheOriginalQuestionId: normalizeString(match.qbankQuestionId, ''),
      qbankCacheOriginalBlockNumber: originalBlockNumber,
      qbankCacheOriginalItemIndex: originalItemIndex,
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
function sanitizeReviewMissingQuestionIdPart(value) {
  return normalizeString(value, '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 120) || 'attempt';
}

function createReviewMissingQuestionId(attempt, blockNumber, itemIndex, seenIds) {
  const attemptPart = sanitizeReviewMissingQuestionIdPart(attempt && attempt.id);
  const baseId = `webfred:review-missing:${attemptPart}:block-${blockNumber}:item-${itemIndex}`;
  let candidateId = baseId;
  let suffix = 2;
  while (seenIds.has(candidateId)) {
    candidateId = `${baseId}:${suffix}`;
    suffix += 1;
  }
  return candidateId;
}

function getAttemptBlockMetadataItemCount(attempt, blockNumber) {
  const normalizedBlockNumber = coercePositiveInteger(blockNumber, 0);
  const blocks = arrayOrEmpty(attempt && attempt.blockMetadata);
  const block = blocks.find((entry) => coercePositiveInteger(entry && (entry.blockNumber || entry.block || entry.index), 0) === normalizedBlockNumber)
    || (blocks.length === 1 ? blocks[0] : null);
  return coercePositiveInteger(block && (block.itemCount || block.questionCount || block.itemsCount), 0);
}

function getAttemptProgressBlockTotal(attempt, blockNumber) {
  const source = plainObjectOrEmpty(attempt && attempt.source);
  const progress = plainObjectOrEmpty(source.progress);
  const byBlock = plainObjectOrEmpty(progress.byBlock);
  const block = plainObjectOrEmpty(byBlock[String(blockNumber)] || byBlock[blockNumber]);
  return coercePositiveInteger(block.total || block.itemCount || block.questionCount || block.itemsCount, 0);
}

function getQBankReviewFallbackBlock(attempt) {
  const scopeBlockNumber = getScopeBlockNumber(attempt && attempt.launchedScope);
  const recordedBlockNumber = getRecordedReviewBlockNumber(attempt);
  const metadataByQuestionId = getAttemptMetadataByQuestionId(attempt);
  const metadataBlockNumbers = uniqueNormalizedStrings(Object.values(metadataByQuestionId).map((metadata) => metadata && metadata.blockNumber))
    .map((entry) => coercePositiveInteger(entry, 0))
    .filter(Boolean);
  const blockNumber = recordedBlockNumber || scopeBlockNumber || (metadataBlockNumbers.length === 1 ? metadataBlockNumbers[0] : 0);
  if (!blockNumber) {
    return Object.freeze({ blockNumber: 0, expectedCount: 0 });
  }
  const expectedCount = Math.min(MAX_QBANK_REVIEW_ITEMS_PER_BLOCK, Math.max(
    coercePositiveInteger(attempt && attempt.questionCount, 0),
    getAttemptBlockMetadataItemCount(attempt, blockNumber),
    getAttemptProgressBlockTotal(attempt, blockNumber)
  ));
  return Object.freeze({ blockNumber, expectedCount });
}

function getSnapshotPosition(snapshot) {
  const metadata = plainObjectOrEmpty(snapshot && snapshot.metadata);
  const blockNumber = coercePositiveInteger(metadata.qbankCacheOriginalBlockNumber, coercePositiveInteger(snapshot && snapshot.blockNumber, coercePositiveInteger(metadata.blockNumber, 0)));
  const itemIndex = coercePositiveInteger(metadata.qbankCacheOriginalItemIndex, coercePositiveInteger(snapshot && snapshot.itemIndex, coercePositiveInteger(metadata.itemIndex, 0)));
  return Object.freeze({ blockNumber, itemIndex });
}

function appendMissingQBankPositionSnapshots(qbankSnapshots, context, attempt, ownSnapshots = []) {
  const fallbackBlock = getQBankReviewFallbackBlock(attempt);
  const blockNumber = fallbackBlock.blockNumber;
  const expectedCount = fallbackBlock.expectedCount;
  if (!blockNumber || !expectedCount || qbankSnapshots.length >= expectedCount) {
    return qbankSnapshots;
  }
  const seenIds = new Set(uniqueNormalizedStrings([
    ...arrayOrEmpty(attempt && attempt.questionIds),
    ...qbankSnapshots.map((snapshot) => snapshot && snapshot.questionId),
    ...arrayOrEmpty(ownSnapshots).map((snapshot) => snapshot && snapshot.questionId),
  ]));
  const usedPositions = new Set(qbankSnapshots.map(getSnapshotPosition)
    .filter((position) => position.blockNumber === blockNumber && position.itemIndex)
    .map((position) => position.itemIndex));
  const appended = qbankSnapshots.slice();
  for (let itemIndex = 1; itemIndex <= expectedCount && appended.length < expectedCount; itemIndex += 1) {
    if (usedPositions.has(itemIndex)) {
      continue;
    }
    const entry = context.snapshotEntriesByPositionKey.get(`${blockNumber}\u0000${itemIndex}`);
    if (!entry || !entry.snapshot) {
      continue;
    }
    const missingQuestionId = createReviewMissingQuestionId(attempt, blockNumber, itemIndex, seenIds);
    if (hasOwnSnapshot(ownSnapshots, missingQuestionId)) {
      continue;
    }
    appended.push(cloneQBankSnapshotForQuestion(Object.freeze({ ...entry, matchSource: 'block-position-missing' }), missingQuestionId, Object.freeze({
      questionId: missingQuestionId,
      blockNumber,
      itemIndex,
    })));
    seenIds.add(missingQuestionId);
    usedPositions.add(itemIndex);
  }
  return appended;
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
    const match = resolveQBankEntryForItem(context, { questionId, ...metadata }, { attempt, allowUnscopedComponentFallback: true });
    if (match && match.snapshot) {
      qbankSnapshots.push(cloneQBankSnapshotForQuestion(match, questionId, metadata));
    }
  });
  return appendMissingQBankPositionSnapshots(qbankSnapshots, context, attempt, ownSnapshots);
}
export {
  isQBankCacheAttempt,
  loadQBankCaptureContext,
  resolveQBankCaptureForItems,
  loadQBankSnapshotsForAttempt,
};
