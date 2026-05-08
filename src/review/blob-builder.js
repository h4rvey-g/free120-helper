import { SCRIPT } from '../core/constants.js';
import { coercePositiveInteger, normalizeString } from '../core/data.js';
import { GRADE_STATUS } from '../scoring/grader.js';
import { buildReviewModel } from './model.js';
import { REVIEW_PAGE_CSS } from './page-styles.js';
import { isQBankCacheAttempt, loadQBankSnapshotsForAttempt } from '../qbank/cache-lookup.js';
import { extractMediaResourceUrlsForHtml, extractResourceUrlsFromHtml, fetchResourceDataByUrl, normalizeResourceUrl } from '../media/resource-cache.js';

const REVIEW_PAGE_VERSION = 1;
const REVIEW_RESOURCE_BASE_URL = `${SCRIPT.ORIGIN}/webfred/`;

function escapeHtml(value) {
  return normalizeString(value, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function statusSymbol(status) {
  switch (status) {
    case GRADE_STATUS.CORRECT:
      return '✓';
    case GRADE_STATUS.INCORRECT:
      return '✕';
    case GRADE_STATUS.OMITTED:
      return '–';
    case GRADE_STATUS.UNKNOWN:
      return '?';
    default:
      return '•';
  }
}

function scoreLabel(scoreSummary) {
  const score = scoreSummary && scoreSummary.overallScore ? scoreSummary.overallScore : null;
  if (!score) {
    return 'Score unavailable';
  }
  const unknown = Number(scoreSummary.unknown || 0);
  const suffix = unknown > 0 ? ` · ${unknown} unknown key${unknown === 1 ? '' : 's'}` : '';
  return `${score.label} (${score.percent}%)${suffix}`;
}

function summarizeBlockCounts(values) {
  const counts = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const blockNumber = Number(value && (value.blockNumber || value.block || value.index) || 0);
    const key = Number.isInteger(blockNumber) && blockNumber > 0 ? String(blockNumber) : 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Object.freeze(Object.fromEntries(Array.from(counts.entries()).sort((left, right) => Number(left[0]) - Number(right[0]))));
}

function summarizeQuestionIds(questionIds) {
  const ids = Array.isArray(questionIds) ? questionIds.map((questionId) => normalizeString(questionId, '')).filter(Boolean) : [];
  return Object.freeze({
    count: ids.length,
    first: Object.freeze(ids.slice(0, 5)),
    last: Object.freeze(ids.slice(-5)),
  });
}

function summarizeAttemptBlocksForDebug(attempt) {
  const source = attempt && attempt.source && typeof attempt.source === 'object' ? attempt.source : {};
  const metadataByQuestionId = source.itemMetadataByQuestionId && typeof source.itemMetadataByQuestionId === 'object' ? source.itemMetadataByQuestionId : {};
  const progress = source.progress && typeof source.progress === 'object' ? source.progress : {};
  const progressByBlock = progress.byBlock && typeof progress.byBlock === 'object' ? progress.byBlock : {};
  return Object.freeze({
    launchedScope: Object.freeze({ ...(attempt && attempt.launchedScope && typeof attempt.launchedScope === 'object' ? attempt.launchedScope : {}) }),
    questionIds: summarizeQuestionIds(attempt && attempt.questionIds),
    questionCount: Number(attempt && attempt.questionCount || 0),
    blockMetadata: Object.freeze((Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : []).map((block) => Object.freeze({
      blockNumber: Number(block && (block.blockNumber || block.block || block.index) || 0),
      itemCount: Number(block && (block.itemCount || block.questionCount || block.itemsCount) || 0),
      label: normalizeString(block && block.label, ''),
    }))),
    metadataBlockCounts: summarizeBlockCounts(Object.values(metadataByQuestionId)),
    progressByBlock: Object.freeze(Object.fromEntries(Object.entries(progressByBlock).map(([key, block]) => {
      const entry = block && typeof block === 'object' ? block : {};
      return [key, Object.freeze({
        blockNumber: Number(entry.blockNumber || key || 0),
        total: Number(entry.total || entry.itemCount || entry.questionCount || entry.itemsCount || 0),
        questionIds: Array.isArray(entry.questionIds) ? entry.questionIds.length : 0,
        answeredQuestionIds: Array.isArray(entry.answeredQuestionIds) ? entry.answeredQuestionIds.length : 0,
      })];
    }))),
  });
}

function getSnapshotBlockNumber(snapshot) {
  const metadata = snapshot && snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {};
  return coercePositiveInteger((snapshot && snapshot.blockNumber) || metadata.blockNumber, 0);
}

function snapshotHasUserState(snapshot) {
  return Boolean(
    normalizeString(snapshot && snapshot.selectedAnswerId, '')
      || (Array.isArray(snapshot && snapshot.choices) && snapshot.choices.some((choice) => choice && choice.selected))
      || Number(snapshot && snapshot.timingMs || 0) > 0
      || normalizeString(snapshot && snapshot.notes, '')
      || (snapshot && snapshot.annotations && typeof snapshot.annotations === 'object'
        && ((Array.isArray(snapshot.annotations.highlights) && snapshot.annotations.highlights.length)
          || (Array.isArray(snapshot.annotations.strikeouts) && snapshot.annotations.strikeouts.length)))
  );
}

function snapshotHasLiveBlockEvidence(snapshot) {
  const metadata = snapshot && snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {};
  const contentSource = normalizeString(metadata.questionContentSource || metadata.contentSource, '').toLowerCase();
  return Boolean(metadata.capturedFromDom)
    || contentSource === 'dom-current-item'
    || contentSource === 'adapter-current-content';
}

function getSnapshotItemIndex(snapshot, fallback = 0) {
  const metadata = snapshot && snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {};
  return coercePositiveInteger((snapshot && snapshot.itemIndex) || metadata.itemIndex, fallback);
}

function countBlockNumbers(values) {
  const counts = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const blockNumber = coercePositiveInteger(value, 0);
    if (blockNumber) {
      counts.set(blockNumber, (counts.get(blockNumber) || 0) + 1);
    }
  });
  return counts;
}

function uniquePositiveIntegers(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const number = coercePositiveInteger(value, 0);
    if (number && !seen.has(number)) {
      seen.add(number);
      result.push(number);
    }
  });
  return result.sort((left, right) => left - right);
}

function getDominantBlockNumberFromCounts(counts) {
  if (!counts || !counts.size) {
    return 0;
  }
  return Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0] - right[0];
  })[0][0];
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

function getDominantAttemptMetadataBlockNumber(attempt) {
  const source = attempt && attempt.source && typeof attempt.source === 'object' ? attempt.source : {};
  const metadataByQuestionId = source.itemMetadataByQuestionId && typeof source.itemMetadataByQuestionId === 'object' ? source.itemMetadataByQuestionId : {};
  return getDominantBlockNumberFromCounts(countBlockNumbers(Object.values(metadataByQuestionId).map((metadata) => metadata && metadata.blockNumber)));
}

function getAttemptMetadataBlockNumbers(attempt) {
  const source = attempt && attempt.source && typeof attempt.source === 'object' ? attempt.source : {};
  const metadataByQuestionId = source.itemMetadataByQuestionId && typeof source.itemMetadataByQuestionId === 'object' ? source.itemMetadataByQuestionId : {};
  return uniquePositiveIntegers(Object.values(metadataByQuestionId).map((metadata) => metadata && metadata.blockNumber));
}

function getSingleProgressBlockNumber(attempt) {
  const source = attempt && attempt.source && typeof attempt.source === 'object' ? attempt.source : {};
  const progress = source.progress && typeof source.progress === 'object' ? source.progress : {};
  const byBlock = progress.byBlock && typeof progress.byBlock === 'object' ? progress.byBlock : {};
  const blockNumbers = uniquePositiveIntegers(Object.entries(byBlock).map(([key, block]) => {
    const entry = block && typeof block === 'object' ? block : {};
    const blockNumber = coercePositiveInteger(entry.blockNumber || entry.block || entry.index, coercePositiveInteger(key, 0));
    const hasEvidence = coercePositiveInteger(entry.total || entry.itemCount || entry.questionCount || entry.itemsCount, 0)
      || (Array.isArray(entry.questionIds) ? entry.questionIds.length : 0)
      || (Array.isArray(entry.answeredQuestionIds) ? entry.answeredQuestionIds.length : 0);
    return hasEvidence ? blockNumber : 0;
  }));
  return blockNumbers.length === 1 ? blockNumbers[0] : 0;
}

function getBlockMetadataEntries(attempt) {
  return (Array.isArray(attempt && attempt.blockMetadata) ? attempt.blockMetadata : [])
    .map((block, index) => {
      const entry = block && typeof block === 'object' ? block : {};
      const blockNumber = coercePositiveInteger(entry.blockNumber || entry.block || entry.index, index + 1);
      const itemCount = coercePositiveInteger(entry.itemCount || entry.questionCount || entry.itemsCount, 0);
      return Object.freeze({ blockNumber, itemCount });
    })
    .filter((block) => block.blockNumber && block.itemCount);
}

function getSingleBlockMetadataNumber(attempt) {
  const blockNumbers = uniquePositiveIntegers(getBlockMetadataEntries(attempt).map((block) => block.blockNumber));
  return blockNumbers.length === 1 ? blockNumbers[0] : 0;
}

function getReviewBlockMetadataRepairNumber(attempt, metadataBlockNumbers) {
  const sourceBlocks = uniquePositiveIntegers(metadataBlockNumbers);
  if (sourceBlocks.length !== 1 || coercePositiveInteger(attempt && attempt.questionCount, 0) > 40) {
    return 0;
  }
  const sourceBlockNumber = sourceBlocks[0];
  const expectedCount = Math.min(40, Math.max(coercePositiveInteger(attempt && attempt.questionCount, 0), 1));
  const candidates = getBlockMetadataEntries(attempt)
    .filter((block) => block.blockNumber !== sourceBlockNumber)
    .sort((left, right) => {
      const leftFull = left.itemCount >= expectedCount ? 1 : 0;
      const rightFull = right.itemCount >= expectedCount ? 1 : 0;
      if (rightFull !== leftFull) {
        return rightFull - leftFull;
      }
      return right.blockNumber - left.blockNumber;
    });
  return candidates.length ? candidates[0].blockNumber : 0;
}

function getRecordedReviewBlockNumber(attempt) {
  const source = attempt && attempt.source && typeof attempt.source === 'object' ? attempt.source : {};
  return getSingleProgressBlockNumber(attempt)
    || getSingleBlockMetadataNumber(attempt)
    || coercePositiveInteger(source.activeBlock || source.currentBlock, 0);
}

function inferReviewBlockNumberFromOwnSnapshots(attempt, ownSnapshots) {
  const ownList = Array.isArray(ownSnapshots) ? ownSnapshots : [];
  const liveContentSnapshots = ownList.filter(snapshotHasLiveBlockEvidence);
  const userStateSnapshots = ownList.filter(snapshotHasUserState);
  const snapshots = liveContentSnapshots.length
    ? liveContentSnapshots
    : (userStateSnapshots.length ? userStateSnapshots : ownList.filter((snapshot) => normalizeString(snapshot && (snapshot.renderedHtml || snapshot.promptHtml), '')));
  if (!snapshots.length || coercePositiveInteger(attempt && attempt.questionCount, 0) > 40) {
    return 0;
  }
  const snapshotCounts = countBlockNumbers(snapshots.map(getSnapshotBlockNumber));
  if (snapshotCounts.size !== 1) {
    return 0;
  }
  return getDominantBlockNumberFromCounts(snapshotCounts);
}

function getQBankOriginalBlockNumber(snapshot) {
  const metadata = snapshot && snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {};
  return coercePositiveInteger(metadata.qbankCacheOriginalBlockNumber || metadata.qbankFallbackOriginalBlockNumber, 0);
}

function getExplicitReviewScopeBlockNumber(attempt) {
  const scope = attempt && attempt.launchedScope && typeof attempt.launchedScope === 'object' ? attempt.launchedScope : {};
  return parseExplicitBlockNumber(scope.block)
    || parseExplicitBlockNumber(scope.selectedBlock)
    || parseExplicitBlockNumber(scope.launchedBlock)
    || parseExplicitBlockNumber(scope.testDefinitionDisplayName)
    || parseExplicitBlockNumber(scope.displayName)
    || parseExplicitBlockNumber(scope.section)
    || parseExplicitBlockNumber(scope.testDefinitionName);
}

function chooseQBankOriginalBlockRepairNumber(attempt, qbankSnapshots = []) {
  if (!attempt || getExplicitReviewScopeBlockNumber(attempt) || coercePositiveInteger(attempt && attempt.questionCount, 0) > 40) {
    return 0;
  }
  const originalCounts = countBlockNumbers((Array.isArray(qbankSnapshots) ? qbankSnapshots : []).map(getQBankOriginalBlockNumber));
  if (originalCounts.size !== 1) {
    return 0;
  }
  const originalBlockNumber = getDominantBlockNumberFromCounts(originalCounts);
  const recordedBlockNumber = getRecordedReviewBlockNumber(attempt) || getDominantAttemptMetadataBlockNumber(attempt);
  return originalBlockNumber && originalBlockNumber !== recordedBlockNumber ? originalBlockNumber : 0;
}

function rebaseProgressForReviewBlock(progress, blockNumber, questionIds, questionCount) {
  const sourceProgress = progress && typeof progress === 'object' ? progress : {};
  const byBlock = sourceProgress.byBlock && typeof sourceProgress.byBlock === 'object' ? sourceProgress.byBlock : {};
  const firstBlock = Object.values(byBlock).find((entry) => entry && typeof entry === 'object') || {};
  const total = Math.min(40, Math.max(
    coercePositiveInteger(questionCount, 0),
    coercePositiveInteger(firstBlock.total || firstBlock.itemCount || firstBlock.questionCount || firstBlock.itemsCount, 0),
    Array.isArray(questionIds) ? questionIds.length : 0
  ));
  return Object.freeze({
    ...sourceProgress,
    byBlock: Object.freeze({
      [blockNumber]: Object.freeze({
        ...firstBlock,
        blockNumber,
        total,
        questionIds: Object.freeze(Array.isArray(questionIds) ? questionIds.slice(0, total || questionIds.length) : []),
        answeredQuestionIds: Object.freeze(Array.isArray(firstBlock.answeredQuestionIds) ? firstBlock.answeredQuestionIds : []),
      }),
    }),
    overall: Object.freeze({
      ...(sourceProgress.overall && typeof sourceProgress.overall === 'object' ? sourceProgress.overall : {}),
      total,
    }),
  });
}

function rebaseAttemptForReviewBlock(attempt, blockNumber) {
  if (!attempt || !blockNumber) {
    return attempt;
  }
  const source = attempt.source && typeof attempt.source === 'object' ? attempt.source : {};
  const metadataByQuestionId = source.itemMetadataByQuestionId && typeof source.itemMetadataByQuestionId === 'object' ? source.itemMetadataByQuestionId : {};
  const timingByQuestionId = attempt.timingByQuestionId && typeof attempt.timingByQuestionId === 'object' ? attempt.timingByQuestionId : {};
  const questionIds = Array.isArray(attempt.questionIds) ? attempt.questionIds : [];
  const itemCount = Math.min(40, Math.max(questionIds.length, coercePositiveInteger(attempt.questionCount, 0), 0));
  const rebasedMetadata = Object.freeze(Object.fromEntries(questionIds.map((questionId, index) => {
    const metadata = metadataByQuestionId[questionId] && typeof metadataByQuestionId[questionId] === 'object' ? metadataByQuestionId[questionId] : {};
    const timing = timingByQuestionId[questionId] && typeof timingByQuestionId[questionId] === 'object' ? timingByQuestionId[questionId] : {};
    return [questionId, Object.freeze({
      ...metadata,
      questionId,
      blockNumber,
      itemIndex: coercePositiveInteger(metadata.itemIndex || timing.itemIndex, index + 1),
    })];
  })));
  return Object.freeze({
    ...attempt,
    launchedScope: Object.freeze({
      ...(attempt.launchedScope && typeof attempt.launchedScope === 'object' ? attempt.launchedScope : {}),
      block: String(blockNumber),
      selectedBlock: String(blockNumber),
      launchedBlock: String(blockNumber),
    }),
    blockMetadata: Object.freeze([Object.freeze({ blockNumber, itemCount, label: `Block ${blockNumber}` })]),
    timingByQuestionId: Object.freeze(Object.fromEntries(Object.entries(timingByQuestionId).map(([questionId, timing]) => [questionId, Object.freeze({
      ...(timing && typeof timing === 'object' ? timing : {}),
      blockNumber,
    })]))),
    source: Object.freeze({
      ...source,
      activeBlock: blockNumber,
      currentBlock: blockNumber,
      progress: rebaseProgressForReviewBlock(source.progress, blockNumber, questionIds, itemCount),
      itemMetadataByQuestionId: rebasedMetadata,
      reviewBlockRepair: Object.freeze({
        blockNumber,
        previousDominantMetadataBlock: getDominantAttemptMetadataBlockNumber(attempt),
        repairedAt: new Date().toISOString(),
      }),
    }),
  });
}

function chooseReviewBlockRepairNumber(attempt, ownSnapshots = []) {
  const metadataBlockNumbers = getAttemptMetadataBlockNumbers(attempt);
  const recordedBlockNumber = getRecordedReviewBlockNumber(attempt);
  if (recordedBlockNumber && metadataBlockNumbers.length === 1 && metadataBlockNumbers[0] !== recordedBlockNumber) {
    return recordedBlockNumber;
  }

  const snapshotBlockNumber = inferReviewBlockNumberFromOwnSnapshots(attempt, ownSnapshots);
  if (snapshotBlockNumber) {
    return snapshotBlockNumber;
  }
  return getReviewBlockMetadataRepairNumber(attempt, metadataBlockNumbers);
}

function prepareAttemptForReview(attempt, ownSnapshots = []) {
  const reviewBlockNumber = chooseReviewBlockRepairNumber(attempt, ownSnapshots);
  if (!reviewBlockNumber) {
    return attempt;
  }
  const metadataBlockNumbers = getAttemptMetadataBlockNumbers(attempt);
  const scope = attempt && attempt.launchedScope && typeof attempt.launchedScope === 'object' ? attempt.launchedScope : {};
  const explicitScopeBlockNumber = parseExplicitBlockNumber(scope.block) || parseExplicitBlockNumber(scope.selectedBlock) || parseExplicitBlockNumber(scope.launchedBlock) || parseExplicitBlockNumber(scope.testDefinitionDisplayName) || parseExplicitBlockNumber(scope.section);
  const alreadyRebased = metadataBlockNumbers.length === 1 && metadataBlockNumbers[0] === reviewBlockNumber
    && (!explicitScopeBlockNumber || explicitScopeBlockNumber === reviewBlockNumber);
  if (alreadyRebased) {
    return attempt;
  }
  return rebaseAttemptForReviewBlock(attempt, reviewBlockNumber);
}

function getChoiceIndexByAnswerId(choices, answerId) {
  const normalized = normalizeString(answerId, '').toLowerCase();
  if (!normalized) {
    return 0;
  }
  const list = Array.isArray(choices) ? choices : [];
  const direct = list.find((choice) => normalizeString(choice && choice.id, '').toLowerCase() === normalized);
  if (direct) {
    return Number(direct.index || list.indexOf(direct) + 1) || 0;
  }
  const optionMatch = normalized.match(/(?:^|\b)(?:option[-_\s]*)?(\d+)(?:\b|$)/);
  return optionMatch ? Number(optionMatch[1]) || 0 : 0;
}

function getSelectedChoiceIndex(snapshot) {
  const choices = Array.isArray(snapshot && snapshot.choices) ? snapshot.choices : [];
  const selectedChoice = choices.find((choice) => choice && choice.selected);
  if (selectedChoice) {
    return Number(selectedChoice.index || choices.indexOf(selectedChoice) + 1) || 0;
  }
  return getChoiceIndexByAnswerId(choices, snapshot && snapshot.selectedAnswerId);
}

function mapSelectedAnswerIdForSnapshot(sourceSnapshot, targetSnapshot) {
  const rawSelectedAnswerId = normalizeString(sourceSnapshot && sourceSnapshot.selectedAnswerId, '');
  if (!rawSelectedAnswerId) {
    return '';
  }
  const targetChoices = Array.isArray(targetSnapshot && targetSnapshot.choices) ? targetSnapshot.choices : [];
  if (targetChoices.some((choice) => normalizeString(choice && choice.id, '').toLowerCase() === rawSelectedAnswerId.toLowerCase())) {
    return rawSelectedAnswerId;
  }
  const sourceIndex = getSelectedChoiceIndex(sourceSnapshot);
  if (sourceIndex > 0) {
    const targetChoice = targetChoices.find((choice, index) => Number(choice && choice.index || index + 1) === sourceIndex);
    if (targetChoice && normalizeString(targetChoice.id, '')) {
      return normalizeString(targetChoice.id, '');
    }
  }
  return rawSelectedAnswerId;
}

function mergeSnapshotChoicesWithSelection(targetChoices, selectedAnswerId) {
  const choices = Array.isArray(targetChoices) ? targetChoices : [];
  const selectedIndex = getChoiceIndexByAnswerId(choices, selectedAnswerId);
  const normalizedSelectedAnswerId = normalizeString(selectedAnswerId, '').toLowerCase();
  return Object.freeze(choices.map((choice, index) => Object.freeze({
    ...choice,
    selected: Boolean(normalizedSelectedAnswerId && normalizeString(choice && choice.id, '').toLowerCase() === normalizedSelectedAnswerId)
      || Boolean(selectedIndex && Number(choice && choice.index || index + 1) === selectedIndex),
  })));
}

function mergeQBankSnapshotWithOwnSnapshot(qbankSnapshot, ownSnapshot = null, attempt = null) {
  if (!ownSnapshot) {
    return qbankSnapshot;
  }
  const questionId = normalizeString(qbankSnapshot && qbankSnapshot.questionId, normalizeString(ownSnapshot && ownSnapshot.questionId, ''));
  const responses = attempt && attempt.responses && typeof attempt.responses === 'object' ? attempt.responses : {};
  const responseRecorded = Object.prototype.hasOwnProperty.call(responses, questionId);
  const selectedAnswerId = responseRecorded
    ? normalizeString(responses[questionId], '')
    : (mapSelectedAnswerIdForSnapshot(ownSnapshot, qbankSnapshot) || normalizeString(qbankSnapshot && qbankSnapshot.selectedAnswerId, ''));
  return Object.freeze({
    ...qbankSnapshot,
    selectedAnswerId,
    marked: Boolean((qbankSnapshot && qbankSnapshot.marked) || (ownSnapshot && ownSnapshot.marked)),
    notes: normalizeString(ownSnapshot && ownSnapshot.notes, normalizeString(qbankSnapshot && qbankSnapshot.notes, '')),
    annotations: ownSnapshot && ownSnapshot.annotations ? ownSnapshot.annotations : (qbankSnapshot && qbankSnapshot.annotations),
    timingMs: Number(ownSnapshot && ownSnapshot.timingMs || 0) || Number(qbankSnapshot && qbankSnapshot.timingMs || 0) || 0,
    resourceUrls: Object.freeze(Array.from(new Set([...(Array.isArray(qbankSnapshot && qbankSnapshot.resourceUrls) ? qbankSnapshot.resourceUrls : []), ...(Array.isArray(ownSnapshot && ownSnapshot.resourceUrls) ? ownSnapshot.resourceUrls : [])].map((url) => normalizeString(url, '')).filter(Boolean)))),
    resourceDataByUrl: Object.freeze({
      ...((qbankSnapshot && qbankSnapshot.resourceDataByUrl && typeof qbankSnapshot.resourceDataByUrl === 'object') ? qbankSnapshot.resourceDataByUrl : {}),
      ...((ownSnapshot && ownSnapshot.resourceDataByUrl && typeof ownSnapshot.resourceDataByUrl === 'object') ? ownSnapshot.resourceDataByUrl : {}),
    }),
    choices: selectedAnswerId ? mergeSnapshotChoicesWithSelection(qbankSnapshot && qbankSnapshot.choices, selectedAnswerId) : qbankSnapshot.choices,
    snapshot: Object.freeze({
      ...((qbankSnapshot && qbankSnapshot.snapshot) || {}),
      reviewMerge: Object.freeze({
        selectedFromOwnSnapshot: Boolean(selectedAnswerId),
        ownSnapshotId: normalizeString(ownSnapshot && ownSnapshot.id, ''),
      }),
    }),
  });
}

function snapshotPositionKey(snapshot) {
  const metadata = snapshot && snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {};
  const blockNumber = Number((snapshot && snapshot.blockNumber) || metadata.blockNumber || 0) || 0;
  const itemIndex = Number((snapshot && snapshot.itemIndex) || metadata.itemIndex || 0) || 0;
  return blockNumber && itemIndex ? `${blockNumber}\u0000${itemIndex}` : '';
}

function snapshotResourceDataByUrl(snapshot) {
  return snapshot && snapshot.resourceDataByUrl && typeof snapshot.resourceDataByUrl === 'object' ? snapshot.resourceDataByUrl : {};
}

function snapshotResourceUrls(snapshot) {
  return uniqueNormalizedStrings([
    ...(Array.isArray(snapshot && snapshot.resourceUrls) ? snapshot.resourceUrls : []),
    ...extractResourceUrlsFromHtml(snapshot && snapshot.renderedHtml),
  ]);
}

function snapshotHasMissingResourceData(snapshot) {
  const resourceData = snapshotResourceDataByUrl(snapshot);
  return snapshotResourceUrls(snapshot).some((url) => {
    const absoluteUrl = normalizeResourceUrl(url, REVIEW_RESOURCE_BASE_URL);
    return !resourceData[url] && !resourceData[absoluteUrl];
  }) || /\bdata-media-id\s*=|\.mediaGallery\b/i.test(normalizeString(snapshot && snapshot.renderedHtml, ''));
}

async function hydrateSnapshotResourceData(adapterWindow, snapshot) {
  if (!snapshot || !snapshotHasMissingResourceData(snapshot)) {
    return snapshot;
  }
  const existingData = snapshotResourceDataByUrl(snapshot);
  const mediaResourceUrls = await extractMediaResourceUrlsForHtml(adapterWindow, snapshot.renderedHtml);
  const urls = uniqueNormalizedStrings([...snapshotResourceUrls(snapshot), ...mediaResourceUrls]);
  const missingUrls = urls.filter((url) => {
    const absoluteUrl = normalizeResourceUrl(url, REVIEW_RESOURCE_BASE_URL);
    return !existingData[url] && !existingData[absoluteUrl];
  });
  const fetchedData = missingUrls.length ? await fetchResourceDataByUrl(adapterWindow, missingUrls, { baseUrl: REVIEW_RESOURCE_BASE_URL }) : {};
  const resourceDataByUrl = Object.freeze({ ...existingData, ...fetchedData });
  return Object.freeze({
    ...snapshot,
    resourceUrls: Object.freeze(urls),
    resourceDataByUrl,
  });
}

async function hydrateReviewSnapshotResources(adapterWindow, snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const hydrated = [];
  for (const snapshot of list) {
    try {
      hydrated.push(await hydrateSnapshotResourceData(adapterWindow, snapshot));
    } catch (_error) {
      hydrated.push(snapshot);
    }
  }
  return Object.freeze(hydrated);
}

function mergeReviewSnapshots(qbankSnapshots, ownSnapshots, attempt = null) {
  const ownList = Array.isArray(ownSnapshots) ? ownSnapshots : [];
  const qbankList = Array.isArray(qbankSnapshots) ? qbankSnapshots : [];
  const ownByQuestionId = new Map(ownList.map((snapshot) => [normalizeString(snapshot && snapshot.questionId, ''), snapshot]));
  const ownByPosition = new Map();
  ownList.forEach((snapshot) => {
    const key = snapshotPositionKey(snapshot);
    if (key && !ownByPosition.has(key)) {
      ownByPosition.set(key, snapshot);
    }
  });
  const qbankQuestionIds = new Set(qbankList.map((snapshot) => normalizeString(snapshot && snapshot.questionId, '')).filter(Boolean));
  const qbankPositionKeys = new Set(qbankList.map(snapshotPositionKey).filter(Boolean));
  return qbankList
    .map((snapshot) => mergeQBankSnapshotWithOwnSnapshot(
      snapshot,
      ownByQuestionId.get(normalizeString(snapshot && snapshot.questionId, '')) || ownByPosition.get(snapshotPositionKey(snapshot)),
      attempt
    ))
    .concat(ownList.filter((snapshot) => !qbankQuestionIds.has(normalizeString(snapshot && snapshot.questionId, '')) && !qbankPositionKeys.has(snapshotPositionKey(snapshot))));
}

function summarizeSnapshotsForDebug(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  return Object.freeze({
    count: list.length,
    blockCounts: summarizeBlockCounts(list.map((snapshot) => Object.freeze({
      blockNumber: Number((snapshot && snapshot.blockNumber) || (snapshot && snapshot.metadata && snapshot.metadata.blockNumber) || 0),
    }))),
    qbankOriginalBlockCounts: summarizeBlockCounts(list.map((snapshot) => Object.freeze({
      blockNumber: Number(snapshot && snapshot.metadata && (snapshot.metadata.qbankCacheOriginalBlockNumber || snapshot.metadata.qbankFallbackOriginalBlockNumber) || 0),
    }))),
    itemIndexesByBlock: Object.freeze(Object.fromEntries(Object.entries(list.reduce((accumulator, snapshot) => {
      const blockNumber = Number((snapshot && snapshot.blockNumber) || (snapshot && snapshot.metadata && snapshot.metadata.blockNumber) || 0) || 0;
      const itemIndex = Number((snapshot && snapshot.itemIndex) || (snapshot && snapshot.metadata && snapshot.metadata.itemIndex) || 0) || 0;
      const key = blockNumber || 'unknown';
      if (!accumulator[key]) accumulator[key] = [];
      if (itemIndex) accumulator[key].push(itemIndex);
      return accumulator;
    }, {})).map(([blockNumber, indexes]) => [blockNumber, Object.freeze({
      min: indexes.length ? Math.min(...indexes) : 0,
      max: indexes.length ? Math.max(...indexes) : 0,
      count: indexes.length,
    })]))),
  });
}

function debugReviewLog(adapterWindow, label, payload) {
  try {
    const targetConsole = adapterWindow && adapterWindow.console ? adapterWindow.console : console;
    const logger = targetConsole.info || targetConsole.log;
    logger.call(targetConsole, '[Free120 Review Debug]', label, payload);
  } catch (_error) {}
}

function buildScoreSummaryHtml(scoreSummary) {
  const perBlock = Array.isArray(scoreSummary && scoreSummary.perBlock) ? scoreSummary.perBlock : [];
  const rows = [
    ['Overall', scoreLabel(scoreSummary)],
    ['Correct', `${Number(scoreSummary && scoreSummary.correct || 0)}`],
    ['Incorrect', `${Number(scoreSummary && scoreSummary.incorrect || 0)}`],
    ['Omitted', `${Number(scoreSummary && scoreSummary.omitted || 0)}`],
    ['Unknown', `${Number(scoreSummary && scoreSummary.unknown || 0)}`],
    ...perBlock.map((block) => [`Block ${Number(block && block.blockNumber || 0)}`, `${block && block.overallScore ? block.overallScore.label : '—'} (${block && block.overallScore ? block.overallScore.percent : 0}%)`]),
  ];
  return rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function buildStaticShell(model) {
  const firstQuestion = model.questions[0] || null;
  const firstStatus = firstQuestion ? firstQuestion.status : 'unknown';
  return `
    <div id="f120-review-root" data-review-page-version="${REVIEW_PAGE_VERSION}">
      <header class="f120-review-toolbar">
        <div>
          <h1 class="f120-review-title">Free120 Review</h1>
          <div class="f120-review-summary">${escapeHtml(scoreLabel(model.scoreSummary))} · ${model.questions.length} item${model.questions.length === 1 ? '' : 's'}</div>
        </div>
        <div class="f120-review-controls" aria-label="Review controls">
          <label>Filter
            <select id="f120-review-filter">
              <option value="all">All</option>
              <option value="correct">Correct</option>
              <option value="incorrect">Incorrect</option>
              <option value="omitted">Omitted</option>
              <option value="unknown">Unknown</option>
              <option value="marked">Marked</option>
            </select>
          </label>
          <label>Block
            <select id="f120-review-block-filter"><option value="all">All blocks</option></select>
          </label>
          <button type="button" id="f120-review-prev">Previous</button>
          <button type="button" id="f120-review-next">Next</button>
        </div>
      </header>
      <div class="f120-review-shell">
        <nav class="f120-review-leftnav" aria-label="Reviewed questions"><ol id="leftnav"></ol></nav>
        <main class="f120-review-main">
          <div class="f120-review-current-header">
            <span id="f120-review-current-label">${firstQuestion ? `Block ${escapeHtml(firstQuestion.blockNumber)} · Item ${escapeHtml(firstQuestion.itemIndex)}` : 'No review items'}</span>
            <span id="f120-review-current-status" class="f120-review-pill f120-review-pill--${escapeHtml(firstStatus)}">${firstQuestion ? `${escapeHtml(statusSymbol(firstStatus))} ${escapeHtml(firstStatus)}` : 'empty'}</span>
          </div>
          <section id="item" aria-label="Question review"><article id="content"><div id="medley"></div></article></section>
        </main>
        <aside class="f120-review-side">
          <section class="f120-review-detail-panel" aria-label="Question details">
            <h2>Score summary</h2>
            <dl class="f120-review-detail-list">${buildScoreSummaryHtml(model.scoreSummary)}</dl>
            <h2>Question details</h2>
            <dl id="f120-review-details" class="f120-review-detail-list"></dl>
            <div id="f120-review-compact" class="f120-review-compact-summary"></div>
          </section>
        </aside>
      </div>
    </div>`;
}

function buildReviewRuntimeScript(model) {
  const modelJson = safeJsonForScript(model);
  return `
(function(){
  'use strict';
  const MODEL = ${modelJson};
  const STATUS_SYMBOL = { correct: '✓', incorrect: '✕', omitted: '–', unknown: '?' };
  const OPTION_MARK = { correct: '✓', wrong: '✕', unknown: '?' };
  const state = { filter: 'all', block: 'all', currentQuestionId: MODEL.questions[0] ? MODEL.questions[0].questionId : '' };
  const DEBUG = Boolean(window.__FREE120_REVIEW_DEBUG__);

  function debugLog(label, payload) {
    if (!DEBUG) return;
    try { console.info('[Free120 Review Debug]', label, payload); } catch (_error) {}
  }
  function summarizeQuestionsForDebug(questions) {
    const counts = {};
    (Array.isArray(questions) ? questions : []).forEach((question) => {
      const block = String(question && question.blockNumber || 'unknown');
      counts[block] = (counts[block] || 0) + 1;
    });
    return { count: (Array.isArray(questions) ? questions : []).length, blockCounts: counts, first: (Array.isArray(questions) ? questions : []).slice(0, 5).map((question) => ({ questionId: question.questionId, blockNumber: question.blockNumber, itemIndex: question.itemIndex, status: question.status })) };
  }

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function el(tag, options) {
    const node = document.createElement(tag);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = String(opts.text);
    if (opts.html !== undefined) node.innerHTML = String(opts.html);
    if (opts.type) node.type = opts.type;
    if (opts.attrs) Object.entries(opts.attrs).forEach(([key, value]) => { if (value !== null && value !== undefined) node.setAttribute(key, String(value)); });
    return node;
  }
  function replaceChildren(node, children) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    (Array.isArray(children) ? children : [children]).forEach((child) => { if (child) node.appendChild(child); });
  }
  function text(value, fallback) {
    if (value === null || value === undefined) return fallback || '';
    const normalized = String(value).trim();
    return normalized || (fallback || '');
  }
  function answersMatch(left, right) {
    const l = text(left).toLowerCase();
    const r = text(right).toLowerCase();
    return Boolean(l && r && l === r);
  }
  function formatDuration(ms) {
    const value = Number(ms || 0);
    if (!Number.isFinite(value) || value <= 0) return '—';
    const seconds = Math.round(value / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes + ':' + String(seconds % 60).padStart(2, '0');
  }
  function sortedBlockNumbers() {
    return Array.from(new Set(MODEL.questions.map((question) => Number(question.blockNumber || 1)).filter(Boolean))).sort((a, b) => a - b);
  }
  function getQuestion(questionId) {
    return MODEL.questions.find((question) => question.questionId === questionId) || MODEL.questions[0] || null;
  }
  function visibleQuestions() {
    return MODEL.questions.filter((question) => {
      if (state.block !== 'all' && String(question.blockNumber) !== String(state.block)) return false;
      if (state.filter === 'all') return true;
      if (state.filter === 'marked') return Boolean(question.marked);
      return question.status === state.filter;
    });
  }
  function ensureVisibleQuestion() {
    const visible = visibleQuestions();
    if (!visible.length) {
      state.currentQuestionId = '';
      return null;
    }
    if (!visible.some((question) => question.questionId === state.currentQuestionId)) {
      state.currentQuestionId = visible[0].questionId;
    }
    return getQuestion(state.currentQuestionId);
  }
  function answerIdCandidates(answerId) {
    const value = text(answerId);
    if (!value) return [];
    const parts = [value];
    const colonTail = value.includes(':') ? value.split(':').pop() : '';
    if (colonTail) parts.push(colonTail);
    return Array.from(new Set(parts.map((part) => part.toLowerCase())));
  }
  function choiceMatches(choice, answerId) {
    const candidates = answerIdCandidates(answerId);
    if (!candidates.length) return false;
    const id = text(choice && choice.id).toLowerCase();
    const index = String(choice && choice.index || '').toLowerCase();
    return candidates.includes(id) || candidates.includes(index);
  }
  function rowInputAnswerId(input, row, index) {
    if (!input) return 'option-' + (index + 1);
    const value = text(input.getAttribute('value'));
    const id = text(input.getAttribute('id'));
    const name = text(input.getAttribute('name'));
    return value || id || (name && value ? name + ':' + value : '') || row.getAttribute('data-option-id') || 'option-' + (index + 1);
  }
  function rowMatchesAnswer(row, question, answerId, index) {
    const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
    const rowId = rowInputAnswerId(input, row, index);
    if (answerIdCandidates(answerId).includes(String(rowId).toLowerCase())) return true;
    const choice = (question.snapshot.choices || [])[index];
    return choiceMatches(choice, answerId);
  }
  function sanitizeSnapshotFragment(root) {
    qsa('script, iframe, object, embed, link[rel="import"]', root).forEach((node) => node.remove());
    qsa('video, audio, source, track', root).forEach((node) => {
      node.removeAttribute('src');
      node.removeAttribute('poster');
      node.removeAttribute('autoplay');
      node.removeAttribute('preload');
    });
    qsa('*', root).forEach((node) => {
      Array.from(node.attributes || []).forEach((attribute) => {
        const name = attribute.name;
        const value = text(attribute.value);
        if (/^on/i.test(name) || ['ng-click', 'data-ng-click'].includes(name)) {
          node.removeAttribute(name);
          return;
        }
        if (['href', 'src', 'xlink:href', 'formaction'].includes(name.toLowerCase()) && /^javascript:/i.test(value)) {
          node.removeAttribute(name);
        }
      });
    });
  }
  function disableInteractiveControls(root) {
    qsa('input, button, textarea, select', root).forEach((node) => {
      node.disabled = true;
      node.setAttribute('aria-disabled', 'true');
    });
    qsa('a[href]', root).forEach((node) => {
      node.removeAttribute('href');
      node.setAttribute('role', 'link');
      node.setAttribute('aria-disabled', 'true');
    });
    qsa('[onclick], [ng-click], [data-ng-click]', root).forEach((node) => {
      node.removeAttribute('onclick');
      node.removeAttribute('ng-click');
      node.removeAttribute('data-ng-click');
    });
  }
  function resolveReviewUrl(url) {
    const value = text(url);
    if (!value || /^(data|blob):/i.test(value)) return value;
    try { return new URL(value, document.baseURI).href; } catch (_error) { return value; }
  }
  function getCachedResourceDataUrl(question, url) {
    const map = (question && question.snapshot && question.snapshot.resourceDataByUrl) || {};
    const value = text(url);
    if (!value || !map || typeof map !== 'object') return '';
    return text(map[value] || map[resolveReviewUrl(value)] || '');
  }
  function getReviewMediaUrl(question, url) {
    return getCachedResourceDataUrl(question, url) || text(url);
  }
  function copySnapshotMediaSource(node) {
    if (!node || node.getAttribute('src')) return;
    const source = text(node.getAttribute('data-ng-src') || node.getAttribute('ng-src') || node.getAttribute('data-src'));
    if (source && !source.includes('{{')) {
      node.setAttribute('src', source);
    }
  }
  function applyCachedResourceData(root, question) {
    qsa('img', root).forEach((node) => {
      copySnapshotMediaSource(node);
      const value = text(node.getAttribute('src'));
      const dataUrl = getCachedResourceDataUrl(question, value);
      if (dataUrl) node.setAttribute('src', dataUrl);
    });
    qsa('video, audio, source, track', root).forEach((node) => {
      node.removeAttribute('src');
      node.removeAttribute('poster');
      node.removeAttribute('autoplay');
      node.removeAttribute('preload');
    });
    qsa('[style*="url("]', root).forEach((node) => {
      const style = text(node.getAttribute('style'));
      if (!style) return;
      const rewritten = style.replace(/url\\((['"]?)([^'")]+)['"]?\\)/gi, (match, _quote, url) => {
        const dataUrl = getCachedResourceDataUrl(question, url);
        return dataUrl ? 'url("' + dataUrl + '")' : match;
      });
      if (rewritten !== style) node.setAttribute('style', rewritten);
    });
  }
  function createNativeMediaElement(_tag, src, label) {
    const wrapper = el('div', { className: 'f120-review-native-media-entry' });
    if (label) wrapper.appendChild(el('div', { className: 'f120-review-native-media-label', text: label }));
    wrapper.appendChild(createAudioPlayer(src, 'Clip', 0));
    wrapper.appendChild(createDownloadLink(src, 'Download clip', 'free120-review-media.webm'));
    return wrapper;
  }
  function inferMediaMimeType(url, tag) {
    const value = text(url).toLowerCase();
    const dataMime = (value.match(/^data:([^;,]+)/) || [])[1];
    if (dataMime) return dataMime;
    if (/webm/.test(value)) return 'video/webm';
    if (/mp4|m4v/.test(value)) return 'video/mp4';
    if (/mp3/.test(value)) return 'audio/mpeg';
    if (/wav/.test(value)) return 'audio/wav';
    if (/ogg|oga/.test(value)) return 'audio/ogg';
    return tag === 'audio' ? 'audio/webm' : 'video/webm';
  }
  function isImageUrl(url) { return /\\.(?:png|jpe?g|gif|webp|svg)(?:\\?|$)/i.test(text(url)); }
  function isVideoUrl(url) { return /\\.(?:webm|mp4|m4v|mov)(?:\\?|$)/i.test(text(url)); }
  function isAudioUrl(url) { return /\\.(?:mp3|wav|ogg|oga)(?:\\?|$)/i.test(text(url)); }
  let sharedAudioContext = null;
  let activeAudioSource = null;
  function createDownloadLink(src, label, fileName) {
    const link = el('a', { className: 'f120-review-media-download', attrs: { href: src, download: fileName || 'review-media.webm' }, text: label || 'Open/download media clip' });
    return link;
  }
  function decodeDataUrlBytes(dataUrl) {
    const value = text(dataUrl);
    const commaIndex = value.indexOf(',');
    if (!/^data:/i.test(value) || commaIndex < 0) return null;
    const header = value.slice(0, commaIndex);
    const payload = value.slice(commaIndex + 1);
    const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  function getAudioContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') sharedAudioContext = new Context();
    return sharedAudioContext;
  }
  function stopActiveAudio() {
    if (activeAudioSource) {
      try { activeAudioSource.stop(0); } catch (_error) {}
      try { activeAudioSource.disconnect(); } catch (_error) {}
      activeAudioSource = null;
    }
    qsa('.f120-review-audio-player.is-playing').forEach((node) => node.classList.remove('is-playing'));
  }
  async function playDataUrlAudio(player, src) {
    const status = qs('.f120-review-audio-status', player);
    const playButton = qs('.f120-review-audio-play', player);
    const stopButton = qs('.f120-review-audio-stop', player);
    const bytes = decodeDataUrlBytes(src);
    const context = getAudioContext();
    if (!bytes || !context) {
      if (status) status.textContent = 'Playback unavailable; use download link.';
      return;
    }
    try {
      if (status) status.textContent = 'Decoding…';
      if (context.state === 'suspended') await context.resume();
      const buffer = await context.decodeAudioData(bytes.buffer.slice(0));
      stopActiveAudio();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (activeAudioSource === source) activeAudioSource = null;
        player.classList.remove('is-playing');
        if (status) status.textContent = 'Ready';
        if (playButton) playButton.disabled = false;
        if (stopButton) stopButton.disabled = true;
      };
      activeAudioSource = source;
      source.start(0);
      player.classList.add('is-playing');
      if (status) status.textContent = 'Playing';
      if (playButton) playButton.disabled = true;
      if (stopButton) stopButton.disabled = false;
    } catch (_error) {
      if (status) status.textContent = 'Playback failed; use download link.';
      if (playButton) playButton.disabled = false;
      if (stopButton) stopButton.disabled = true;
    }
  }
  function createAudioPlayer(src, label, index) {
    const player = el('div', { className: 'f120-review-audio-player' });
    player.setAttribute('data-audio-src', text(src));
    player.setAttribute('data-selected-media-index', String(index + 1));
    const playButton = el('button', { className: 'f120-review-audio-play', attrs: { type: 'button' }, text: 'Play ' + text(label, 'clip') });
    const stopButton = el('button', { className: 'f120-review-audio-stop', attrs: { type: 'button', disabled: 'disabled' }, text: 'Stop' });
    const status = el('span', { className: 'f120-review-audio-status', text: 'Ready' });
    playButton.addEventListener('click', () => { void playDataUrlAudio(player, text(player.getAttribute('data-audio-src'))); });
    stopButton.addEventListener('click', () => {
      stopActiveAudio();
      status.textContent = 'Stopped';
      playButton.disabled = false;
      stopButton.disabled = true;
    });
    player.append(playButton, stopButton, status);
    return player;
  }
  function getPositionNumber(index) {
    return index < 4 ? index + 1 : index;
  }
  function getPositionLabel(index) {
    if (index === 3) return 'Position 4 (diaphragm)';
    if (index === 4) return 'Position 4 (bell)';
    return 'Position ' + getPositionNumber(index);
  }
  function setMediaSource(mediaEl, src, index, wrapper) {
    if (mediaEl) {
      mediaEl.setAttribute('data-audio-src', text(src));
      mediaEl.setAttribute('data-selected-media-index', String(index + 1));
      mediaEl.setAttribute('data-selected-media-type', inferMediaMimeType(src, 'video'));
      const playButton = qs('.f120-review-audio-play', mediaEl);
      const stopButton = qs('.f120-review-audio-stop', mediaEl);
      const status = qs('.f120-review-audio-status', mediaEl);
      if (playButton) {
        playButton.textContent = 'Play ' + getPositionLabel(index);
        playButton.disabled = false;
      }
      if (stopButton) stopButton.disabled = true;
      if (status) status.textContent = 'Ready';
      stopActiveAudio();
    }
    if (!wrapper) return;
    const slot = wrapper.querySelector('.f120-review-media-download-slot');
    if (slot) {
      replaceChildren(slot, [createDownloadLink(src, 'Download ' + getPositionLabel(index) + ' clip', 'free120-review-position-' + (index + 1) + '.webm')]);
    }
  }
  function getPlayableReviewMediaUrl(question, url) {
    return getReviewMediaUrl(question, url);
  }
  function getSnapshotMediaInteractions(question) {
    const entries = question && question.snapshot && question.snapshot.metadata && Array.isArray(question.snapshot.metadata.mediaInteractions)
      ? question.snapshot.metadata.mediaInteractions
      : [];
    const seen = new Set();
    return entries.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const key = [entry.mediaId || '', entry.src || '', entry.image || '', entry.coords || '', entry.label || ''].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(entry.src || entry.image || entry.coords || entry.label);
    });
  }
  function parseHotspotCoords(coords) {
    const numbers = text(coords).split(',').map((part) => Number(part.trim())).filter((value) => Number.isFinite(value));
    if (numbers.length >= 3) return { x: numbers[0], y: numbers[1], r: Math.max(6, numbers[2]) };
    if (numbers.length >= 2) return { x: numbers[0], y: numbers[1], r: 10 };
    return null;
  }
  function fallbackHotspotCoords(index) {
    const points = [
      { x: 86, y: 94, r: 15 },
      { x: 128, y: 90, r: 15 },
      { x: 133, y: 141, r: 15 },
      { x: 174, y: 174, r: 15 },
      { x: 174, y: 174, r: 15 },
      { x: 81, y: 17, r: 15 },
      { x: 137, y: 17, r: 15 },
    ];
    return points[index] || { x: 18 + (index % 7) * 30, y: 18, r: 10 };
  }
  function setSelectedHotspot(wrapper, index) {
    wrapper.querySelectorAll('.f120-review-hotspot-button').forEach((node) => node.classList.toggle('is-selected', Number(node.getAttribute('data-index')) === index + 1));
    wrapper.querySelectorAll('.f120-review-hotspot-marker').forEach((node) => node.classList.toggle('is-selected', Number(node.getAttribute('data-index')) === index + 1));
  }
  function createHotspotButton(interaction, index, mediaEl, diagram) {
    const button = el('button', { className: 'f120-review-hotspot-button', attrs: { type: 'button' }, text: text(interaction.label, getPositionLabel(index)) });
    button.setAttribute('data-index', String(index + 1));
    if (interaction.coords) button.setAttribute('data-coords', text(interaction.coords));
    button.addEventListener('click', () => {
      const src = getPlayableReviewMediaUrl(diagram.question, interaction.src);
      setMediaSource(mediaEl, src, index, diagram);
      setSelectedHotspot(diagram, index);
    });
    return button;
  }
  function createHotspotMarker(interaction, index, mediaEl, wrapper) {
    const coords = parseHotspotCoords(interaction.coords);
    const marker = el('button', { className: 'f120-review-hotspot-marker', attrs: { type: 'button', title: text(interaction.label, getPositionLabel(index)) }, text: String(getPositionNumber(index)) });
    marker.setAttribute('data-index', String(index + 1));
    const markerCoords = coords || fallbackHotspotCoords(index);
    marker.style.left = markerCoords.x + 'px';
    marker.style.top = markerCoords.y + 'px';
    marker.style.width = Math.max(18, markerCoords.r * 2) + 'px';
    marker.style.height = Math.max(18, markerCoords.r * 2) + 'px';
    marker.addEventListener('click', () => {
      const src = getPlayableReviewMediaUrl(wrapper.question, interaction.src);
      setMediaSource(mediaEl, src, index, wrapper);
      setSelectedHotspot(wrapper, index);
    });
    return marker;
  }
  function createInteractiveMediaFallback(question, interactions) {
    const wrapper = el('div', { className: 'f120-review-native-media-fallback f120-review-native-media-fallback--interactive' });
    wrapper.question = question;
    const imageUrl = interactions.map((entry) => entry.image).find(Boolean) || interactions.map((entry) => entry.src).find(isImageUrl);
    const playable = interactions.filter((entry) => entry.src && (isVideoUrl(entry.src) || isAudioUrl(entry.src)));
    const first = playable[0] || null;
    const media = first ? createAudioPlayer(getPlayableReviewMediaUrl(question, first.src), 'Position 1', 0) : null;
    const downloadSlot = first ? el('div', { className: 'f120-review-media-download-slot' }) : null;
    if (imageUrl) {
      const diagram = el('div', { className: 'f120-review-hotspot-diagram' });
      diagram.appendChild(el('img', { attrs: { src: getReviewMediaUrl(question, imageUrl), alt: 'Review media diagram' } }));
      playable.forEach((entry, index) => diagram.appendChild(createHotspotMarker(entry, index, media, wrapper)));
      wrapper.appendChild(diagram);
    }
    if (media) {
      wrapper.appendChild(media);
      if (downloadSlot) wrapper.appendChild(downloadSlot);
      setMediaSource(media, getPlayableReviewMediaUrl(question, first.src), 0, wrapper);
    }
    if (playable.length > 1) {
      const controls = el('div', { className: 'f120-review-hotspot-controls' });
      playable.forEach((entry, index) => controls.appendChild(createHotspotButton(entry, index, media, wrapper)));
      wrapper.appendChild(controls);
      setSelectedHotspot(wrapper, 0);
    }
    return wrapper;
  }
  function renderNativeMediaFallback(root, question) {
    const urls = (question && question.snapshot && Array.isArray(question.snapshot.resourceUrls)) ? question.snapshot.resourceUrls : [];
    const interactions = getSnapshotMediaInteractions(question);
    if (!urls.length && !interactions.length) return;
    const imageUrls = urls.filter(isImageUrl);
    const videoUrls = urls.filter(isVideoUrl);
    const audioUrls = urls.filter(isAudioUrl);
    if (!imageUrls.length && !videoUrls.length && !audioUrls.length && !interactions.length) return;
    qsa('.NBMediaPlayer', root).forEach((container) => {
      if (container.querySelector('.f120-review-native-media-fallback')) return;
      if (interactions.length) {
        container.appendChild(createInteractiveMediaFallback(question, interactions));
        return;
      }
      if (container.querySelector('video, audio, img')) return;
      const fallback = el('div', { className: 'f120-review-native-media-fallback' });
      imageUrls.slice(0, 1).forEach((url) => fallback.appendChild(el('img', { attrs: { src: getReviewMediaUrl(question, url), alt: 'Review media diagram' } })));
      videoUrls.slice(0, 12).forEach((url, index) => fallback.appendChild(createNativeMediaElement('video', getReviewMediaUrl(question, url), 'Media clip ' + (index + 1))));
      audioUrls.slice(0, 12).forEach((url, index) => fallback.appendChild(createNativeMediaElement('audio', getReviewMediaUrl(question, url), 'Audio clip ' + (index + 1))));
      container.appendChild(fallback);
    });
  }
  function normalizeSnapshotMedia(root) {
    qsa('img, video, audio, source, track', root).forEach(copySnapshotMediaSource);
    qsa('[id^="inline-"]', root).forEach((node) => {
      const suffix = text(node.id).replace(/^inline-/, '');
      if (suffix && qsa('[id^="media-"]', root).some((candidate) => text(candidate.id) === 'media-' + suffix)) {
        node.classList.add('f120-review-media-inline-duplicate');
      }
    });
    qsa('video, audio', root).forEach((node) => {
      qsa('source', node).forEach((source) => source.removeAttribute('src'));
      node.removeAttribute('src');
      node.removeAttribute('poster');
      node.removeAttribute('autoplay');
      node.setAttribute('preload', 'none');
      node.classList.add('f120-review-media-disabled-by-csp');
    });
    qsa('.NBMediaPlayer, .media-player, .media.magnify, [id^="media-"], [id^="inline-"]', root).forEach((node) => {
      node.classList.add('f120-review-media-ready');
    });
  }
  function insertStatusMarker(row, kind, symbol) {
    const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
    const marker = el('span', { className: 'f120-review-option-status f120-review-option-status--' + kind, text: symbol || '' });
    const visibleSpan = row.querySelector('span, label');
    if (input && input.parentNode === row) {
      if (visibleSpan && visibleSpan.parentNode === row) row.insertBefore(marker, visibleSpan);
      else input.insertAdjacentElement('afterend', marker);
    } else {
      row.insertBefore(marker, row.firstChild);
    }
  }
  function decorateOptionRows(root, question) {
    const rows = qsa('ol.options > li.stContext, li.stContext', root);
    rows.forEach((row, index) => {
      const isCorrect = rowMatchesAnswer(row, question, question.correctAnswerId, index);
      const isSelected = rowMatchesAnswer(row, question, question.selectedAnswerId, index);
      let kind = 'empty';
      let symbol = '';
      if (isCorrect && question.correctAnswerId) {
        kind = 'correct';
        symbol = OPTION_MARK.correct;
        row.classList.add('f120-review-option--correct');
      } else if (isSelected && question.status === 'incorrect') {
        kind = 'wrong';
        symbol = OPTION_MARK.wrong;
        row.classList.add('f120-review-option--selected-wrong');
      } else if (isSelected && question.status === 'unknown') {
        kind = 'unknown';
        symbol = OPTION_MARK.unknown;
        row.classList.add('f120-review-option--selected-unknown');
      }
      insertStatusMarker(row, kind, symbol);
      const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
      if (input) input.checked = Boolean(isSelected);
    });
  }
  function insertTimeSpent(root, question) {
    const time = el('div', { className: 'f120-review-time-spent', text: 'Time spent: ' + formatDuration(question.timingMs) });
    const options = qs('ol.options', root);
    if (options && options.parentNode) {
      options.insertAdjacentElement('afterend', time);
      return;
    }
    const answerBox = qs('div[id$="_div"].NBOptionListComp.answerbox, .NBOptionListComp.answerbox, .answerbox', root);
    if (answerBox && answerBox.parentNode) {
      answerBox.insertAdjacentElement('afterend', time);
      return;
    }
    root.appendChild(time);
  }
  function renderFallbackQuestion(question) {
    const wrapper = el('div', { className: 'f120-review-item-unavailable' });
    wrapper.appendChild(el('p', { text: 'Stored rendered item snapshot unavailable. Compact review data shown below.' }));
    const list = el('dl', { className: 'f120-review-detail-list' });
    appendDetail(list, 'Selected', question.selectedAnswerId || '—');
    appendDetail(list, 'Correct', question.correctAnswerId || '—');
    wrapper.appendChild(list);
    return wrapper;
  }
  function renderQuestion(question) {
    const medley = qs('#medley');
    if (!medley) return;
    replaceChildren(medley, []);
    if (!question) {
      medley.appendChild(el('div', { className: 'f120-review-item-unavailable', text: 'No questions match current filters.' }));
      return;
    }
    const html = text(question.snapshot && question.snapshot.renderedHtml);
    let root;
    if (html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      sanitizeSnapshotFragment(template.content);
      const firstElement = Array.from(template.content.childNodes).find((node) => node.nodeType === 1);
      root = firstElement || el('div');
      medley.appendChild(template.content);
      root = medley.querySelector('div[id^="item"], .NBExposition, .answerbox') || medley.firstElementChild || medley;
    } else {
      medley.appendChild(renderFallbackQuestion(question));
      root = medley.firstElementChild || medley;
    }
    disableInteractiveControls(medley);
    renderNativeMediaFallback(medley, question);
    normalizeSnapshotMedia(medley);
    applyCachedResourceData(medley, question);
    qsa('video, audio', medley).forEach((node) => {
      node.removeAttribute('src');
      qsa('source', node).forEach((source) => source.removeAttribute('src'));
    });
    decorateOptionRows(medley, question);
    insertTimeSpent(root && root.nodeType === 1 ? root : medley, question);
  }
  function appendDetail(container, label, value) {
    container.appendChild(el('dt', { text: label }));
    container.appendChild(el('dd', { text: value === undefined || value === null || value === '' ? '—' : value }));
  }
  function renderDetails(question) {
    const details = qs('#f120-review-details');
    const compact = qs('#f120-review-compact');
    replaceChildren(details, []);
    replaceChildren(compact, []);
    if (!question) {
      compact.appendChild(el('div', { className: 'f120-review-empty', text: 'No matching item.' }));
      return;
    }
    appendDetail(details, 'Status', question.status);
    appendDetail(details, 'Selected', question.selectedAnswerId || '—');
    appendDetail(details, 'Correct', question.correctAnswerId || '—');
    appendDetail(details, 'Marked', question.marked ? 'yes' : 'no');
    appendDetail(details, 'Time', formatDuration(question.timingMs));
    const annotations = question.annotations || {};
    const highlights = Array.isArray(annotations.highlights) ? annotations.highlights : [];
    const strikeouts = Array.isArray(annotations.strikeouts) ? annotations.strikeouts : [];
    appendDetail(details, 'Highlights', highlights.length ? String(highlights.length) : '—');
    appendDetail(details, 'Strikeouts', strikeouts.length ? String(strikeouts.length) : '—');
    appendDetail(details, 'Question id', question.questionId);
    if (question.notes) {
      compact.appendChild(el('div', { text: 'Notes: ' + question.notes }));
    }
    if (highlights.length) {
      compact.appendChild(el('strong', { text: 'Highlights' }));
      highlights.slice(0, 5).forEach((entry) => compact.appendChild(el('div', { text: text(entry.text || entry.html).slice(0, 180) })));
    }
    if (strikeouts.length) {
      compact.appendChild(el('strong', { text: 'Strikeouts' }));
      strikeouts.slice(0, 5).forEach((entry) => compact.appendChild(el('div', { text: text(entry.text || entry.html).slice(0, 180) })));
    }
    const timeline = Array.isArray(question.answerTimeline) ? question.answerTimeline : [];
    if (timeline.length) {
      compact.appendChild(el('strong', { text: 'Answer changes' }));
      timeline.slice(-8).forEach((entry) => compact.appendChild(el('div', { text: (entry.changedAt || '') + ' · ' + (entry.fromAnswerId || '—') + ' → ' + (entry.toAnswerId || '—') })));
    } else {
      compact.appendChild(el('div', { className: 'f120-review-empty', text: 'No answer-change timeline.' }));
    }
  }
  function renderHeader(question) {
    const label = qs('#f120-review-current-label');
    const status = qs('#f120-review-current-status');
    if (!question) {
      label.textContent = 'No review items';
      status.className = 'f120-review-pill f120-review-pill--unknown';
      status.textContent = 'empty';
      return;
    }
    label.textContent = 'Block ' + question.blockNumber + ' · Item ' + question.itemIndex;
    status.className = 'f120-review-pill f120-review-pill--' + question.status;
    status.textContent = (STATUS_SYMBOL[question.status] || '•') + ' ' + question.status;
  }
  function renderNav() {
    const nav = qs('ol#leftnav');
    const visible = visibleQuestions();
    replaceChildren(nav, []);
    visible.forEach((question) => {
      const row = el('li', { attrs: { tabindex: '0', role: 'button', 'data-question-id': question.questionId, 'aria-label': 'Review item ' + question.itemIndex + ' ' + question.status } });
      if (question.questionId === state.currentQuestionId) row.classList.add('currentitem');
      row.appendChild(el('span', { className: 'ans_status ' + (question.selectedAnswerId ? 'f120-review-answered' : ''), attrs: { 'aria-hidden': 'true' } }));
      row.appendChild(el('span', { className: 'f120-review-nav-status f120-review-nav-status--' + question.status, text: STATUS_SYMBOL[question.status] || '•' }));
      row.appendChild(el('span', { className: 'index', text: question.itemIndex }));
      row.appendChild(el('span', { className: 'hoverNote', text: question.marked ? '★' : '' }));
      row.addEventListener('click', () => { debugLog('nav-click', { questionId: question.questionId, blockNumber: question.blockNumber, itemIndex: question.itemIndex }); state.currentQuestionId = question.questionId; render(); });
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.currentQuestionId = question.questionId; render(); } });
      nav.appendChild(row);
    });
  }
  function renderBlockOptions() {
    const select = qs('#f120-review-block-filter');
    const previous = select.value || 'all';
    replaceChildren(select, [el('option', { text: 'All blocks', attrs: { value: 'all' } })]);
    sortedBlockNumbers().forEach((blockNumber) => select.appendChild(el('option', { text: 'Block ' + blockNumber, attrs: { value: blockNumber } })));
    select.value = Array.from(select.options).some((option) => option.value === previous) ? previous : 'all';
    state.block = select.value;
    debugLog('block-options', { options: Array.from(select.options).map((option) => option.value), selected: state.block, modelBlocks: sortedBlockNumbers() });
  }
  function move(delta) {
    const visible = visibleQuestions();
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex((question) => question.questionId === state.currentQuestionId));
    const nextIndex = Math.min(visible.length - 1, Math.max(0, index + delta));
    state.currentQuestionId = visible[nextIndex].questionId;
    debugLog('move', { delta, currentQuestionId: state.currentQuestionId, visible: summarizeQuestionsForDebug(visible) });
    render();
  }
  function render() {
    const beforeQuestionId = state.currentQuestionId;
    const question = ensureVisibleQuestion();
    renderNav();
    renderHeader(question);
    renderQuestion(question);
    renderDetails(question);
    const visible = visibleQuestions();
    const index = question ? visible.findIndex((item) => item.questionId === question.questionId) : -1;
    debugLog('render', { state: { ...state }, beforeQuestionId, ensuredQuestionId: question && question.questionId, current: question ? { questionId: question.questionId, blockNumber: question.blockNumber, itemIndex: question.itemIndex, status: question.status } : null, index, visible: summarizeQuestionsForDebug(visible) });
    qs('#f120-review-prev').disabled = index <= 0;
    qs('#f120-review-next').disabled = index < 0 || index >= visible.length - 1;
  }
  function hydrateStoredShell() {
    const shellHtml = text(MODEL.shell && MODEL.shell.itemShellHtml);
    if (!shellHtml) return;
    const template = document.createElement('template');
    template.innerHTML = shellHtml;
    sanitizeSnapshotFragment(template.content);
    const storedSection = template.content.querySelector('section#item');
    const storedArticle = template.content.querySelector('article#content');
    const targetSection = qs('section#item');
    if (storedSection && targetSection) {
      const medley = storedSection.querySelector('#medley') || storedSection.querySelector('div[id="medley"]');
      if (medley) replaceChildren(medley, []);
      disableInteractiveControls(storedSection);
      targetSection.replaceWith(storedSection);
      return;
    }
    if (storedArticle && targetSection) {
      const medley = storedArticle.querySelector('#medley') || storedArticle.querySelector('div[id="medley"]');
      if (medley) replaceChildren(medley, []);
      disableInteractiveControls(storedArticle);
      replaceChildren(targetSection, [storedArticle]);
    }
  }
  function attachControls() {
    hydrateStoredShell();
    renderBlockOptions();
    debugLog('runtime-start', { model: summarizeQuestionsForDebug(MODEL.questions), diagnostics: window.__FREE120_REVIEW_DEBUG__ || null });
    qs('#f120-review-filter').addEventListener('change', (event) => { state.filter = event.target.value; debugLog('filter-change', { filter: state.filter }); render(); });
    qs('#f120-review-block-filter').addEventListener('change', (event) => { state.block = event.target.value; debugLog('block-change', { block: state.block }); render(); });
    qs('#f120-review-prev').addEventListener('click', () => move(-1));
    qs('#f120-review-next').addEventListener('click', () => move(1));
    document.addEventListener('keydown', (event) => {
      if (event.target && ['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    });
  }
  attachControls();
  render();
})();`;
}

function buildReviewHtml(attempt, snapshots = [], options = {}) {
  const model = buildReviewModel(attempt, snapshots);
  const debugDiagnostics = options.debugDiagnostics ? Object.freeze({
    openedAt: new Date().toISOString(),
    attemptId: normalizeString(attempt && attempt.id, ''),
    inputAttempt: summarizeAttemptBlocksForDebug(attempt),
    reviewBlockRepair: attempt && attempt.source && attempt.source.reviewBlockRepair ? Object.freeze({ ...attempt.source.reviewBlockRepair }) : null,
    inputSnapshots: summarizeSnapshotsForDebug(snapshots),
    model: Object.freeze({
      questionCount: model.questions.length,
      questionIds: summarizeQuestionIds(model.questions.map((question) => question.questionId)),
      blockCounts: summarizeBlockCounts(model.questions),
      perBlock: Object.freeze((Array.isArray(model.scoreSummary && model.scoreSummary.perBlock) ? model.scoreSummary.perBlock : []).map((block) => Object.freeze({
        blockNumber: Number(block && block.blockNumber || 0),
        total: Number(block && block.total || 0),
        answered: Number(block && block.answered || 0),
        correct: Number(block && block.correct || 0),
        omitted: Number(block && block.omitted || 0),
      }))),
      firstQuestions: Object.freeze(model.questions.slice(0, 8).map((question) => Object.freeze({
        questionId: question.questionId,
        blockNumber: question.blockNumber,
        itemIndex: question.itemIndex,
        status: question.status,
        hasRenderedHtml: Boolean(question.snapshot && question.snapshot.renderedHtml),
        renderedHtmlLength: question.snapshot && question.snapshot.renderedHtml ? question.snapshot.renderedHtml.length : 0,
        snapshotBlockNumber: question.snapshot && question.snapshot.metadata ? question.snapshot.metadata.blockNumber : 0,
        qbankOriginalBlockNumber: question.snapshot && question.snapshot.metadata ? (question.snapshot.metadata.qbankCacheOriginalBlockNumber || question.snapshot.metadata.qbankFallbackOriginalBlockNumber || 0) : 0,
        qbankOriginalQuestionId: question.snapshot && question.snapshot.metadata ? (question.snapshot.metadata.qbankCacheOriginalQuestionId || question.snapshot.metadata.qbankFallbackOriginalQuestionId || '') : '',
        qbankMatchSource: question.snapshot && question.snapshot.metadata ? question.snapshot.metadata.qbankCacheMatchSource || '' : '',
      }))),
    }),
  }) : null;
  const title = `Free120 Review${model.attempt.id ? ` · ${model.attempt.id}` : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <base href="${escapeHtml(REVIEW_RESOURCE_BASE_URL)}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; img-src 'self' data: https://orientation.nbme.org; media-src 'self' data: https://orientation.nbme.org; style-src 'unsafe-inline'; script-src 'unsafe-inline' data:">
  <title>${escapeHtml(title)}</title>
  <style>${REVIEW_PAGE_CSS}</style>
</head>
<body>
  ${buildStaticShell(model)}
  <script>${debugDiagnostics ? `window.__FREE120_REVIEW_DEBUG__ = ${safeJsonForScript(debugDiagnostics)};\nconsole.info('[Free120 Review Debug]', 'diagnostics', window.__FREE120_REVIEW_DEBUG__);\n` : ''}${buildReviewRuntimeScript(model)}</script>
</body>
</html>`;
}

function createReviewBlob(attempt, snapshots = [], adapterWindow = window, options = {}) {
  const html = buildReviewHtml(attempt, snapshots, options);
  const BlobCtor = adapterWindow.Blob || Blob;
  return new BlobCtor([html], { type: 'text/html;charset=utf-8' });
}

function createReviewBlobUrl(attempt, snapshots = [], adapterWindow = window, options = {}) {
  const URLObject = adapterWindow.URL || URL;
  return URLObject.createObjectURL(createReviewBlob(attempt, snapshots, adapterWindow, options));
}

async function loadQBankFallbackSnapshots(storage, attempt, ownSnapshots) {
  return loadQBankSnapshotsForAttempt(storage, attempt, ownSnapshots, { onlyMissing: true });
}

async function openReviewTab(options = {}) {
  const adapterWindow = options.window || window;
  const storage = options.storage;
  const attemptId = normalizeString(options.attemptId || (options.attempt && options.attempt.id), '');
  if (!storage || typeof storage.getAttempt !== 'function' || typeof storage.listQuestionSnapshots !== 'function') {
    throw new Error('Review launcher requires storage with attempt and snapshot readers.');
  }
  if (!attemptId) {
    throw new Error('Review launcher requires attempt id.');
  }

  const opened = typeof adapterWindow.open === 'function' ? adapterWindow.open('about:blank', '_blank') : null;
  if (!opened) {
    throw new Error('Review tab popup was blocked. Allow popups for orientation.nbme.org and retry.');
  }
  try {
    opened.opener = null;
  } catch (_error) {}

  try {
    const attempt = options.attempt || await storage.getAttempt(attemptId);
    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }
    const ownSnapshots = await storage.listQuestionSnapshots(attemptId);
    const reviewAttempt = prepareAttemptForReview(attempt, ownSnapshots);
    let qbankSnapshots = await loadQBankSnapshotsForAttempt(storage, reviewAttempt, ownSnapshots);
    const qbankOriginalRepairBlockNumber = chooseQBankOriginalBlockRepairNumber(reviewAttempt, qbankSnapshots);
    const effectiveReviewAttempt = qbankOriginalRepairBlockNumber ? rebaseAttemptForReviewBlock(reviewAttempt, qbankOriginalRepairBlockNumber) : reviewAttempt;
    if (qbankOriginalRepairBlockNumber) {
      qbankSnapshots = await loadQBankSnapshotsForAttempt(storage, effectiveReviewAttempt, ownSnapshots);
    }
    qbankSnapshots = await hydrateReviewSnapshotResources(adapterWindow, qbankSnapshots);
    const hydratedOwnSnapshots = await hydrateReviewSnapshotResources(adapterWindow, ownSnapshots);
    const snapshots = mergeReviewSnapshots(qbankSnapshots, hydratedOwnSnapshots, effectiveReviewAttempt);
    const debugDiagnostics = Boolean(options.debugDiagnostics || options.debugReview);
    if (debugDiagnostics) {
      debugReviewLog(adapterWindow, 'openReviewTab inputs', Object.freeze({
        debugDiagnostics,
        attemptId,
        attempt: summarizeAttemptBlocksForDebug(effectiveReviewAttempt),
        originalAttempt: summarizeAttemptBlocksForDebug(attempt),
        ownSnapshots: summarizeSnapshotsForDebug(hydratedOwnSnapshots),
        qbankOriginalRepairBlockNumber,
        qbankSnapshots: summarizeSnapshotsForDebug(qbankSnapshots),
        mergedSnapshots: summarizeSnapshotsForDebug(snapshots),
        answers: Object.freeze({
          responseKeys: Object.keys((effectiveReviewAttempt && effectiveReviewAttempt.responses && typeof effectiveReviewAttempt.responses === 'object') ? effectiveReviewAttempt.responses : {}).length,
          snapshotSelections: snapshots.filter((snapshot) => normalizeString(snapshot && snapshot.selectedAnswerId, '')).map((snapshot) => Object.freeze({
            questionId: normalizeString(snapshot && snapshot.questionId, ''),
            blockNumber: Number((snapshot && snapshot.blockNumber) || (snapshot && snapshot.metadata && snapshot.metadata.blockNumber) || 0),
            itemIndex: Number((snapshot && snapshot.itemIndex) || (snapshot && snapshot.metadata && snapshot.metadata.itemIndex) || 0),
            selectedAnswerId: normalizeString(snapshot && snapshot.selectedAnswerId, ''),
          })).slice(0, 80),
        }),
      }));
    }
    const blob = createReviewBlob(effectiveReviewAttempt, snapshots, adapterWindow, { debugDiagnostics });
    const URLObject = adapterWindow.URL || URL;
    const url = URLObject.createObjectURL(blob);
    try {
      opened.location.href = url;
    } catch (_error) {
      if (typeof adapterWindow.open === 'function') {
        adapterWindow.open(url, '_blank', 'noopener,noreferrer');
      }
    }
    return Object.freeze({ url, blob, window: opened, attemptId, snapshotCount: snapshots.length, qbankFallbackSnapshotCount: qbankSnapshots.length });
  } catch (error) {
    try {
      if (opened.document && opened.document.body) {
        opened.document.title = 'Free120 Review Error';
        opened.document.body.textContent = `Free120 review failed: ${normalizeString(error && error.message, 'unknown error')}`;
      }
    } catch (_writeError) {}
    throw error;
  }
}

export {
  REVIEW_PAGE_VERSION,
  buildReviewHtml,
  createReviewBlob,
  createReviewBlobUrl,
  isQBankCacheAttempt,
  loadQBankFallbackSnapshots,
  openReviewTab,
};
