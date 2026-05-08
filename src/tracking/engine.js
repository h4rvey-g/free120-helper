import { SCRIPT, STORAGE_KEYS, DB_SCHEMA, ATTEMPT_STATUS, WEBFRED_ADAPTER_STATUS, WEBFRED_STATE_SOURCE, WEBFRED_ADAPTER_CONFIG, TRACKING_ENGINE_STATUS, TRACKING_ENGINE_CONFIG } from '../core/constants.js';
import { createStorageId, isPlainObject, normalizeIdArray, normalizePositiveInteger, normalizeRecord, normalizeString, sanitizeJsonCompatible } from '../core/data.js';
import { createLogger, nowIso } from '../core/logger.js';
import { createSettingsStore } from '../core/settings.js';
import {
  safeNowMs,
  firstNonEmpty,
  buildQuestionIdentity,
  safeAttribute,
  isReadableObject,
  coercePositiveInteger,
  uniqueNormalizedStrings,
  extractChoicesFromDom,
  extractSelectedAnswerIdFromDom,
  extractQuestionIdentityFromDom,
  safeElementText,
  findCurrentDomItemRoot,
} from '../webfred/adapter.js';
import { buildAttemptCompletionPatch, inferNativeCompletionState } from '../scoring/grader.js';
import { loadQBankCaptureContext, resolveQBankCaptureForItems } from '../qbank/cache-lookup.js';
import { extractMediaResourceUrlsForHtml, extractResourceUrlsFromHtml, fetchResourceDataByUrl, normalizeResourceUrl } from '../media/resource-cache.js';

function createTrackingEngineError(message, details) {
  const error = new Error(message);
  error.name = 'Free120TrackingEngineError';
  error.details = details || null;
  return error;
}

function stableHashString(value) {
  const text = normalizeString(value, '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableJsonStringify(value) {
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
    }
    if (isPlainObject(value)) {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  } catch (_error) {
    return '';
  }
}

function isSupportedMcqTrackingState(adapterState) {
  if (!adapterState || adapterState.status === WEBFRED_ADAPTER_STATUS.UNAVAILABLE) {
    return false;
  }

  const identityText = stableJsonStringify({
    examIdentity: adapterState.examIdentity || {},
    launchedScope: adapterState.launchedScope || {},
  });
  if (/\bccs\b|case\s+simulation/i.test(identityText)) {
    return false;
  }

  const currentContent = adapterState.currentContent || {};
  const renderedHtml = normalizeString(currentContent.renderedHtml || currentContent.answerBoxHtml || '', '');
  const hasChoiceData = Array.isArray(currentContent.choices) && currentContent.choices.length >= 2;
  const hasChoiceDom = /NBOptionInput|type=["']?(?:radio|checkbox)|ol[^>]+class=["'][^"']*options/i.test(renderedHtml);
  const hasItems = Boolean(adapterState.currentItem || (Array.isArray(adapterState.itemList) && adapterState.itemList.length));
  return hasItems && (hasChoiceData || hasChoiceDom || (Array.isArray(adapterState.itemList) && adapterState.itemList.length > 1));
}

function buildTrackingAttemptResumeKey(adapterState, runtimeContext) {
  const scope = adapterState && adapterState.launchedScope ? adapterState.launchedScope : {};
  const identity = adapterState && adapterState.examIdentity ? adapterState.examIdentity : {};
  const allBlockLaunch = adapterStateSuggestsAllBlockLaunch(adapterState);
  const currentBlock = adapterState && adapterState.currentBlock ? adapterState.currentBlock : '';
  const payload = {
    origin: runtimeContext && runtimeContext.origin,
    pathname: runtimeContext && runtimeContext.pathname,
    examProgram: identity.program || '',
    examName: identity.examName || '',
    section: identity.section || '',
    scopeBlock: scope.block || scope.selectedBlock || scope.launchedBlock || (allBlockLaunch ? '' : currentBlock),
    currentBlock: allBlockLaunch ? '' : currentBlock,
    scopeMode: scope.mode || scope.testMode || scope.scope || '',
  };
  return `webfred-attempt:${stableHashString(stableJsonStringify(payload))}`;
}

function buildTrackingPageContext(adapterState, runtimeContext) {
  return Object.freeze({
    resumeKey: buildTrackingAttemptResumeKey(adapterState, runtimeContext),
    href: runtimeContext && runtimeContext.href ? runtimeContext.href : '',
    pathname: runtimeContext && runtimeContext.pathname ? runtimeContext.pathname : '',
    search: runtimeContext && runtimeContext.search ? runtimeContext.search : '',
    adapterStatus: adapterState && adapterState.status ? adapterState.status : WEBFRED_ADAPTER_STATUS.UNAVAILABLE,
    adapterSource: adapterState && adapterState.source ? adapterState.source : WEBFRED_STATE_SOURCE.UNAVAILABLE,
    createdAt: nowIso(),
  });
}

function itemIdentityMatchesQuestionId(item, adapterState, questionId) {
  const normalizedQuestionId = normalizeString(questionId, '');
  if (!item || !normalizedQuestionId || !normalizedQuestionId.startsWith('webfred:')) {
    return true;
  }
  const examIdentity = adapterState && adapterState.examIdentity ? adapterState.examIdentity : {};
  const identity = buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    medleyId: item.medleyId,
    componentId: item.componentId,
    itemId: item.itemId || item.id,
    blockNumber: item.blockNumber || (adapterState && adapterState.currentBlock) || 1,
    itemIndex: item.itemIndex || 1,
  });
  return !identity.questionId || identity.questionId === normalizedQuestionId;
}

function getTrackingQuestionId(rawItem, adapterState, options = {}) {
  const item = rawItem || {};
  const existingId = normalizeString(item.questionId, '');
  if (existingId && itemIdentityMatchesQuestionId(item, adapterState, existingId)) {
    return existingId;
  }

  const examIdentity = adapterState && adapterState.examIdentity ? adapterState.examIdentity : {};
  const identity = buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    medleyId: item.medleyId,
    componentId: item.componentId,
    itemId: item.itemId || item.id,
    blockNumber: item.blockNumber || options.blockNumber || (adapterState && adapterState.currentBlock) || 1,
    itemIndex: item.itemIndex || options.itemIndex || 1,
  });
  if (identity.questionId) {
    return identity.questionId;
  }

  const fallbackPayload = {
    examProgram: examIdentity.program || '',
    examName: examIdentity.examName || '',
    section: examIdentity.section || '',
    blockNumber: identity.blockNumber || item.blockNumber || options.blockNumber || 1,
    itemIndex: identity.itemIndex || item.itemIndex || options.itemIndex || 1,
    componentId: identity.componentId || item.componentId || '',
    medleyId: identity.medleyId || item.medleyId || '',
  };
  return `webfred:untrusted:${stableHashString(stableJsonStringify(fallbackPayload))}`;
}

function normalizeTrackingItem(rawItem, adapterState, index = 0) {
  const item = isReadableObject(rawItem) ? rawItem : {};
  const blockNumber = coercePositiveInteger(item.blockNumber || item.block || (adapterState && adapterState.currentBlock), 1);
  const itemIndex = coercePositiveInteger(item.itemIndex || item.index || item.position || item.number, index + 1);
  const questionId = getTrackingQuestionId(item, adapterState, { blockNumber, itemIndex });
  const answerFromState = adapterState && adapterState.answers ? normalizeString(adapterState.answers[questionId], '') : '';
  const selectedAnswerId = firstNonEmpty([item.selectedAnswerId, item.answerId, item.responseId, answerFromState]);
  const markedFromState = Boolean(adapterState && adapterState.marks && adapterState.marks[questionId]);
  return Object.freeze({
    questionId,
    componentId: normalizeString(item.componentId, ''),
    medleyId: normalizeString(item.medleyId, ''),
    blockNumber,
    itemIndex,
    selectedAnswerId,
    answered: Boolean(item.answered || selectedAnswerId),
    marked: Boolean(item.marked || markedFromState),
    current: Boolean(item.current),
    identitySource: normalizeString(item.identitySource, questionId.startsWith('webfred:untrusted:') ? 'untrusted-fallback' : 'tracking-normalized'),
    source: normalizeString(item.source, adapterState && adapterState.source ? adapterState.source : WEBFRED_STATE_SOURCE.UNAVAILABLE),
  });
}

function getTrackingItemList(adapterState) {
  const items = Array.isArray(adapterState && adapterState.itemList) ? adapterState.itemList : [];
  const normalized = items.map((item, index) => normalizeTrackingItem(item, adapterState, index));
  if (adapterState && adapterState.currentItem) {
    const current = normalizeTrackingItem(adapterState.currentItem, adapterState, normalized.length);
    const existingIndex = normalized.findIndex((item) => item.questionId === current.questionId);
    const samePositionIndex = existingIndex >= 0 ? -1 : normalized.findIndex((item) => {
      const samePosition = coercePositiveInteger(item && item.blockNumber, 0) === coercePositiveInteger(current.blockNumber, 0)
        && coercePositiveInteger(item && item.itemIndex, 0) === coercePositiveInteger(current.itemIndex, 0);
      const replaceableIdentity = !normalizeString(item && item.questionId, '')
        || normalizeString(item && item.questionId, '').startsWith('webfred:untrusted:')
        || Boolean(current.componentId || current.medleyId);
      return samePosition && replaceableIdentity;
    });
    const targetIndex = existingIndex >= 0 ? existingIndex : samePositionIndex;
    if (targetIndex >= 0) {
      normalized[targetIndex] = Object.freeze({ ...normalized[targetIndex], ...current, current: true });
    } else {
      normalized.push(Object.freeze({ ...current, current: true }));
    }
  }

  const seen = new Set();
  return normalized.filter((item) => {
    if (!item.questionId || seen.has(item.questionId)) {
      return false;
    }
    seen.add(item.questionId);
    return true;
  }).sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.itemIndex - right.itemIndex;
  });
}

function getTrackingItemQuestionIds(itemList, currentQuestionId = '') {
  return uniqueNormalizedStrings([
    ...(Array.isArray(itemList) ? itemList.map((item) => item && item.questionId) : []),
    currentQuestionId,
  ]);
}

function adapterStateSuggestsAllBlockLaunch(adapterState) {
  const scope = isPlainObject(adapterState && adapterState.launchedScope) ? adapterState.launchedScope : {};
  const modeText = [scope.mode, scope.testMode, scope.scope, scope.launchMode, scope.deliveryMode]
    .map((value) => normalizeString(value, ''))
    .join(' ')
    .toLowerCase();
  return /\b(?:all|full|entire|whole|complete)\b/.test(modeText);
}

function shouldUseScopedQuestionSet(adapterState, itemList) {
  return Array.isArray(itemList) && itemList.length > 1 && !adapterStateSuggestsAllBlockLaunch(adapterState);
}

function mergeTrackingQuestionIds(existingQuestionIds, itemList, currentQuestionId, options = {}) {
  const scopedQuestionIds = getTrackingItemQuestionIds(itemList, currentQuestionId);
  if (options.replaceWithScopedItems === true && scopedQuestionIds.length) {
    return scopedQuestionIds;
  }
  return uniqueNormalizedStrings([
    ...(Array.isArray(existingQuestionIds) ? existingQuestionIds : []),
    ...scopedQuestionIds,
  ]);
}

function filterRecordToQuestionIds(record, questionIds) {
  const allowed = new Set(Array.isArray(questionIds) ? questionIds : []);
  return Object.freeze(Object.fromEntries(Object.entries(isPlainObject(record) ? record : {}).filter(([questionId]) => allowed.has(questionId))));
}

function filterTimelineToQuestionIds(entries, questionIds) {
  const allowed = new Set(Array.isArray(questionIds) ? questionIds : []);
  return Object.freeze((Array.isArray(entries) ? entries : []).filter((entry) => allowed.has(normalizeString(entry && entry.questionId, ''))));
}

function filterQuestionIds(questionIds, allowedQuestionIds) {
  const allowed = new Set(Array.isArray(allowedQuestionIds) ? allowedQuestionIds : []);
  return normalizeIdArray(questionIds || []).filter((questionId) => allowed.has(questionId));
}

function trackingPositionKey(candidate) {
  const blockNumber = coercePositiveInteger(candidate && candidate.blockNumber, 0);
  const itemIndex = coercePositiveInteger(candidate && candidate.itemIndex, 0);
  return blockNumber && itemIndex ? `${blockNumber}\u0000${itemIndex}` : '';
}

function trackingComponentKey(candidate) {
  const blockNumber = coercePositiveInteger(candidate && candidate.blockNumber, 0);
  const componentId = normalizeString(candidate && candidate.componentId, '');
  const medleyId = normalizeString(candidate && candidate.medleyId, '');
  return blockNumber && componentId && medleyId ? `${blockNumber}\u0000${medleyId}\u0000${componentId}` : '';
}

function getStoredTrackingMetadata(existingAttempt, questionId) {
  const source = isPlainObject(existingAttempt && existingAttempt.source) ? existingAttempt.source : {};
  const metadataByQuestionId = isPlainObject(source.itemMetadataByQuestionId) ? source.itemMetadataByQuestionId : {};
  const metadata = isPlainObject(metadataByQuestionId[questionId]) ? metadataByQuestionId[questionId] : {};
  const timingByQuestionId = isPlainObject(existingAttempt && existingAttempt.timingByQuestionId) ? existingAttempt.timingByQuestionId : {};
  const timing = isPlainObject(timingByQuestionId[questionId]) ? timingByQuestionId[questionId] : {};
  return Object.freeze({
    questionId,
    blockNumber: coercePositiveInteger(metadata.blockNumber || timing.blockNumber, 0),
    itemIndex: coercePositiveInteger(metadata.itemIndex || timing.itemIndex, 0),
    componentId: normalizeString(metadata.componentId, ''),
    medleyId: normalizeString(metadata.medleyId, ''),
  });
}

function createScopedTrackingQuestionMapper(existingAttempt, itemList, currentQuestionId = '') {
  const items = Array.isArray(itemList) ? itemList : [];
  const currentQuestionIds = new Set(getTrackingItemQuestionIds(items, currentQuestionId));
  const blockNumbers = new Set(items.map((item) => coercePositiveInteger(item && item.blockNumber, 0)).filter(Boolean));
  const byPosition = new Map();
  const byComponent = new Map();
  items.forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (!questionId) {
      return;
    }
    setIfAbsentMap(byPosition, trackingPositionKey(item), questionId);
    setIfAbsentMap(byComponent, trackingComponentKey(item), questionId);
  });

  function mapQuestionId(questionId) {
    const normalizedQuestionId = normalizeString(questionId, '');
    if (!normalizedQuestionId) {
      return '';
    }
    if (currentQuestionIds.has(normalizedQuestionId)) {
      return normalizedQuestionId;
    }
    const metadata = getStoredTrackingMetadata(existingAttempt, normalizedQuestionId);
    const metadataBlockNumber = coercePositiveInteger(metadata.blockNumber, 0);
    if (!metadataBlockNumber || (blockNumbers.size && !blockNumbers.has(metadataBlockNumber))) {
      return '';
    }
    return byComponent.get(trackingComponentKey(metadata))
      || byPosition.get(trackingPositionKey(metadata))
      || '';
  }

  function mapQuestionIds(questionIds) {
    return uniqueNormalizedStrings((Array.isArray(questionIds) ? questionIds : []).map(mapQuestionId));
  }

  function mapRecord(record) {
    const mapped = {};
    Object.entries(isPlainObject(record) ? record : {}).forEach(([questionId, value]) => {
      const mappedQuestionId = mapQuestionId(questionId);
      if (mappedQuestionId) {
        mapped[mappedQuestionId] = value;
      }
    });
    return Object.freeze(mapped);
  }

  function mapTimeline(entries) {
    return Object.freeze((Array.isArray(entries) ? entries : []).map((entry) => {
      const mappedQuestionId = mapQuestionId(entry && entry.questionId);
      return mappedQuestionId ? Object.freeze({ ...entry, questionId: mappedQuestionId }) : null;
    }).filter(Boolean));
  }

  return Object.freeze({ mapQuestionId, mapQuestionIds, mapRecord, mapTimeline });
}

function setIfAbsentMap(map, key, value) {
  if (key && value && !map.has(key)) {
    map.set(key, value);
  }
}

function normalizeTrackingResponseAliases(source) {
  const aliases = isPlainObject(source && source.responseAliases) ? source.responseAliases : {};
  return Object.freeze({
    byPosition: Object.freeze(normalizeRecord(aliases.byPosition || source && source.responsesByPosition || {})),
    byComponent: Object.freeze(normalizeRecord(aliases.byComponent || source && source.responsesByComponent || {})),
  });
}

function addTrackingResponseAlias(aliasDraft, item, answerId) {
  if (!item) {
    return;
  }
  const normalizedAnswerId = normalizeString(answerId, '');
  const positionKey = trackingPositionKey(item);
  const componentKey = trackingComponentKey(item);
  if (!normalizedAnswerId) {
    if (positionKey) {
      delete aliasDraft.byPosition[positionKey];
    }
    if (componentKey) {
      delete aliasDraft.byComponent[componentKey];
    }
    return;
  }
  if (positionKey) {
    aliasDraft.byPosition[positionKey] = normalizedAnswerId;
  }
  if (componentKey) {
    aliasDraft.byComponent[componentKey] = normalizedAnswerId;
  }
}

function buildTrackingResponseAliases(existingAttempt, itemList, responses = {}, changes = []) {
  const existingSource = isPlainObject(existingAttempt && existingAttempt.source) ? existingAttempt.source : {};
  const existingAliases = normalizeTrackingResponseAliases(existingSource);
  const aliasDraft = {
    byPosition: { ...existingAliases.byPosition },
    byComponent: { ...existingAliases.byComponent },
  };
  Object.entries(isPlainObject(responses) ? responses : {}).forEach(([questionId, answerId]) => {
    const item = (Array.isArray(itemList) ? itemList : []).find((candidate) => normalizeString(candidate && candidate.questionId, '') === questionId)
      || getStoredTrackingMetadata(existingAttempt, questionId);
    addTrackingResponseAlias(aliasDraft, item, answerId);
  });
  (Array.isArray(changes) ? changes : []).forEach((change) => {
    addTrackingResponseAlias(aliasDraft, change && change.item, change && change.toAnswerId);
  });
  return Object.freeze({
    byPosition: Object.freeze(aliasDraft.byPosition),
    byComponent: Object.freeze(aliasDraft.byComponent),
  });
}

function getTrackingResponseAliasForItem(responseAliases, item) {
  if (!item || !responseAliases) {
    return '';
  }
  const byComponent = isPlainObject(responseAliases.byComponent) ? responseAliases.byComponent : {};
  const byPosition = isPlainObject(responseAliases.byPosition) ? responseAliases.byPosition : {};
  return normalizeString(byComponent[trackingComponentKey(item)], normalizeString(byPosition[trackingPositionKey(item)], ''));
}

function fillScopedResponsesFromAliases(responses, itemList, responseAliases, options = {}) {
  const draft = { ...(isPlainObject(responses) ? responses : {}) };
  const skipQuestionIds = new Set(Array.isArray(options.skipQuestionIds) ? options.skipQuestionIds : []);
  (Array.isArray(itemList) ? itemList : []).forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (!questionId || skipQuestionIds.has(questionId) || normalizeString(draft[questionId], '')) {
      return;
    }
    const aliasAnswerId = getTrackingResponseAliasForItem(responseAliases, item);
    if (aliasAnswerId) {
      draft[questionId] = aliasAnswerId;
    }
  });
  return Object.freeze(draft);
}

function buildTrackingBlockMetadata(adapterState, itemList, responses = {}) {
  const baseBlocks = Array.isArray(adapterState && adapterState.blockMetadata) ? adapterState.blockMetadata : [];
  const blocksByNumber = new Map();
  baseBlocks.forEach((block) => {
    const blockNumber = coercePositiveInteger(block.blockNumber || block.block || block.index, blocksByNumber.size + 1);
    blocksByNumber.set(blockNumber, {
      ...block,
      blockNumber,
      itemCount: coercePositiveInteger(block.itemCount || block.questionCount || block.itemsCount, 0),
      answeredCount: 0,
    });
  });

  (Array.isArray(itemList) ? itemList : []).forEach((item) => {
    const blockNumber = coercePositiveInteger(item.blockNumber, 1);
    const existing = blocksByNumber.get(blockNumber) || { blockNumber, itemCount: 0, answeredCount: 0, label: `Block ${blockNumber}` };
    existing.itemCount = Math.max(coercePositiveInteger(existing.itemCount, 0), item.itemIndex || 0);
    if (normalizeString(responses[item.questionId], '')) {
      existing.answeredCount = coercePositiveInteger(existing.answeredCount, 0) + 1;
    }
    blocksByNumber.set(blockNumber, existing);
  });

  if (!blocksByNumber.size && adapterState && (adapterState.currentBlock || adapterState.itemCount)) {
    blocksByNumber.set(adapterState.currentBlock || 1, {
      blockNumber: adapterState.currentBlock || 1,
      itemCount: adapterState.itemCount || 0,
      answeredCount: Object.keys(responses || {}).filter((key) => normalizeString(responses[key], '')).length,
      label: adapterState.currentBlock ? `Block ${adapterState.currentBlock}` : '',
    });
  }

  return Array.from(blocksByNumber.values()).sort((left, right) => left.blockNumber - right.blockNumber);
}

function buildTrackingItemMetadataByQuestionId(existingAttempt, itemList, currentItem = null) {
  const existingSource = isPlainObject(existingAttempt && existingAttempt.source) ? existingAttempt.source : {};
  const metadata = normalizeRecord(existingSource.itemMetadataByQuestionId || {});
  const items = Array.isArray(itemList) ? itemList.slice() : [];
  if (currentItem) {
    items.push(currentItem);
  }
  items.forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (!questionId) {
      return;
    }
    metadata[questionId] = Object.freeze({
      questionId,
      blockNumber: coercePositiveInteger(item.blockNumber, 1),
      itemIndex: coercePositiveInteger(item.itemIndex, 1),
      componentId: normalizeString(item.componentId, ''),
      medleyId: normalizeString(item.medleyId, ''),
      identitySource: normalizeString(item.identitySource, ''),
      source: normalizeString(item.source, ''),
    });
  });
  return Object.freeze(metadata);
}

function buildAnsweredProgressByBlock(questionIds, itemList, responses = {}) {
  const itemByQuestionId = new Map();
  (Array.isArray(itemList) ? itemList : []).forEach((item) => itemByQuestionId.set(item.questionId, item));
  const progress = {};
  let totalAnswered = 0;
  let totalQuestions = 0;

  (Array.isArray(questionIds) ? questionIds : []).forEach((questionId) => {
    const item = itemByQuestionId.get(questionId) || {};
    const blockNumber = coercePositiveInteger(item.blockNumber, 1);
    if (!progress[blockNumber]) {
      progress[blockNumber] = { blockNumber, answered: 0, total: 0, answeredQuestionIds: [], questionIds: [] };
    }
    progress[blockNumber].total += 1;
    progress[blockNumber].questionIds.push(questionId);
    totalQuestions += 1;
    if (normalizeString(responses[questionId], '')) {
      progress[blockNumber].answered += 1;
      progress[blockNumber].answeredQuestionIds.push(questionId);
      totalAnswered += 1;
    }
  });

  return Object.freeze({
    byBlock: Object.freeze(progress),
    overall: Object.freeze({ answered: totalAnswered, total: totalQuestions }),
  });
}

function getTrackingCurrentItem(adapterState, itemList = null) {
  if (adapterState && adapterState.currentItem) {
    return normalizeTrackingItem(adapterState.currentItem, adapterState, Array.isArray(itemList) ? itemList.length : 0);
  }
  const items = Array.isArray(itemList) ? itemList : getTrackingItemList(adapterState);
  return items.find((item) => item.current) || null;
}

function getTrackingSelectedAnswerId(questionId, item, adapterState, choices = []) {
  const answerMap = adapterState && adapterState.answers ? adapterState.answers : {};
  if (Object.prototype.hasOwnProperty.call(answerMap, questionId)) {
    return normalizeString(answerMap[questionId], '');
  }
  const selectedChoice = (Array.isArray(choices) ? choices : []).find((choice) => choice && choice.selected);
  return firstNonEmpty([
    selectedChoice && selectedChoice.id,
    item && item.selectedAnswerId,
  ]);
}

function collectTrackingAnswerEntries(adapterState, itemList, currentChoices = []) {
  const entries = new Map();
  const items = Array.isArray(itemList) ? itemList : [];
  const answers = adapterState && adapterState.answers ? adapterState.answers : {};
  const currentQuestionId = adapterState && adapterState.currentItem
    ? normalizeTrackingItem(adapterState.currentItem, adapterState).questionId
    : '';
  items.forEach((item) => {
    const isCurrent = item.current || item.questionId === currentQuestionId;
    const choicesForItem = isCurrent ? currentChoices : [];
    const answerKnownFromMap = Object.prototype.hasOwnProperty.call(answers, item.questionId);
    const answerKnownFromCurrentChoices = isCurrent && Array.isArray(choicesForItem) && choicesForItem.length > 0;
    const answerKnownFromItem = Boolean(item.selectedAnswerId);
    const answerId = getTrackingSelectedAnswerId(item.questionId, item, adapterState, choicesForItem);
    entries.set(item.questionId, Object.freeze({
      item,
      answerId,
      known: Boolean(answerKnownFromMap || answerKnownFromCurrentChoices || answerKnownFromItem),
    }));
  });

  Object.entries(answers).forEach(([questionId, answerId]) => {
    const normalizedQuestionId = normalizeString(questionId, '');
    if (!normalizedQuestionId) {
      return;
    }
    const existing = entries.get(normalizedQuestionId);
    entries.set(normalizedQuestionId, Object.freeze({
      item: existing && existing.item ? existing.item : Object.freeze({ questionId: normalizedQuestionId, blockNumber: 1, itemIndex: entries.size + 1 }),
      answerId: normalizeString(answerId, ''),
      known: true,
    }));
  });
  return entries;
}

function appendTrackingAnswerTimeline(existingTimeline, changes, attemptId, reason, adapterState) {
  const timeline = Array.isArray(existingTimeline) ? existingTimeline.slice() : [];
  const changedAt = nowIso();
  changes.forEach((change) => {
    timeline.push(Object.freeze({
      id: createStorageId('answer-change'),
      attemptId,
      questionId: change.questionId,
      blockNumber: change.item && change.item.blockNumber ? change.item.blockNumber : 1,
      itemIndex: change.item && change.item.itemIndex ? change.item.itemIndex : 1,
      fromAnswerId: normalizeString(change.fromAnswerId, ''),
      toAnswerId: normalizeString(change.toAnswerId, ''),
      changedAt,
      source: adapterState && adapterState.source ? adapterState.source : WEBFRED_STATE_SOURCE.UNAVAILABLE,
      eventType: normalizeString(reason, 'state-update'),
    }));
  });
  return timeline;
}

function mergeTrackingResponses(existingResponses, answerEntries) {
  const responses = normalizeRecord(existingResponses || {});
  const changes = [];
  const emptyKnownQuestionIds = [];
  answerEntries.forEach((entry, questionId) => {
    if (!entry || !entry.known) {
      return;
    }
    const normalizedAnswerId = normalizeString(entry.answerId, '');
    if (!normalizedAnswerId) {
      emptyKnownQuestionIds.push(questionId);
    }
    const previousAnswerId = normalizeString(responses[questionId], '');
    if (previousAnswerId !== normalizedAnswerId) {
      responses[questionId] = normalizedAnswerId;
      changes.push(Object.freeze({
        questionId,
        item: entry.item,
        fromAnswerId: previousAnswerId,
        toAnswerId: normalizedAnswerId,
      }));
    }
  });
  return Object.freeze({ responses, changes, emptyKnownQuestionIds: Object.freeze(emptyKnownQuestionIds) });
}

function mergeTrackingMarkedQuestionIds(existingMarkedQuestionIds, adapterState, itemList) {
  const items = Array.isArray(itemList) ? itemList : [];
  const marks = adapterState && adapterState.marks ? adapterState.marks : {};
  const canTrustFullItemList = items.length > 1;
  const marked = new Set(canTrustFullItemList ? [] : normalizeIdArray(existingMarkedQuestionIds || []));

  items.forEach((item) => {
    if (item.marked || marks[item.questionId]) {
      marked.add(item.questionId);
    } else if (canTrustFullItemList) {
      marked.delete(item.questionId);
    }
  });

  Object.entries(marks).forEach(([questionId, value]) => {
    const normalizedQuestionId = normalizeString(questionId, '');
    if (normalizedQuestionId && value) {
      marked.add(normalizedQuestionId);
    } else if (normalizedQuestionId && canTrustFullItemList) {
      marked.delete(normalizedQuestionId);
    }
  });

  return Array.from(marked).filter(Boolean);
}

function createTrackingTimingState(adapterWindow) {
  return {
    activeQuestionId: '',
    activeItem: null,
    activeStartedAtMs: 0,
    activeEnteredAt: '',
    lastFlushAtMs: safeNowMs(adapterWindow || window),
  };
}

function appendTrackingTimingRecord(existingRecord, item, elapsedMs, reason, enteredAt) {
  const previous = isPlainObject(existingRecord) ? existingRecord : {};
  const roundedElapsed = Math.max(0, Math.round(Number(elapsedMs) || 0));
  const previousTotal = Math.max(0, Number(previous.totalMs || previous.timingMs || 0) || 0);
  const totalMs = previousTotal + roundedElapsed;
  const previousSegments = Array.isArray(previous.segments) ? previous.segments : [];
  const shouldStoreSegment = roundedElapsed > 0 && normalizeString(reason, '') !== 'poll';
  const segments = shouldStoreSegment
    ? previousSegments.concat(Object.freeze({
        enteredAt: normalizeString(enteredAt, ''),
        leftAt: nowIso(),
        durationMs: roundedElapsed,
        reason: normalizeString(reason, 'state-update'),
      })).slice(-TRACKING_ENGINE_CONFIG.MAX_TIMING_SEGMENTS_PER_QUESTION)
    : previousSegments.slice(-TRACKING_ENGINE_CONFIG.MAX_TIMING_SEGMENTS_PER_QUESTION);

  return Object.freeze({
    questionId: item && item.questionId ? item.questionId : normalizeString(previous.questionId, ''),
    blockNumber: item && item.blockNumber ? item.blockNumber : normalizePositiveInteger(previous.blockNumber, 1),
    itemIndex: item && item.itemIndex ? item.itemIndex : normalizePositiveInteger(previous.itemIndex, 1),
    totalMs,
    timingMs: totalMs,
    updatedAt: nowIso(),
    lastReason: normalizeString(reason, 'state-update'),
    segmentCount: Math.max(0, Number(previous.segmentCount || 0) || 0) + (roundedElapsed > 0 ? 1 : 0),
    segments,
  });
}

function flushTrackingTiming(timingState, currentItem, existingTimingByQuestionId, adapterWindow, reason, options = {}) {
  const timingByQuestionId = normalizeRecord(existingTimingByQuestionId || {});
  const nowMs = safeNowMs(adapterWindow || window);
  const activeQuestionId = normalizeString(timingState.activeQuestionId, '');
  const activeStartedAtMs = Number(timingState.activeStartedAtMs || 0) || 0;
  const activeItem = timingState.activeItem || (activeQuestionId ? { questionId: activeQuestionId } : null);

  if (activeQuestionId && activeStartedAtMs > 0) {
    const elapsedMs = Math.max(0, nowMs - activeStartedAtMs);
    timingByQuestionId[activeQuestionId] = appendTrackingTimingRecord(
      timingByQuestionId[activeQuestionId],
      activeItem,
      elapsedMs,
      reason,
      timingState.activeEnteredAt
    );
  }

  if (currentItem && !options.pause) {
    if (activeQuestionId !== currentItem.questionId) {
      timingState.activeEnteredAt = nowIso();
    }
    timingState.activeQuestionId = currentItem.questionId;
    timingState.activeItem = currentItem;
    timingState.activeStartedAtMs = nowMs;
  } else {
    timingState.activeQuestionId = '';
    timingState.activeItem = null;
    timingState.activeStartedAtMs = 0;
    timingState.activeEnteredAt = '';
  }
  timingState.lastFlushAtMs = nowMs;

  return timingByQuestionId;
}

function getTrackingDomRoot(adapterDocument, adapterWindow) {
  try {
    return findCurrentDomItemRoot(adapterDocument || document, adapterWindow || window);
  } catch (_error) {
    return null;
  }
}

function truncateTrackingHtml(html) {
  const normalized = normalizeString(html, '');
  if (normalized.length <= TRACKING_ENGINE_CONFIG.MAX_ANNOTATION_HTML_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, TRACKING_ENGINE_CONFIG.MAX_ANNOTATION_HTML_CHARS)}…`;
}

function extractTrackingNotesFromDom(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return Object.freeze({ status: 'unavailable', text: '', fields: [] });
  }
  const fields = Array.from(root.querySelectorAll(TRACKING_ENGINE_CONFIG.NOTE_SELECTOR))
    .map((element, index) => {
      const value = normalizeString(element.value !== undefined ? element.value : element.textContent, '');
      if (!value) {
        return null;
      }
      return Object.freeze({
        index: index + 1,
        tagName: normalizeString(element.tagName, '').toLowerCase(),
        name: safeAttribute(element, 'name'),
        id: safeAttribute(element, 'id'),
        text: value,
      });
    })
    .filter(Boolean)
    .slice(0, TRACKING_ENGINE_CONFIG.MAX_ANNOTATION_ITEMS);
  return Object.freeze({
    status: fields.length ? 'captured' : 'empty',
    text: fields.map((field) => field.text).join('\n\n'),
    fields,
  });
}

function elementLooksHighlighted(element) {
  const className = normalizeString(element.className, '').toLowerCase();
  const style = normalizeString(safeAttribute(element, 'style'), '').toLowerCase();
  return className.includes('highlight')
    || element.tagName === 'MARK'
    || /background(?:-color)?\s*:\s*(?:yellow|#ff|rgb\(255|rgba\(255)/i.test(style);
}

function elementLooksStruckOut(element) {
  const className = normalizeString(element.className, '').toLowerCase();
  const style = normalizeString(safeAttribute(element, 'style'), '').toLowerCase();
  const tagName = normalizeString(element.tagName, '').toLowerCase();
  return className.includes('strike')
    || className.includes('crossout')
    || tagName === 's'
    || tagName === 'del'
    || /text-decoration[^;]*(line-through)/i.test(style);
}

function serializeTrackingAnnotationElements(elements) {
  return Array.from(elements)
    .map((element, index) => Object.freeze({
      index: index + 1,
      text: safeElementText(element),
      html: truncateTrackingHtml(element.outerHTML || element.innerHTML || ''),
    }))
    .filter((entry) => entry.text || entry.html)
    .slice(0, TRACKING_ENGINE_CONFIG.MAX_ANNOTATION_ITEMS);
}

function extractTrackingAnnotationsFromDom(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return Object.freeze({ status: 'unavailable', highlights: [], strikeouts: [] });
  }
  const allElements = Array.from(root.querySelectorAll('*'));
  const highlights = serializeTrackingAnnotationElements(allElements.filter(elementLooksHighlighted));
  const strikeouts = serializeTrackingAnnotationElements(allElements.filter(elementLooksStruckOut));
  return Object.freeze({
    status: highlights.length || strikeouts.length ? 'captured' : 'empty',
    highlights,
    strikeouts,
    capturedAt: nowIso(),
  });
}

function getTrackingChoiceSelectionTokens(choice, fallbackIndex) {
  const index = coercePositiveInteger(choice && choice.index, fallbackIndex + 1);
  return uniqueNormalizedStrings([
    choice && choice.id,
    index ? String(index) : '',
    index ? `option-${index}` : '',
  ]).map((token) => token.toLowerCase());
}

function applyTrackingChoiceSelection(choices, authoritativeChoices) {
  if (!Array.isArray(authoritativeChoices)) {
    return choices;
  }
  const selectedTokens = new Set(authoritativeChoices.flatMap((choice, index) => (
    choice && choice.selected ? getTrackingChoiceSelectionTokens(choice, index) : []
  )));
  return choices.map((choice, index) => Object.freeze({
    ...choice,
    selected: getTrackingChoiceSelectionTokens(choice, index).some((token) => selectedTokens.has(token)),
  }));
}

function mergeTrackingChoices(stateChoices, domChoices, options = {}) {
  const merged = [];
  const indexById = new Map();
  [...(Array.isArray(stateChoices) ? stateChoices : []), ...(Array.isArray(domChoices) ? domChoices : [])].forEach((choice, index) => {
    if (!choice) {
      return;
    }
    const id = normalizeString(choice.id, `option-${index + 1}`);
    const normalized = Object.freeze({
      id,
      label: normalizeString(choice.label, ''),
      index: coercePositiveInteger(choice.index, index + 1),
      selected: Boolean(choice.selected),
      disabled: Boolean(choice.disabled),
    });
    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      indexById.set(id, merged.length);
      merged.push(normalized);
      return;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = Object.freeze({
      ...existing,
      label: normalized.label || existing.label,
      index: normalized.index || existing.index,
      selected: normalized.selected,
      disabled: normalized.disabled,
    });
  });
  return applyTrackingChoiceSelection(merged, options.authoritativeSelectionChoices);
}

function getSnapshotContentSource(qbankSnapshot, root, stateContent) {
  if (qbankSnapshot && normalizeString(qbankSnapshot.renderedHtml || qbankSnapshot.promptHtml, '')) {
    return 'qbank-cache';
  }
  if (stateContent && normalizeString(stateContent.renderedHtml || stateContent.promptHtml || stateContent.answerBoxHtml, '')) {
    return 'adapter-current-content';
  }
  if (root && normalizeString(root.innerHTML, '')) {
    return 'dom-current-item';
  }
  return 'unavailable';
}

function buildRenderedHtmlFromCurrentContent(stateContent) {
  const renderedHtml = normalizeString(stateContent && stateContent.renderedHtml, '');
  if (renderedHtml) {
    return renderedHtml;
  }
  const promptHtml = normalizeString(stateContent && stateContent.promptHtml, '');
  const answerBoxHtml = normalizeString(stateContent && stateContent.answerBoxHtml, '');
  return promptHtml || answerBoxHtml ? `<div class="f120-current-content-snapshot">${promptHtml}${answerBoxHtml}</div>` : '';
}

function shouldReloadQBankCaptureContext(context, attempt) {
  if (!context || !context.available) {
    return true;
  }
  const summary = isPlainObject(attempt && attempt.answerKeyCapture) ? attempt.answerKeyCapture : {};
  const status = normalizeString(summary.status, '');
  const failureReason = normalizeString(summary.failureReason, '');
  return status === 'failed'
    || status === 'partial'
    || failureReason === 'qbank-cache-missing'
    || failureReason === 'qbank-cache-no-matches';
}

function getCorrectAnswerForQuestion(questionId, attempt, qbankCaptureResult) {
  const fromAttempt = attempt && attempt.correctAnswers ? normalizeString(attempt.correctAnswers[questionId], '') : '';
  if (fromAttempt) {
    return fromAttempt;
  }
  const fromQBank = qbankCaptureResult && qbankCaptureResult.correctAnswers
    ? normalizeString(qbankCaptureResult.correctAnswers[questionId], '')
    : '';
  return fromQBank;
}

function createTrackingWebfredShellSnapshot(candidate = {}) {
  const adapterDocument = candidate.document || null;
  const nav = adapterDocument && typeof adapterDocument.querySelector === 'function'
    ? adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR)
    : null;
  return Object.freeze({
    title: normalizeString(adapterDocument && adapterDocument.title, ''),
    navHtml: normalizeString(nav && nav.outerHTML, ''),
    itemShellHtml: '<section id="item"><article id="content"><div id="medley"></div></article></section>',
    capturedAt: nowIso(),
    questionContentSource: 'qbank-cache',
  });
}

function createTrackingQuestionSnapshot(candidate) {
  const adapterState = candidate.adapterState || {};
  const item = candidate.item || getTrackingCurrentItem(adapterState, candidate.itemList) || {};
  const questionId = normalizeString(item.questionId, '');
  const stateContent = adapterState.currentContent || {};
  const root = candidate.root || null;
  const qbankSnapshotsByQuestionId = isPlainObject(candidate.qbankCaptureResult && candidate.qbankCaptureResult.snapshotsByQuestionId)
    ? candidate.qbankCaptureResult.snapshotsByQuestionId
    : {};
  const qbankSnapshot = qbankSnapshotsByQuestionId[questionId] || null;
  const qbankMetadata = isPlainObject(qbankSnapshot && qbankSnapshot.metadata) ? qbankSnapshot.metadata : {};
  const qbankOriginalQuestionId = normalizeString(qbankMetadata.qbankCacheOriginalQuestionId || qbankMetadata.qbankFallbackOriginalQuestionId, '');
  const qbankSource = isPlainObject(candidate.qbankCaptureResult && candidate.qbankCaptureResult.source) ? candidate.qbankCaptureResult.source : {};
  const qbankMatchSourcesByQuestionId = isPlainObject(qbankSource.matchSourcesByQuestionId) ? qbankSource.matchSourcesByQuestionId : {};
  const qbankAttemptIds = Array.isArray(qbankSource.qbankAttemptIds) ? qbankSource.qbankAttemptIds : [];
  const domChoices = root ? extractChoicesFromDom(root) : [];
  const domAnswerAuthoritative = Boolean(root && domChoices.length);
  const selectedFromDom = domAnswerAuthoritative ? firstNonEmpty([(domChoices.find((choice) => choice && choice.selected) || {}).id, extractSelectedAnswerIdFromDom(root)]) : '';
  const liveChoices = mergeTrackingChoices(stateContent.choices, domChoices, { authoritativeSelectionChoices: domAnswerAuthoritative ? domChoices : [] });
  const choices = mergeTrackingChoices(qbankSnapshot && qbankSnapshot.choices, liveChoices, { authoritativeSelectionChoices: domAnswerAuthoritative ? liveChoices : [] });
  const selectedAnswerId = domAnswerAuthoritative ? selectedFromDom : '';
  const correctAnswerId = getCorrectAnswerForQuestion(questionId, candidate.attempt, candidate.qbankCaptureResult);
  const notes = root ? extractTrackingNotesFromDom(root) : Object.freeze({ status: 'unavailable', text: '', fields: [] });
  const annotations = root ? extractTrackingAnnotationsFromDom(root) : Object.freeze({ status: 'unavailable', highlights: [], strikeouts: [] });
  const contentSource = getSnapshotContentSource(qbankSnapshot, root, stateContent);
  const renderedHtml = firstNonEmpty([
    qbankSnapshot && qbankSnapshot.renderedHtml,
    buildRenderedHtmlFromCurrentContent(stateContent),
    root && root.outerHTML,
  ]);
  const promptHtml = firstNonEmpty([
    qbankSnapshot && qbankSnapshot.promptHtml,
    stateContent && stateContent.promptHtml,
  ]);
  const resourceUrls = uniqueNormalizedStrings([
    ...(Array.isArray(qbankSnapshot && qbankSnapshot.resourceUrls) ? qbankSnapshot.resourceUrls : []),
    ...(Array.isArray(stateContent && stateContent.resourceUrls) ? stateContent.resourceUrls : []),
    ...extractResourceUrlsFromHtml(renderedHtml),
    ...extractResourceUrlsFromHtml(root && root.outerHTML),
  ]);
  const resourceDataByUrl = Object.freeze({
    ...((qbankSnapshot && qbankSnapshot.resourceDataByUrl && typeof qbankSnapshot.resourceDataByUrl === 'object') ? qbankSnapshot.resourceDataByUrl : {}),
    ...((candidate.resourceDataByUrl && typeof candidate.resourceDataByUrl === 'object') ? candidate.resourceDataByUrl : {}),
  });
  const timingRecord = candidate.timingByQuestionId && candidate.timingByQuestionId[questionId] ? candidate.timingByQuestionId[questionId] : null;
  const contentHash = stableHashString([
    questionId,
    item.componentId || '',
    item.medleyId || '',
    promptHtml,
    renderedHtml,
    choices.map((choice) => `${choice.id}:${choice.label}`).join('|'),
    resourceUrls.join('|'),
  ].join('\n---\n'));

  return Object.freeze({
    attemptId: candidate.attemptId,
    questionId,
    blockNumber: item.blockNumber || adapterState.currentBlock || 1,
    itemIndex: item.itemIndex || 1,
    metadata: Object.freeze({
      componentId: normalizeString(item.componentId, ''),
      medleyId: normalizeString(item.medleyId, ''),
      identitySource: normalizeString(item.identitySource, ''),
      adapterStatus: normalizeString(adapterState.status, ''),
      adapterSource: normalizeString(adapterState.source, ''),
      capturedFromDom: contentSource === 'dom-current-item',
      questionContentSource: contentSource,
      qbankCacheAttemptId: normalizeString(qbankMetadata.qbankCacheAttemptId || qbankMetadata.qbankFallbackAttemptId || qbankAttemptIds[0], ''),
      qbankCacheOriginalQuestionId: qbankOriginalQuestionId,
      qbankCacheMatchSource: normalizeString(qbankMetadata.qbankCacheMatchSource || qbankMatchSourcesByQuestionId[questionId], ''),
      answerBoxHtml: '',
    }),
    promptHtml,
    renderedHtml,
    choices,
    selectedAnswerId,
    correctAnswerId,
    marked: Boolean(item.marked || (adapterState.marks && adapterState.marks[questionId])),
    notes: notes.text || '',
    annotations,
    timingMs: timingRecord ? coercePositiveInteger(timingRecord.totalMs || timingRecord.timingMs, 0) : 0,
    resourceUrls,
    resourceDataByUrl,
    contentHash,
    snapshot: Object.freeze({
      webfredShell: createTrackingWebfredShellSnapshot(candidate),
      currentItem: sanitizeJsonCompatible(item),
      qbankCache: sanitizeJsonCompatible({
        attemptId: qbankMetadata.qbankCacheAttemptId || qbankMetadata.qbankFallbackAttemptId || qbankAttemptIds[0] || '',
        originalQuestionId: qbankOriginalQuestionId,
        matchSource: qbankMetadata.qbankCacheMatchSource || qbankMatchSourcesByQuestionId[questionId] || '',
        source: qbankSnapshot && qbankSnapshot.snapshot && qbankSnapshot.snapshot.qbankCache ? qbankSnapshot.snapshot.qbankCache : {},
      }),
      notes,
      annotations,
    }),
  });
}

function buildLockedNativeTerminalPatch(attempt, adapterState, completionState, reason) {
  const existingSource = isPlainObject(attempt && attempt.source) ? attempt.source : {};
  return Object.freeze({
    reviewReady: false,
    source: Object.freeze({
      ...existingSource,
      completion: Object.freeze({
        ...(isPlainObject(existingSource.completion) ? existingSource.completion : {}),
        status: ATTEMPT_STATUS.IN_PROGRESS,
        reviewReady: false,
        reviewLocked: true,
        terminalDetected: true,
        reason: normalizeString(reason, completionState && completionState.reason ? completionState.reason : 'native-terminal-incomplete-all-block'),
        updatedAt: nowIso(),
        completedBlockNumbers: completionState && completionState.completedBlockNumbers ? completionState.completedBlockNumbers : [],
        allLaunchedBlocksComplete: Boolean(completionState && completionState.allLaunchedBlocksComplete),
        scope: completionState && completionState.scope ? completionState.scope : {},
        terminalState: completionState && completionState.terminalState ? completionState.terminalState : {},
      }),
    }),
  });
}

function applyNativeCompletionToTrackingPatch(attempt, patch, adapterState, reason) {
  const candidate = Object.freeze({ ...attempt, ...patch });
  const completionState = inferNativeCompletionState(candidate, adapterState);
  if (!completionState.terminalDetected) {
    return patch;
  }
  if (!completionState.shouldComplete) {
    const lockedPatch = buildLockedNativeTerminalPatch(candidate, adapterState, completionState, completionState.reason);
    const lockedSource = isPlainObject(lockedPatch.source) ? lockedPatch.source : {};
    return Object.freeze({
      ...patch,
      ...lockedPatch,
      source: Object.freeze({
        ...lockedSource,
        ...(isPlainObject(patch.source) ? patch.source : {}),
        completion: lockedSource.completion || {},
      }),
    });
  }
  const completionPatch = buildAttemptCompletionPatch(candidate, {
    adapterState,
    completionState,
    reason: normalizeString(reason, completionState.reason || 'native-terminal-complete'),
  });
  const completionSource = isPlainObject(completionPatch.source) ? completionPatch.source : {};
  return Object.freeze({
    ...patch,
    ...completionPatch,
    source: Object.freeze({
      ...completionSource,
      ...(isPlainObject(patch.source) ? patch.source : {}),
      completion: completionSource.completion || {},
    }),
  });
}

function buildTrackingAttemptPatch(existingAttempt, adapterState, itemList, currentItem, mergeResult, timingByQuestionId, markedQuestionIds, qbankCaptureResult, reason) {
  const existingResponses = mergeResult.responses;
  const existingQuestionIds = existingAttempt && existingAttempt.questionIds ? existingAttempt.questionIds : [];
  const existingSource = isPlainObject(existingAttempt && existingAttempt.source) ? existingAttempt.source : {};
  const scopedQuestionSet = shouldUseScopedQuestionSet(adapterState, itemList);
  const scopedMapper = scopedQuestionSet ? createScopedTrackingQuestionMapper(existingAttempt, itemList, currentItem && currentItem.questionId) : null;
  const mappedExistingQuestionIds = scopedMapper ? scopedMapper.mapQuestionIds(existingQuestionIds) : existingQuestionIds;
  const questionIds = mergeTrackingQuestionIds(mappedExistingQuestionIds, itemList, currentItem && currentItem.questionId, { replaceWithScopedItems: scopedQuestionSet });
  const mappedExistingResponses = scopedMapper ? scopedMapper.mapRecord(existingResponses) : existingResponses;
  const aliasFilledResponses = scopedQuestionSet
    ? fillScopedResponsesFromAliases(mappedExistingResponses, itemList, normalizeTrackingResponseAliases(existingSource), {
        skipQuestionIds: mergeResult.emptyKnownQuestionIds,
      })
    : existingResponses;
  const responses = scopedQuestionSet ? filterRecordToQuestionIds(aliasFilledResponses, questionIds) : existingResponses;
  const responseAliases = buildTrackingResponseAliases(existingAttempt, itemList, responses, mergeResult.changes);
  const progress = buildAnsweredProgressByBlock(questionIds, itemList, responses);
  const qbankCorrectAnswers = qbankCaptureResult && qbankCaptureResult.correctAnswers ? qbankCaptureResult.correctAnswers : {};
  const correctAnswers = scopedMapper ? { ...scopedMapper.mapRecord(existingAttempt && existingAttempt.correctAnswers), ...qbankCorrectAnswers } : qbankCorrectAnswers;
  const qbankSummary = qbankCaptureResult && qbankCaptureResult.summary ? qbankCaptureResult.summary : null;
  const qbankSource = qbankCaptureResult && qbankCaptureResult.source ? qbankCaptureResult.source : null;
  return Object.freeze({
    schemaVersion: DB_SCHEMA.VERSION,
    scriptVersion: SCRIPT.VERSION,
    status: ATTEMPT_STATUS.IN_PROGRESS,
    examIdentity: normalizeRecord(adapterState.examIdentity || (existingAttempt && existingAttempt.examIdentity) || {}),
    launchedScope: normalizeRecord(adapterState.launchedScope || (existingAttempt && existingAttempt.launchedScope) || {}),
    blockMetadata: buildTrackingBlockMetadata(adapterState, itemList, responses),
    questionIds,
    questionCount: scopedQuestionSet
      ? Math.max(questionIds.length, coercePositiveInteger(adapterState.itemCount, 0))
      : Math.max(questionIds.length, coercePositiveInteger(adapterState.itemCount, 0), coercePositiveInteger(existingAttempt && existingAttempt.questionCount, 0)),
    responses,
    answerTimeline: scopedQuestionSet
      ? filterTimelineToQuestionIds((scopedMapper ? scopedMapper.mapTimeline(appendTrackingAnswerTimeline(existingAttempt && existingAttempt.answerTimeline, mergeResult.changes, existingAttempt.id, reason, adapterState)) : appendTrackingAnswerTimeline(existingAttempt && existingAttempt.answerTimeline, mergeResult.changes, existingAttempt.id, reason, adapterState)), questionIds)
      : appendTrackingAnswerTimeline(existingAttempt && existingAttempt.answerTimeline, mergeResult.changes, existingAttempt.id, reason, adapterState),
    correctAnswers: scopedQuestionSet ? filterRecordToQuestionIds(correctAnswers, questionIds) : correctAnswers,
    answerKeyCapture: qbankSummary ? normalizeRecord(qbankSummary) : normalizeRecord((existingAttempt && existingAttempt.answerKeyCapture) || {}),
    markedQuestionIds: scopedQuestionSet ? filterQuestionIds(scopedMapper ? scopedMapper.mapQuestionIds(markedQuestionIds) : markedQuestionIds, questionIds) : markedQuestionIds,
    notesByQuestionId: scopedQuestionSet
      ? filterRecordToQuestionIds(scopedMapper ? scopedMapper.mapRecord(existingAttempt && existingAttempt.notesByQuestionId) : existingAttempt && existingAttempt.notesByQuestionId, questionIds)
      : normalizeRecord((existingAttempt && existingAttempt.notesByQuestionId) || {}),
    annotationsByQuestionId: scopedQuestionSet
      ? filterRecordToQuestionIds(scopedMapper ? scopedMapper.mapRecord(existingAttempt && existingAttempt.annotationsByQuestionId) : existingAttempt && existingAttempt.annotationsByQuestionId, questionIds)
      : normalizeRecord((existingAttempt && existingAttempt.annotationsByQuestionId) || {}),
    timingByQuestionId: scopedQuestionSet ? filterRecordToQuestionIds(scopedMapper ? scopedMapper.mapRecord(timingByQuestionId) : timingByQuestionId, questionIds) : timingByQuestionId,
    source: Object.freeze({
      ...existingSource,
      adapterStatus: adapterState.status,
      adapterSource: adapterState.source,
      trackingEngineStatus: adapterState.status === WEBFRED_ADAPTER_STATUS.READY ? TRACKING_ENGINE_STATUS.TRACKING : TRACKING_ENGINE_STATUS.DEGRADED,
      progress,
      qbankCache: qbankSource ? normalizeRecord(qbankSource) : normalizeRecord(existingSource.qbankCache || {}),
      responseAliases,
      itemMetadataByQuestionId: scopedQuestionSet
        ? filterRecordToQuestionIds(buildTrackingItemMetadataByQuestionId(existingAttempt, itemList, currentItem), questionIds)
        : buildTrackingItemMetadataByQuestionId(existingAttempt, itemList, currentItem),
      lastTrackingReason: normalizeString(reason, 'state-update'),
      lastTrackedAt: nowIso(),
    }),
  });
}

async function findResumeAttempt(storage, resumeKey) {
  if (!storage || typeof storage.listInProgressStates !== 'function') {
    return null;
  }
  const states = await storage.listInProgressStates();
  const matchingState = (Array.isArray(states) ? states : []).find((state) => {
    const pageContext = state && state.pageContext ? state.pageContext : {};
    return normalizeString(pageContext.resumeKey, '') === resumeKey;
  });
  if (!matchingState) {
    return null;
  }
  return storage.getAttempt(matchingState.attemptId);
}

async function createOrResumeTrackingAttempt(storage, adapterState, runtimeContext, logger) {
  if (!storage) {
    throw createTrackingEngineError('Storage is required for tracking.');
  }
  if (!isSupportedMcqTrackingState(adapterState)) {
    throw createTrackingEngineError('Supported MCQ WebFRED launch not detected.', summarizeWebfredStateForLog(adapterState));
  }

  const pageContext = buildTrackingPageContext(adapterState, runtimeContext);
  const existingAttempt = await findResumeAttempt(storage, pageContext.resumeKey);
  const itemList = getTrackingItemList(adapterState);
  const currentItem = getTrackingCurrentItem(adapterState, itemList);
  const questionIds = mergeTrackingQuestionIds(existingAttempt && existingAttempt.questionIds, itemList, currentItem && currentItem.questionId);
  const baseAttempt = existingAttempt || await storage.createAttempt({
    status: ATTEMPT_STATUS.IN_PROGRESS,
    examIdentity: adapterState.examIdentity || {},
    launchedScope: adapterState.launchedScope || {},
    blockMetadata: buildTrackingBlockMetadata(adapterState, itemList, {}),
    questionIds,
    questionCount: Math.max(questionIds.length, coercePositiveInteger(adapterState.itemCount, 0)),
    source: {
      createdBy: 'tracking-engine',
      adapterStatus: adapterState.status,
      adapterSource: adapterState.source,
      resumeKey: pageContext.resumeKey,
    },
  });

  await storage.saveInProgressState({
    attemptId: baseAttempt.id,
    pageContext,
    activeBlock: adapterState.currentBlock || (currentItem && currentItem.blockNumber) || 1,
    activeQuestionId: currentItem && currentItem.questionId ? currentItem.questionId : '',
    answeredQuestionIds: Object.keys(baseAttempt.responses || {}).filter((questionId) => normalizeString(baseAttempt.responses[questionId], '')),
    visitedQuestionIds: questionIds,
    state: {
      status: existingAttempt ? 'resumed' : 'created',
      adapterStatus: adapterState.status,
      adapterSource: adapterState.source,
      updatedAt: nowIso(),
    },
  });

  if (logger) {
    logger.debug(existingAttempt ? 'Tracking attempt resumed.' : 'Tracking attempt created.', {
      attemptId: baseAttempt.id,
      resumeKey: pageContext.resumeKey,
      questionCount: questionIds.length,
    });
  }
  return baseAttempt;
}

async function persistTrackingState(options) {
  const storage = options.storage;
  const logger = options.logger;
  const adapterState = options.adapterState;
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const timingState = options.timingState;
  let attempt = options.attempt;

  if (!attempt || !adapterState) {
    return attempt || null;
  }
  if (attempt.status && attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
    return attempt;
  }

  const itemList = getTrackingItemList(adapterState);
  const currentItem = getTrackingCurrentItem(adapterState, itemList);
  const nativeCompletionState = inferNativeCompletionState(attempt, adapterState);
  if (!currentItem || !currentItem.questionId) {
    if (nativeCompletionState.terminalDetected) {
      const patch = nativeCompletionState.shouldComplete
        ? buildAttemptCompletionPatch(attempt, {
            adapterState,
            completionState: nativeCompletionState,
            reason: nativeCompletionState.reason,
          })
        : buildLockedNativeTerminalPatch(attempt, adapterState, nativeCompletionState, nativeCompletionState.reason);
      return storage.updateAttempt(attempt.id, patch);
    }
    return attempt;
  }

  const root = getTrackingDomRoot(adapterDocument, adapterWindow);
  const stateChoices = adapterState.currentContent && Array.isArray(adapterState.currentContent.choices) ? adapterState.currentContent.choices : [];
  const domChoices = root ? extractChoicesFromDom(root) : [];
  let effectiveAdapterState = adapterState;
  let effectiveItemList = itemList;
  let effectiveCurrentItem = currentItem;
  const domAnswerAuthoritative = Boolean(root && domChoices.length);
  if (root) {
    const domIdentity = extractQuestionIdentityFromDom(root, adapterDocument, adapterWindow, { currentBlock: effectiveAdapterState.currentBlock || adapterState.currentBlock });
    const rootQuestionId = normalizeString(domIdentity && domIdentity.questionId, '');
    const selectedFromDom = firstNonEmpty([(domChoices.find((choice) => choice && choice.selected) || {}).id, root ? extractSelectedAnswerIdFromDom(root) : '']);
    const effectiveCurrentQuestionId = normalizeString(effectiveCurrentItem && effectiveCurrentItem.questionId, '');
    const effectiveCurrentSelectedAnswerId = firstNonEmpty([
      effectiveAdapterState && effectiveAdapterState.answers ? effectiveAdapterState.answers[effectiveCurrentQuestionId] : '',
      effectiveCurrentItem && effectiveCurrentItem.selectedAnswerId,
    ]);
    const shouldPreferCapturedAdapterState = Boolean(options.preferAdapterState && effectiveCurrentSelectedAnswerId && !domAnswerAuthoritative);
    if (rootQuestionId && rootQuestionId !== effectiveCurrentQuestionId && !shouldPreferCapturedAdapterState) {
      const rootItem = normalizeTrackingItem({
        questionId: rootQuestionId,
        componentId: domIdentity.componentId,
        medleyId: domIdentity.medleyId,
        blockNumber: domIdentity.blockNumber || adapterState.currentBlock || (currentItem && currentItem.blockNumber) || 1,
        itemIndex: domIdentity.itemIndex || (currentItem && currentItem.itemIndex) || 1,
        selectedAnswerId: selectedFromDom,
        current: true,
        identitySource: domIdentity.identitySource || 'dom-current-root',
        source: adapterState.source,
      }, adapterState, Math.max(0, effectiveItemList.length - 1));
      const replaced = effectiveItemList.map((item) => {
        const samePosition = coercePositiveInteger(item && item.blockNumber, 0) === coercePositiveInteger(rootItem.blockNumber, 0)
          && coercePositiveInteger(item && item.itemIndex, 0) === coercePositiveInteger(rootItem.itemIndex, 0);
        return samePosition || item.questionId === rootItem.questionId ? rootItem : item;
      });
      if (!replaced.some((item) => item.questionId === rootItem.questionId)) {
        replaced.push(rootItem);
      }
      effectiveItemList = replaced;
      effectiveCurrentItem = rootItem;
    } else if (domAnswerAuthoritative || selectedFromDom) {
      effectiveCurrentItem = Object.freeze({ ...effectiveCurrentItem, selectedAnswerId: selectedFromDom, current: true });
      effectiveItemList = effectiveItemList.map((item) => item.questionId === effectiveCurrentItem.questionId ? Object.freeze({ ...item, selectedAnswerId: selectedFromDom, current: true }) : item);
    }
    if ((effectiveCurrentItem && effectiveCurrentItem.questionId) && (effectiveCurrentItem !== currentItem || effectiveItemList !== itemList || selectedFromDom || domAnswerAuthoritative)) {
      effectiveAdapterState = Object.freeze({
        ...adapterState,
        currentItem: effectiveCurrentItem,
        itemList: Object.freeze(effectiveItemList),
        answers: Object.freeze(domAnswerAuthoritative
          ? { ...(adapterState.answers || {}), [effectiveCurrentItem.questionId]: selectedFromDom }
          : (selectedFromDom ? { ...(adapterState.answers || {}), [effectiveCurrentItem.questionId]: selectedFromDom } : (adapterState.answers || {}))),
      });
    }
  }
  const currentChoices = mergeTrackingChoices(stateChoices, domChoices, { authoritativeSelectionChoices: domAnswerAuthoritative ? domChoices : null });
  const answerEntries = collectTrackingAnswerEntries(effectiveAdapterState, effectiveItemList, currentChoices);
  const mergeResult = mergeTrackingResponses(attempt.responses || {}, answerEntries);
  const markedQuestionIds = mergeTrackingMarkedQuestionIds(attempt.markedQuestionIds || [], effectiveAdapterState, effectiveItemList);
  const timingByQuestionId = flushTrackingTiming(
    timingState,
    effectiveCurrentItem,
    attempt.timingByQuestionId || {},
    adapterWindow,
    options.reason || 'state-update',
    { pause: Boolean(options.pauseTiming || adapterDocument.visibilityState === 'hidden') }
  );
  const scopedQuestionSet = shouldUseScopedQuestionSet(effectiveAdapterState, effectiveItemList);
  const trackingQuestionIds = mergeTrackingQuestionIds(attempt.questionIds || [], effectiveItemList, effectiveCurrentItem && effectiveCurrentItem.questionId, { replaceWithScopedItems: scopedQuestionSet });
  const qbankCaptureResult = resolveQBankCaptureForItems(options.qbankCaptureContext, {
    attempt,
    launchedScope: effectiveAdapterState.launchedScope,
    itemList: effectiveItemList,
    currentItem: effectiveCurrentItem,
    questionIds: trackingQuestionIds,
    expectedCount: scopedQuestionSet
      ? Math.max(trackingQuestionIds.length, coercePositiveInteger(effectiveAdapterState.itemCount, 0))
      : Math.max(trackingQuestionIds.length, coercePositiveInteger(effectiveAdapterState.itemCount, 0), coercePositiveInteger(attempt && attempt.questionCount, 0)),
  });
  let patch = buildTrackingAttemptPatch(
    attempt,
    effectiveAdapterState,
    effectiveItemList,
    effectiveCurrentItem,
    mergeResult,
    timingByQuestionId,
    markedQuestionIds,
    qbankCaptureResult,
    options.reason || 'state-update'
  );

  const questionId = effectiveCurrentItem.questionId;
  if (root || effectiveAdapterState.currentContent) {
    let snapshot = createTrackingQuestionSnapshot({
      attemptId: attempt.id,
      attempt: { ...attempt, ...patch },
      adapterState: effectiveAdapterState,
      itemList: effectiveItemList,
      item: effectiveCurrentItem,
      root,
      document: adapterDocument,
      timingByQuestionId,
      qbankCaptureResult,
    });
    try {
      const existingSnapshot = typeof storage.getQuestionSnapshot === 'function'
        ? await storage.getQuestionSnapshot(attempt.id, snapshot.questionId)
        : null;
      const existingResourceData = isPlainObject(existingSnapshot && existingSnapshot.resourceDataByUrl) ? existingSnapshot.resourceDataByUrl : {};
      const snapshotResourceData = isPlainObject(snapshot && snapshot.resourceDataByUrl) ? snapshot.resourceDataByUrl : {};
      const baseUrl = normalizeString(adapterWindow && adapterWindow.location && adapterWindow.location.href, `${SCRIPT.ORIGIN}/webfred/`);
      const mediaMetadataResourceUrls = await extractMediaResourceUrlsForHtml(adapterWindow, snapshot.renderedHtml);
      if (mediaMetadataResourceUrls.length) {
        snapshot = Object.freeze({
          ...snapshot,
          resourceUrls: uniqueNormalizedStrings([...(snapshot.resourceUrls || []), ...mediaMetadataResourceUrls]),
        });
      }
      const missingResourceUrls = uniqueNormalizedStrings(snapshot.resourceUrls || []).filter((url) => {
        const absoluteUrl = normalizeResourceUrl(url, baseUrl);
        return !existingResourceData[url] && !existingResourceData[absoluteUrl] && !snapshotResourceData[url] && !snapshotResourceData[absoluteUrl];
      });
      const fetchedResourceData = missingResourceUrls.length ? await fetchResourceDataByUrl(adapterWindow, missingResourceUrls, { baseUrl }) : {};
      const resourceDataByUrl = Object.freeze({ ...existingResourceData, ...snapshotResourceData, ...fetchedResourceData });
      if (Object.keys(resourceDataByUrl).length) {
        snapshot = Object.freeze({ ...snapshot, resourceDataByUrl });
      }
      await storage.saveQuestionSnapshot(snapshot);
      patch.notesByQuestionId[questionId] = snapshot.notes || '';
      patch.annotationsByQuestionId[questionId] = snapshot.annotations || {};
    } catch (error) {
      if (logger) {
        logger.warn('Question snapshot could not be saved.', error);
      }
    }
  }

  patch = applyNativeCompletionToTrackingPatch(
    { ...attempt, ...patch },
    patch,
    effectiveAdapterState,
    options.reason || 'state-update'
  );

  attempt = await storage.updateAttempt(attempt.id, patch);
  if (attempt.status === ATTEMPT_STATUS.IN_PROGRESS) {
    await storage.saveInProgressState({
      attemptId: attempt.id,
      pageContext: buildTrackingPageContext(effectiveAdapterState, options.runtimeContext),
      activeBlock: effectiveCurrentItem.blockNumber || effectiveAdapterState.currentBlock || 1,
      activeQuestionId: effectiveCurrentItem.questionId,
      answeredQuestionIds: Object.keys(attempt.responses || {}).filter((qid) => normalizeString(attempt.responses[qid], '')),
      visitedQuestionIds: attempt.questionIds,
      state: {
        status: attempt.source && attempt.source.trackingEngineStatus ? attempt.source.trackingEngineStatus : TRACKING_ENGINE_STATUS.TRACKING,
        progress: attempt.source && attempt.source.progress ? attempt.source.progress : {},
        completion: attempt.source && attempt.source.completion ? attempt.source.completion : {},
        lastReason: options.reason || 'state-update',
        updatedAt: nowIso(),
      },
    });
  }
  return attempt;
}

function createTrackingEngine(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const logger = options.logger || createLogger(createSettingsStore(adapterWindow.localStorage, STORAGE_KEYS.SETTINGS));
  const storage = options.storage || null;
  const webfredAdapter = options.webfredAdapter || null;
  const runtimeContext = options.runtimeContext || detectRuntimeContext(adapterWindow.location);
  const pollIntervalMs = coercePositiveInteger(options.pollIntervalMs, TRACKING_ENGINE_CONFIG.POLL_INTERVAL_MS);
  const eventFlushDelayMs = coercePositiveInteger(options.eventFlushDelayMs, TRACKING_ENGINE_CONFIG.EVENT_FLUSH_DELAY_MS);
  let status = TRACKING_ENGINE_STATUS.IDLE;
  let attempt = null;
  let startPromise = null;
  let flushChain = Promise.resolve();
  let stopped = false;
  let pollTimerId = null;
  let eventFlushTimerId = null;
  let lastState = null;
  let lastError = null;
  let qbankCaptureContext = null;
  const listeners = new Set();
  const timingState = createTrackingTimingState(adapterWindow);

  function setStatus(nextStatus) {
    status = nextStatus;
    listeners.forEach((listener) => {
      try {
        listener(Object.freeze({ status, attempt, lastState, lastError }));
      } catch (error) {
        logger.debug('Tracking engine listener failed.', error);
      }
    });
  }

  function readLatestState(fallbackState = null) {
    if (fallbackState) {
      lastState = fallbackState;
      return fallbackState;
    }
    if (!webfredAdapter || typeof webfredAdapter.readState !== 'function') {
      lastState = createEmptyWebfredState('tracking-adapter-unavailable');
      return lastState;
    }
    lastState = webfredAdapter.readState();
    return lastState;
  }

  function queueFlush(reason = 'state-update', flushOptions = {}) {
    const queued = flushChain.then(async () => {
      if (stopped && !flushOptions.force) {
        return attempt;
      }
      if (!attempt) {
        return null;
      }
      const adapterState = readLatestState(flushOptions.adapterState || null);
      if (shouldReloadQBankCaptureContext(qbankCaptureContext, attempt)) {
        qbankCaptureContext = await loadQBankCaptureContext(storage, logger);
      }
      attempt = await persistTrackingState({
        storage,
        logger,
        window: adapterWindow,
        document: adapterDocument,
        runtimeContext,
        attempt,
        adapterState,
        timingState,
        qbankCaptureContext,
        reason,
        pauseTiming: Boolean(flushOptions.pauseTiming),
        preferAdapterState: Boolean(flushOptions.adapterState),
      });
      if (attempt && attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
        stopped = true;
        stopPolling();
        removeDomListeners();
        setStatus(TRACKING_ENGINE_STATUS.STOPPED);
      } else if (adapterState.status === WEBFRED_ADAPTER_STATUS.READY) {
        setStatus(TRACKING_ENGINE_STATUS.TRACKING);
      } else if (adapterState.status === WEBFRED_ADAPTER_STATUS.DEGRADED || adapterState.status === WEBFRED_ADAPTER_STATUS.UNAVAILABLE) {
        setStatus(TRACKING_ENGINE_STATUS.DEGRADED);
      }
      return attempt;
    }).catch((error) => {
      lastError = error;
      setStatus(TRACKING_ENGINE_STATUS.FAILED);
      logger.warn('Tracking flush failed.', error);
      return attempt;
    });
    flushChain = queued.then(() => null, () => null);
    return queued;
  }

  function scheduleEventFlush(reason = 'event') {
    if (stopped) {
      return;
    }
    if (eventFlushTimerId !== null && typeof adapterWindow.clearTimeout === 'function') {
      adapterWindow.clearTimeout(eventFlushTimerId);
    }
    eventFlushTimerId = adapterWindow.setTimeout(() => {
      eventFlushTimerId = null;
      queueFlush(reason);
    }, eventFlushDelayMs);
  }

  function isTrackingRelevantTarget(target) {
    if (!target || typeof target.closest !== 'function') {
      return false;
    }
    return Boolean(target.closest([
      'input.NBOptionInput',
      'ol.options input[type="radio"]',
      'ol.options input[type="checkbox"]',
      'nav ol#leftnav li',
      'ol#leftnav li',
      'button',
      'input[type="button"]',
      'input[type="submit"]',
      'a',
      '[role="button"]',
      '.btn',
      '.NBButton',
      '[aria-label*="Mark"]',
      '[title*="Mark"]',
      '[aria-label*="mark"]',
      '[title*="mark"]',
      '.mark',
      '.marked',
      TRACKING_ENGINE_CONFIG.NOTE_SELECTOR,
    ].join(',')));
  }

  function handlePotentialTrackingEvent(event) {
    if (isTrackingRelevantTarget(event && event.target)) {
      scheduleEventFlush(event.type || 'dom-event');
    }
  }

  function handleVisibilityChange() {
    if (adapterDocument.visibilityState === 'hidden') {
      queueFlush('visibility-hidden', { pauseTiming: true, force: true });
    } else if (!stopped) {
      scheduleEventFlush('visibility-visible');
    }
  }

  function handlePageHide() {
    queueFlush('pagehide', { pauseTiming: true, force: true });
  }

  function addDomListeners() {
    adapterDocument.addEventListener('change', handlePotentialTrackingEvent, true);
    adapterDocument.addEventListener('click', handlePotentialTrackingEvent, true);
    adapterDocument.addEventListener('input', handlePotentialTrackingEvent, true);
    adapterDocument.addEventListener('keyup', handlePotentialTrackingEvent, true);
    adapterDocument.addEventListener('visibilitychange', handleVisibilityChange, true);
    adapterWindow.addEventListener('pagehide', handlePageHide, true);
    adapterWindow.addEventListener('beforeunload', handlePageHide, true);
  }

  function removeDomListeners() {
    adapterDocument.removeEventListener('change', handlePotentialTrackingEvent, true);
    adapterDocument.removeEventListener('click', handlePotentialTrackingEvent, true);
    adapterDocument.removeEventListener('input', handlePotentialTrackingEvent, true);
    adapterDocument.removeEventListener('keyup', handlePotentialTrackingEvent, true);
    adapterDocument.removeEventListener('visibilitychange', handleVisibilityChange, true);
    adapterWindow.removeEventListener('pagehide', handlePageHide, true);
    adapterWindow.removeEventListener('beforeunload', handlePageHide, true);
  }

  function startPolling() {
    if (pollTimerId !== null) {
      return;
    }
    pollTimerId = adapterWindow.setInterval(() => {
      queueFlush('poll');
    }, pollIntervalMs);
  }

  function stopPolling() {
    if (pollTimerId !== null) {
      adapterWindow.clearInterval(pollTimerId);
      pollTimerId = null;
    }
    if (eventFlushTimerId !== null) {
      adapterWindow.clearTimeout(eventFlushTimerId);
      eventFlushTimerId = null;
    }
  }

  async function start(startOptions = {}) {
    if (startPromise) {
      return startPromise;
    }
    if (attempt && (status === TRACKING_ENGINE_STATUS.TRACKING || status === TRACKING_ENGINE_STATUS.DEGRADED || status === TRACKING_ENGINE_STATUS.STARTING)) {
      return Object.freeze({ status, attempt, state: lastState });
    }
    stopped = false;
    setStatus(TRACKING_ENGINE_STATUS.STARTING);
    startPromise = (async () => {
      if (!storage || !webfredAdapter) {
        throw createTrackingEngineError('Tracking engine requires storage and WebFRED adapter.');
      }
      if (typeof storage.ready === 'function') {
        await storage.ready();
      }
      const adapterState = startOptions.adapterState || await webfredAdapter.waitForInitialization({
        timeoutMs: TRACKING_ENGINE_CONFIG.ATTEMPT_READY_TIMEOUT_MS,
      });
      lastState = adapterState;
      if (!isSupportedMcqTrackingState(adapterState)) {
        setStatus(TRACKING_ENGINE_STATUS.STOPPED);
        logger.debug('Tracking engine skipped unsupported WebFRED state.', summarizeWebfredStateForLog(adapterState));
        return Object.freeze({ status, attempt: null, state: adapterState });
      }
      attempt = await createOrResumeTrackingAttempt(storage, adapterState, runtimeContext, logger);
      qbankCaptureContext = await loadQBankCaptureContext(storage, logger);
      setStatus(adapterState.status === WEBFRED_ADAPTER_STATUS.READY ? TRACKING_ENGINE_STATUS.TRACKING : TRACKING_ENGINE_STATUS.DEGRADED);
      addDomListeners();
      startPolling();
      await queueFlush('initial', { adapterState });
      return Object.freeze({ status, attempt, state: adapterState });
    })().catch((error) => {
      lastError = error;
      setStatus(TRACKING_ENGINE_STATUS.FAILED);
      logger.warn('Tracking engine start failed.', error);
      throw error;
    }).finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function stop(reason = 'stop') {
    stopped = true;
    stopPolling();
    removeDomListeners();
    await queueFlush(reason, { pauseTiming: true, force: true });
    setStatus(TRACKING_ENGINE_STATUS.STOPPED);
    return attempt;
  }

  function onStatusChange(listener) {
    if (typeof listener !== 'function') {
      throw createTrackingEngineError('Tracking engine listener must be a function.');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    constants: Object.freeze({
      status: TRACKING_ENGINE_STATUS,
      config: TRACKING_ENGINE_CONFIG,
    }),
    start,
    stop,
    flush(reason = 'manual-flush') {
      return queueFlush(reason, { force: true });
    },
    onStatusChange,
    getStatus() {
      return status;
    },
    getAttempt() {
      return attempt;
    },
    getLastState() {
      return lastState;
    },
    getLastError() {
      return lastError;
    },
    isTracking() {
      return status === TRACKING_ENGINE_STATUS.TRACKING || status === TRACKING_ENGINE_STATUS.DEGRADED;
    },
  });
}

export {
  createTrackingEngine,
  createTrackingEngineError,
  createTrackingTimingState,
  createTrackingQuestionSnapshot,
  getTrackingItemList,
  buildTrackingAttemptPatch,
};
