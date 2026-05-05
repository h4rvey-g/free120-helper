import { SCRIPT, STORAGE_KEYS, DB_SCHEMA, ATTEMPT_STATUS, WEBFRED_ADAPTER_STATUS, WEBFRED_STATE_SOURCE, TRACKING_ENGINE_STATUS, TRACKING_ENGINE_CONFIG } from '../core/constants.js';
import { createLogger, nowIso } from '../core/logger.js';
import { createSettingsStore } from '../core/settings.js';
import { isPlainObject, normalizeString, normalizePositiveInteger, createStorageId, sanitizeJsonCompatible, normalizeRecord, normalizeIdArray } from '../storage/attempt-store.js';
import { safeNowMs, firstNonEmpty, buildQuestionIdentity, safeAttribute, isReadableObject, coercePositiveInteger, uniqueNormalizedStrings, extractCurrentContentFromDom, extractResourceUrls, extractChoicesFromDom, safeElementText } from '../webfred/adapter.js';

function createTrackingEngineError(message, details) {
  const error = new Error(message);
  error.name = 'Free120TrackingEngineError';
  error.details = details || null;
  return error;
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
  const payload = {
    origin: runtimeContext && runtimeContext.origin,
    pathname: runtimeContext && runtimeContext.pathname,
    examProgram: identity.program || '',
    examName: identity.examName || '',
    section: identity.section || '',
    scopeBlock: scope.block || scope.selectedBlock || scope.launchedBlock || '',
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

function getTrackingQuestionId(rawItem, adapterState, options = {}) {
  const item = rawItem || {};
  const existingId = normalizeString(item.questionId, '');
  if (existingId) {
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
    if (existingIndex >= 0) {
      normalized[existingIndex] = Object.freeze({ ...normalized[existingIndex], ...current, current: true });
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

function mergeTrackingQuestionIds(existingQuestionIds, itemList, currentQuestionId) {
  return uniqueNormalizedStrings([
    ...(Array.isArray(existingQuestionIds) ? existingQuestionIds : []),
    ...(Array.isArray(itemList) ? itemList.map((item) => item.questionId) : []),
    currentQuestionId,
  ]);
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
    item && item.selectedAnswerId,
    selectedChoice && selectedChoice.id,
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
  answerEntries.forEach((entry, questionId) => {
    if (!entry || !entry.known) {
      return;
    }
    const normalizedAnswerId = normalizeString(entry.answerId, '');
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
  return Object.freeze({ responses, changes });
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

function mergeTrackingChoices(stateChoices, domChoices) {
  const merged = [];
  const seen = new Set();
  [...(Array.isArray(stateChoices) ? stateChoices : []), ...(Array.isArray(domChoices) ? domChoices : [])].forEach((choice, index) => {
    if (!choice) {
      return;
    }
    const id = normalizeString(choice.id, `option-${index + 1}`);
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    merged.push(Object.freeze({
      id,
      label: normalizeString(choice.label, ''),
      index: coercePositiveInteger(choice.index, merged.length + 1),
      selected: Boolean(choice.selected),
      disabled: Boolean(choice.disabled),
    }));
  });
  return merged;
}

function getCorrectAnswerForQuestion(questionId, attempt, answerKeyCaptureResult) {
  const fromAttempt = attempt && attempt.correctAnswers ? normalizeString(attempt.correctAnswers[questionId], '') : '';
  if (fromAttempt) {
    return fromAttempt;
  }
  const fromResult = answerKeyCaptureResult && answerKeyCaptureResult.correctAnswers
    ? normalizeString(answerKeyCaptureResult.correctAnswers[questionId], '')
    : '';
  return fromResult;
}

function createTrackingQuestionSnapshot(candidate) {
  const adapterState = candidate.adapterState || {};
  const item = candidate.item || getTrackingCurrentItem(adapterState, candidate.itemList) || {};
  const questionId = normalizeString(item.questionId, '');
  const stateContent = adapterState.currentContent || {};
  const root = candidate.root || null;
  const domContent = root ? extractCurrentContentFromDom(root) : null;
  const choices = mergeTrackingChoices(stateContent.choices, domContent && domContent.choices);
  const selectedAnswerId = getTrackingSelectedAnswerId(questionId, item, adapterState, choices);
  const correctAnswerId = getCorrectAnswerForQuestion(questionId, candidate.attempt, candidate.answerKeyCaptureResult);
  const notes = root ? extractTrackingNotesFromDom(root) : Object.freeze({ status: 'unavailable', text: '', fields: [] });
  const annotations = root ? extractTrackingAnnotationsFromDom(root) : Object.freeze({ status: 'unavailable', highlights: [], strikeouts: [] });
  const renderedHtml = firstNonEmpty([
    root && root.outerHTML,
    stateContent.renderedHtml,
    domContent && domContent.renderedHtml,
  ]);
  const promptHtml = firstNonEmpty([
    stateContent.promptHtml,
    domContent && domContent.promptHtml,
  ]);
  const resourceUrls = uniqueNormalizedStrings([
    ...((Array.isArray(stateContent.resourceUrls) ? stateContent.resourceUrls : [])),
    ...((domContent && Array.isArray(domContent.resourceUrls)) ? domContent.resourceUrls : []),
    ...(root ? extractResourceUrls(root) : []),
  ]);
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
      capturedFromDom: Boolean(root),
      answerBoxHtml: normalizeString((domContent && domContent.answerBoxHtml) || stateContent.answerBoxHtml, ''),
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
    contentHash,
    snapshot: Object.freeze({
      currentItem: sanitizeJsonCompatible(item),
      currentContent: sanitizeJsonCompatible(stateContent || {}),
      notes,
      annotations,
    }),
  });
}

function buildTrackingAttemptPatch(existingAttempt, adapterState, itemList, currentItem, mergeResult, timingByQuestionId, markedQuestionIds, answerKeyCaptureResult, reason) {
  const existingResponses = mergeResult.responses;
  const existingQuestionIds = existingAttempt && existingAttempt.questionIds ? existingAttempt.questionIds : [];
  const questionIds = mergeTrackingQuestionIds(existingQuestionIds, itemList, currentItem && currentItem.questionId);
  const progress = buildAnsweredProgressByBlock(questionIds, itemList, existingResponses);
  const currentAnswerKeys = answerKeyCaptureResult && answerKeyCaptureResult.correctAnswers ? answerKeyCaptureResult.correctAnswers : {};
  const correctAnswers = {
    ...((existingAttempt && existingAttempt.correctAnswers) || {}),
    ...currentAnswerKeys,
  };
  return Object.freeze({
    schemaVersion: DB_SCHEMA.VERSION,
    scriptVersion: SCRIPT.VERSION,
    status: ATTEMPT_STATUS.IN_PROGRESS,
    examIdentity: normalizeRecord(adapterState.examIdentity || (existingAttempt && existingAttempt.examIdentity) || {}),
    launchedScope: normalizeRecord(adapterState.launchedScope || (existingAttempt && existingAttempt.launchedScope) || {}),
    blockMetadata: buildTrackingBlockMetadata(adapterState, itemList, existingResponses),
    questionIds,
    questionCount: Math.max(questionIds.length, coercePositiveInteger(adapterState.itemCount, 0)),
    responses: existingResponses,
    answerTimeline: appendTrackingAnswerTimeline(existingAttempt && existingAttempt.answerTimeline, mergeResult.changes, existingAttempt.id, reason, adapterState),
    correctAnswers,
    answerKeyCapture: normalizeRecord((existingAttempt && existingAttempt.answerKeyCapture) || {}),
    markedQuestionIds,
    notesByQuestionId: normalizeRecord((existingAttempt && existingAttempt.notesByQuestionId) || {}),
    annotationsByQuestionId: normalizeRecord((existingAttempt && existingAttempt.annotationsByQuestionId) || {}),
    timingByQuestionId,
    source: Object.freeze({
      adapterStatus: adapterState.status,
      adapterSource: adapterState.source,
      trackingEngineStatus: adapterState.status === WEBFRED_ADAPTER_STATUS.READY ? TRACKING_ENGINE_STATUS.TRACKING : TRACKING_ENGINE_STATUS.DEGRADED,
      progress,
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

  const itemList = getTrackingItemList(adapterState);
  const currentItem = getTrackingCurrentItem(adapterState, itemList);
  if (!currentItem || !currentItem.questionId) {
    return attempt;
  }

  const root = getTrackingDomRoot(adapterDocument, adapterWindow);
  const stateChoices = adapterState.currentContent && Array.isArray(adapterState.currentContent.choices) ? adapterState.currentContent.choices : [];
  const domChoices = root ? extractChoicesFromDom(root) : [];
  const answerEntries = collectTrackingAnswerEntries(adapterState, itemList, mergeTrackingChoices(stateChoices, domChoices));
  const mergeResult = mergeTrackingResponses(attempt.responses || {}, answerEntries);
  const markedQuestionIds = mergeTrackingMarkedQuestionIds(attempt.markedQuestionIds || [], adapterState, itemList);
  const timingByQuestionId = flushTrackingTiming(
    timingState,
    currentItem,
    attempt.timingByQuestionId || {},
    adapterWindow,
    options.reason || 'state-update',
    { pause: Boolean(options.pauseTiming || adapterDocument.visibilityState === 'hidden') }
  );
  const answerKeyCaptureResult = options.answerKeyCapture && typeof options.answerKeyCapture.getLastResult === 'function'
    ? options.answerKeyCapture.getLastResult()
    : null;
  const patch = buildTrackingAttemptPatch(
    attempt,
    adapterState,
    itemList,
    currentItem,
    mergeResult,
    timingByQuestionId,
    markedQuestionIds,
    answerKeyCaptureResult,
    options.reason || 'state-update'
  );

  const questionId = currentItem.questionId;
  if (root || adapterState.currentContent) {
    const snapshot = createTrackingQuestionSnapshot({
      attemptId: attempt.id,
      attempt: { ...attempt, ...patch },
      adapterState,
      itemList,
      item: currentItem,
      root,
      timingByQuestionId,
      answerKeyCaptureResult,
    });
    try {
      await storage.saveQuestionSnapshot(snapshot);
      patch.notesByQuestionId[questionId] = snapshot.notes || '';
      patch.annotationsByQuestionId[questionId] = snapshot.annotations || {};
    } catch (error) {
      if (logger) {
        logger.warn('Question snapshot could not be saved.', error);
      }
    }
  }

  attempt = await storage.updateAttempt(attempt.id, patch);
  await storage.saveInProgressState({
    attemptId: attempt.id,
    pageContext: buildTrackingPageContext(adapterState, options.runtimeContext),
    activeBlock: currentItem.blockNumber || adapterState.currentBlock || 1,
    activeQuestionId: currentItem.questionId,
    answeredQuestionIds: Object.keys(attempt.responses || {}).filter((qid) => normalizeString(attempt.responses[qid], '')),
    visitedQuestionIds: attempt.questionIds,
    state: {
      status: attempt.source && attempt.source.trackingEngineStatus ? attempt.source.trackingEngineStatus : TRACKING_ENGINE_STATUS.TRACKING,
      progress: attempt.source && attempt.source.progress ? attempt.source.progress : {},
      lastReason: options.reason || 'state-update',
      updatedAt: nowIso(),
    },
  });
  return attempt;
}

function createTrackingEngine(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const logger = options.logger || createLogger(createSettingsStore(adapterWindow.localStorage, STORAGE_KEYS.SETTINGS));
  const storage = options.storage || null;
  const webfredAdapter = options.webfredAdapter || null;
  const answerKeyCapture = options.answerKeyCapture || null;
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
  let unsubscribeAdapter = null;
  let lastState = null;
  let lastError = null;
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
      attempt = await persistTrackingState({
        storage,
        logger,
        window: adapterWindow,
        document: adapterDocument,
        runtimeContext,
        attempt,
        adapterState,
        timingState,
        answerKeyCapture,
        reason,
        pauseTiming: Boolean(flushOptions.pauseTiming),
      });
      if (adapterState.status === WEBFRED_ADAPTER_STATUS.READY) {
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

  function startAdapterSubscription() {
    if (!webfredAdapter || typeof webfredAdapter.onStateChange !== 'function' || unsubscribeAdapter) {
      return;
    }
    unsubscribeAdapter = webfredAdapter.onStateChange((state) => {
      lastState = state;
      scheduleEventFlush('adapter-state-change');
    });
  }

  function stopAdapterSubscription() {
    if (typeof unsubscribeAdapter === 'function') {
      unsubscribeAdapter();
    }
    unsubscribeAdapter = null;
  }

  async function startAnswerKeyCaptureForAttempt(adapterState) {
    if (!answerKeyCapture || !attempt || typeof answerKeyCapture.startAutoCapture !== 'function') {
      return null;
    }
    return answerKeyCapture.startAutoCapture({
      attemptId: attempt.id,
      adapterState,
      expectedCount: attempt.questionCount || (adapterState && adapterState.itemCount) || 0,
    }).then((result) => {
      logger.debug('Answer-key capture finished.', result && result.summary ? result.summary : result);
      return queueFlush('answer-key-capture', { adapterState: webfredAdapter && webfredAdapter.getLastState ? webfredAdapter.getLastState() : adapterState });
    }).catch((error) => {
      logger.warn('Answer-key capture failed.', error);
      return queueFlush('answer-key-capture-failed');
    });
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
      setStatus(adapterState.status === WEBFRED_ADAPTER_STATUS.READY ? TRACKING_ENGINE_STATUS.TRACKING : TRACKING_ENGINE_STATUS.DEGRADED);
      addDomListeners();
      startPolling();
      await queueFlush('initial', { adapterState });
      startAnswerKeyCaptureForAttempt(adapterState);
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
    stopAdapterSubscription();
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

// Phase 4 answer-key capture lives below this marker.

export {
  createTrackingEngine,
  createTrackingEngineError,
  createTrackingTimingState,
  createTrackingQuestionSnapshot,
  buildTrackingAttemptPatch,
};
