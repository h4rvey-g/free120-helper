import { STORAGE_KEYS, ATTEMPT_STATUS, WEBFRED_ADAPTER_STATUS, ANSWER_KEY_CAPTURE_STATUS, ANSWER_KEY_CAPTURE_SOURCE, ANSWER_KEY_CAPTURE_CONFIG } from '../core/constants.js';
import { createLogger, nowIso } from '../core/logger.js';
import { createSettingsStore } from '../core/settings.js';
import { isPlainObject, normalizeString } from '../storage/attempt-store.js';
import {
  firstNonEmpty,
  buildQuestionIdentity,
  safeAttribute,
  safeDatasetValue,
  isDomElement,
  isReadableObject,
  valueToArray,
  coercePositiveInteger,
  normalizeMaybeBoolean,
  readCandidateProperty,
  safeOwnKeys,
  uniqueNormalizedStrings,
  extractChoicesFromDom,
  extractSelectedAnswerIdFromDom,
  extractQuestionIdentityFromDom,
  extractExamIdentityFromDom,
  findCurrentDomItemRoot,
  findKeyNavigationItem,
  collectAngularStateRoots,
  safeNowMs,
  createEmptyWebfredState,
} from '../webfred/adapter.js';
import { buildAttemptScoreSummary } from '../scoring/grader.js';

function createAnswerKeyCaptureError(message, details) {
  const error = new Error(message);
  error.name = 'Free120AnswerKeyCaptureError';
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

function normalizeAnswerKeyString(value) {
  return normalizeString(value, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function isAnswerKeyStatusComplete(status) {
  return status === ANSWER_KEY_CAPTURE_STATUS.COMPLETE;
}

function isReadOnlyMethodName(name) {
  const normalized = normalizeString(name, '').toLowerCase();
  if (!normalized
    || ['getsessionid', 'getcontentbulk'].includes(normalized)
    || /navigate|route|go|next|prev|previous|select|submit|finish|end|save|put|post|delete|remove|clear|update|mark|flag|note|highlight|strike|timer|start|stop|reset|show|reveal|display|open|close|launch|loaditem|goto/.test(normalized)
    || normalized.startsWith('set')
    || /(^|[._-])set([._-]|$)/.test(normalized)) {
    return false;
  }
  return /^(get|read|list|find|lookup|fetch|query|all|current|content|item|question|answerkey|correct|key|config|state)/.test(normalized)
    || /(items|questions|answerkeys|correctanswers|content|state|config)$/.test(normalized);
}

function shouldScanAnswerKeyProperty(name) {
  const normalized = normalizeString(name, '').toLowerCase();
  if (!normalized || /^\$\$|^_|prototype|constructor|window|document|element|scope|location|history|navigator|localstorage|sessionstorage/i.test(normalized)) {
    return false;
  }
  if (/navigate|route|go|next|prev|previous|select|submit|finish|end|save|put|post|delete|remove|clear|update|mark|flag|note|highlight|strike|timer|start|stop|reset|show|reveal|display|open|close|launch|loaditem|goto/.test(normalized)
    || normalized.startsWith('set')
    || /(^|[._-])set([._-]|$)/.test(normalized)) {
    return false;
  }
  return true;
}

function isProbablyAnswerChoiceRecord(value) {
  if (!isReadableObject(value) || isDomElement(value)) {
    return false;
  }
  return Boolean(
    readCandidateDataProperty(value, ['optionId', 'choiceId', 'answerId', 'responseId']) !== undefined
    || readCandidateDataProperty(value, ['isCorrect', 'correct', 'isKey', 'keyed']) !== undefined
  );
}

function hasQuestionIdentityFields(value) {
  if (!isReadableObject(value) || isDomElement(value)) {
    return false;
  }
  return Boolean(
    readCandidateDataProperty(value, ['questionId', 'itemId', 'itemIdentifier']) !== undefined
    || readCandidateDataProperty(value, ['componentId', 'componentID', 'compId', 'compID', 'itemComponentId']) !== undefined
    || readCandidateDataProperty(value, ['medleyId', 'medleyID', 'medley']) !== undefined
  );
}

function hasAnswerKeyFields(value) {
  if (!isReadableObject(value) || isDomElement(value)) {
    return false;
  }
  return Boolean(readCandidateDataProperty(value, [
    'correctAnswerId', 'correctAnswerID', 'correctResponseId', 'correctOptionId', 'correctChoiceId',
    'answerKey', 'answer_key', 'keyedAnswer', 'keyedResponse', 'correctAnswer', 'correctResponse',
    'correctOption', 'correctChoice', 'correctAnswers', 'correctResponses', 'solutionAnswerId',
  ]) !== undefined);
}

function hasChoiceCollectionFields(value) {
  if (!isReadableObject(value) || isDomElement(value)) {
    return false;
  }
  return Boolean(readCandidateDataProperty(value, [
    'choices', 'options', 'answers', 'answerOptions', 'answerChoices', 'responses', 'responseOptions',
  ]) !== undefined);
}

function isProbablyQuestionRecord(value) {
  if (!isReadableObject(value) || isDomElement(value) || isProbablyAnswerChoiceRecord(value) && !hasQuestionIdentityFields(value)) {
    return false;
  }
  return hasQuestionIdentityFields(value)
    || (readCandidateDataProperty(value, ['id', 'identifier']) !== undefined && hasAnswerKeyFields(value))
    || (hasAnswerKeyFields(value) && hasChoiceCollectionFields(value));
}

function readCandidateDataProperty(source, names) {
  if (!isReadableObject(source)) {
    return undefined;
  }

  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    if (!name) {
      continue;
    }
    try {
      if (Object.prototype.hasOwnProperty.call(source, name) || source[name] !== undefined) {
        const value = source[name];
        if (value !== undefined && value !== null && typeof value !== 'function') {
          return value;
        }
      }
    } catch (_error) {}
  }
  return undefined;
}

function readCorrectFlag(value) {
  if (!isReadableObject(value)) {
    return false;
  }
  const direct = readCandidateDataProperty(value, [
    'isCorrect', 'correct', 'isCorrectAnswer', 'correctAnswer', 'isKey', 'keyed', 'isKeyed',
    'isAnswerKey', 'answerKey', 'isExpected', 'expected', 'shouldBeSelected',
  ]);
  const normalized = normalizeMaybeBoolean(direct);
  if (normalized !== null) {
    return normalized;
  }
  const className = normalizeString(readCandidateDataProperty(value, ['className', 'class']), '').toLowerCase();
  return /(^|[\s_-])correct($|[\s_-])/.test(className) && !/(^|[\s_-])incorrect($|[\s_-])/.test(className);
}

function normalizeChoiceRecords(rawChoices) {
  return valueToArray(rawChoices).map((choice, index) => {
    if (!isReadableObject(choice)) {
      return Object.freeze({
        id: normalizeString(choice, `option-${index + 1}`),
        label: normalizeString(choice, ''),
        index: index + 1,
        selected: false,
        disabled: false,
        correct: false,
      });
    }

    return Object.freeze({
      id: firstNonEmpty([
        readCandidateDataProperty(choice, ['id', 'optionId', 'answerId', 'choiceId', 'responseId', 'value', 'key']),
        `option-${index + 1}`,
      ]),
      label: firstNonEmpty([
        readCandidateDataProperty(choice, ['label', 'text', 'html', 'choiceText', 'answerText', 'displayText']),
        normalizeString(choice, ''),
      ]),
      index: coercePositiveInteger(readCandidateDataProperty(choice, ['index', 'itemIndex', 'ordinal', 'position', 'number']), index + 1),
      selected: Boolean(normalizeMaybeBoolean(readCandidateDataProperty(choice, ['selected', 'isSelected', 'checked']))),
      disabled: Boolean(normalizeMaybeBoolean(readCandidateDataProperty(choice, ['disabled', 'isDisabled']))),
      correct: readCorrectFlag(choice),
    });
  });
}

function createChoiceLookup(choices) {
  const normalizedChoices = Array.isArray(choices) ? choices : [];
  const byIdOrText = new Map();
  normalizedChoices.forEach((choice) => {
    [choice.id, choice.label, normalizeString(choice.index, '')].forEach((key) => {
      const normalized = normalizeAnswerKeyString(key).toLowerCase();
      if (normalized && !byIdOrText.has(normalized)) {
        byIdOrText.set(normalized, choice.id);
      }
    });
  });
  return byIdOrText;
}

function resolveAnswerIdFromCandidate(candidate, choices = []) {
  const normalizedChoices = Array.isArray(choices) ? choices : [];
  const lookup = createChoiceLookup(normalizedChoices);

  function fromPrimitive(value) {
    const normalized = normalizeAnswerKeyString(value);
    if (!normalized) {
      return '';
    }
    return lookup.get(normalized.toLowerCase()) || normalized;
  }

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const itemId = resolveAnswerIdFromCandidate(item, normalizedChoices);
      if (itemId) {
        return itemId;
      }
    }
    return '';
  }

  if (!isReadableObject(candidate)) {
    return fromPrimitive(candidate);
  }

  const direct = firstNonEmpty([
    readCandidateDataProperty(candidate, ['id', 'optionId', 'answerId', 'choiceId', 'responseId', 'value', 'key']),
    readCandidateDataProperty(candidate, ['letter', 'label']),
  ]);
  const directId = fromPrimitive(direct);
  if (directId) {
    return directId;
  }

  const nested = readCandidateDataProperty(candidate, ['answer', 'response', 'option', 'choice', 'correctAnswer', 'correctResponse', 'correctOption', 'correctChoice']);
  if (nested && nested !== candidate) {
    return resolveAnswerIdFromCandidate(nested, normalizedChoices);
  }

  return '';
}

function extractCorrectAnswerIdFromChoices(choices) {
  const normalizedChoices = Array.isArray(choices) ? choices : [];
  const correctChoice = normalizedChoices.find((choice) => readCorrectFlag(choice));
  return correctChoice ? normalizeAnswerKeyString(correctChoice.id) : '';
}

function extractCorrectAnswerIdFromQuestionRecord(rawQuestion, choices) {
  if (!isReadableObject(rawQuestion)) {
    return '';
  }

  const direct = firstNonEmpty([
    readCandidateDataProperty(rawQuestion, ['correctAnswerId', 'correctAnswerID', 'correctResponseId', 'correctOptionId', 'correctChoiceId']),
    readCandidateDataProperty(rawQuestion, ['keyedAnswerId', 'keyedResponseId', 'keyedOptionId', 'keyedChoiceId']),
    readCandidateDataProperty(rawQuestion, ['solutionAnswerId', 'expectedAnswerId', 'answerKeyId']),
  ]);
  const directId = resolveAnswerIdFromCandidate(direct, choices);
  if (directId) {
    return directId;
  }

  const nestedCandidates = [
    readCandidateDataProperty(rawQuestion, ['answerKey', 'answer_key', 'keyedAnswer', 'keyedResponse']),
    readCandidateDataProperty(rawQuestion, ['correctAnswer', 'correctResponse', 'correctOption', 'correctChoice']),
    readCandidateDataProperty(rawQuestion, ['correctAnswers', 'correctResponses', 'correctOptions', 'correctChoices']),
    readCandidateDataProperty(rawQuestion, ['solution', 'solutionAnswer', 'expectedAnswer']),
  ].filter((value) => value !== undefined && value !== null && value !== '');

  for (const nested of nestedCandidates) {
    const nestedId = resolveAnswerIdFromCandidate(nested, choices);
    if (nestedId) {
      return nestedId;
    }
  }

  return extractCorrectAnswerIdFromChoices(choices);
}

function normalizeAnswerKeyQuestionIdentity(rawQuestion, options = {}) {
  const examIdentity = options.examIdentity || {};
  const fallback = options.fallback || {};
  const indexFallback = coercePositiveInteger(options.index, 0) || coercePositiveInteger(fallback.itemIndex, 0);
  const blockFallback = coercePositiveInteger(options.blockNumber, 0) || coercePositiveInteger(fallback.blockNumber, 0);

  if (!isReadableObject(rawQuestion)) {
    return buildQuestionIdentity({
      examProgram: examIdentity.program,
      examName: examIdentity.examName,
      examSection: examIdentity.section,
      itemId: rawQuestion,
      blockNumber: blockFallback,
      itemIndex: indexFallback,
    });
  }

  return buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    medleyId: readCandidateDataProperty(rawQuestion, ['medleyId', 'medleyID', 'medley', 'medley_id']),
    componentId: readCandidateDataProperty(rawQuestion, ['componentId', 'componentID', 'compId', 'compID', 'component_id', 'itemComponentId']),
    itemId: readCandidateDataProperty(rawQuestion, ['questionId', 'itemId', 'id', 'identifier', 'itemIdentifier']),
    blockNumber: coercePositiveInteger(
      readCandidateDataProperty(rawQuestion, ['blockNumber', 'block', 'blockIndex', 'sectionNumber']),
      blockFallback || 1
    ),
    itemIndex: coercePositiveInteger(
      readCandidateDataProperty(rawQuestion, ['itemIndex', 'index', 'ordinal', 'position', 'number', 'sequence']),
      indexFallback || 1
    ),
  });
}

function normalizeAnswerKeyRecord(rawQuestion, options = {}) {
  const identity = normalizeAnswerKeyQuestionIdentity(rawQuestion, options);
  const rawChoices = isReadableObject(rawQuestion)
    ? readCandidateDataProperty(rawQuestion, ['choices', 'options', 'answers', 'answerOptions', 'answerChoices', 'responses', 'responseOptions'])
    : null;
  const choices = normalizeChoiceRecords(rawChoices);
  const correctAnswerId = extractCorrectAnswerIdFromQuestionRecord(rawQuestion, choices);

  if (!correctAnswerId) {
    return null;
  }

  const questionId = identity.questionId || normalizeString(options.fallback && options.fallback.questionId, '');
  const componentId = identity.componentId || normalizeString(options.fallback && options.fallback.componentId, '');
  const medleyId = identity.medleyId || normalizeString(options.fallback && options.fallback.medleyId, '');
  const itemIndex = identity.itemIndex || coercePositiveInteger(options.index, 0);
  const blockNumber = identity.blockNumber || coercePositiveInteger(options.blockNumber, 0);

  return Object.freeze({
    questionId,
    componentId,
    medleyId,
    blockNumber,
    itemIndex,
    correctAnswerId,
    selectedAnswerId: firstNonEmpty([
      isReadableObject(rawQuestion) && readCandidateDataProperty(rawQuestion, ['selectedAnswerId', 'selectedResponseId', 'selectedOptionId', 'answerId', 'responseId', 'value']),
      options.fallback && options.fallback.selectedAnswerId,
    ]),
    choices: Object.freeze(choices),
    identitySource: identity.identitySource,
    captureSource: options.captureSource || ANSWER_KEY_CAPTURE_SOURCE.UNAVAILABLE,
    capturedAt: nowIso(),
    confidence: questionId ? 'high' : (componentId || medleyId || itemIndex ? 'medium' : 'low'),
    contentHash: stableHashString([
      questionId,
      componentId,
      medleyId,
      itemIndex,
      correctAnswerId,
      choices.map((choice) => `${choice.id}:${choice.label}`).join('|'),
    ].join('||')),
  });
}

function buildAnswerKeyItemAliasMap(adapterState) {
  const aliases = new Map();
  const items = adapterState && Array.isArray(adapterState.itemList) ? adapterState.itemList : [];
  items.forEach((item) => {
    const keys = uniqueNormalizedStrings([
      item.questionId,
      item.componentId,
      item.medleyId,
      item.itemIndex ? String(item.itemIndex) : '',
      item.blockNumber && item.itemIndex ? `${item.blockNumber}:${item.itemIndex}` : '',
    ]);
    keys.forEach((key) => {
      aliases.set(key, item);
      aliases.set(key.toLowerCase(), item);
    });
  });
  return aliases;
}

function createAnswerKeyRecordFromMapEntry(rawKey, rawValue, options = {}) {
  const itemAliases = options.itemAliases || new Map();
  const rawKeyString = normalizeString(rawKey, '');
  const fallbackItem = itemAliases.get(rawKeyString) || itemAliases.get(rawKeyString.toLowerCase()) || null;
  if (isReadableObject(rawValue)) {
    const record = normalizeAnswerKeyRecord(rawValue, {
      examIdentity: options.examIdentity,
      fallback: fallbackItem || { questionId: rawKeyString },
      blockNumber: fallbackItem && fallbackItem.blockNumber,
      index: fallbackItem && fallbackItem.itemIndex,
      captureSource: options.captureSource,
    });
    if (record) {
      return Object.freeze({
        ...record,
        questionId: record.questionId || rawKeyString,
        componentId: record.componentId || (fallbackItem && fallbackItem.componentId) || '',
        medleyId: record.medleyId || (fallbackItem && fallbackItem.medleyId) || '',
        blockNumber: record.blockNumber || (fallbackItem && fallbackItem.blockNumber) || 0,
        itemIndex: record.itemIndex || (fallbackItem && fallbackItem.itemIndex) || 0,
      });
    }
  }

  const correctAnswerId = resolveAnswerIdFromCandidate(rawValue, []);
  if (!correctAnswerId) {
    return null;
  }

  return Object.freeze({
    questionId: (fallbackItem && fallbackItem.questionId) || rawKeyString,
    componentId: (fallbackItem && fallbackItem.componentId) || '',
    medleyId: (fallbackItem && fallbackItem.medleyId) || '',
    blockNumber: (fallbackItem && fallbackItem.blockNumber) || 0,
    itemIndex: (fallbackItem && fallbackItem.itemIndex) || 0,
    correctAnswerId,
    selectedAnswerId: fallbackItem && fallbackItem.selectedAnswerId ? fallbackItem.selectedAnswerId : '',
    choices: Object.freeze([]),
    identitySource: fallbackItem ? fallbackItem.identitySource : 'map-key',
    captureSource: options.captureSource || ANSWER_KEY_CAPTURE_SOURCE.UNAVAILABLE,
    capturedAt: nowIso(),
    confidence: fallbackItem || rawKeyString.startsWith('webfred:') ? 'high' : 'medium',
    contentHash: stableHashString(`${rawKeyString}:${correctAnswerId}`),
  });
}

function maybeCollectAnswerKeyMapEntries(value, options, records) {
  if (!isReadableObject(value) || Array.isArray(value) || isDomElement(value) || isProbablyQuestionRecord(value)) {
    return 0;
  }

  let added = 0;
  safeOwnKeys(value).forEach((key) => {
    if (!shouldScanAnswerKeyProperty(key)) {
      return;
    }
    let rawValue;
    try {
      rawValue = value[key];
    } catch (_error) {
      rawValue = null;
    }
    if (rawValue === null || rawValue === undefined || typeof rawValue === 'function') {
      return;
    }
    const containerLooksLikeKey = /correct|key|solution|expected/i.test(normalizeString(options.semanticHint, ''));
    const valueHasExplicitKey = isReadableObject(rawValue) && (hasAnswerKeyFields(rawValue) || hasChoiceCollectionFields(rawValue) || isProbablyAnswerChoiceRecord(rawValue));
    const keyLooksLikeQuestion = key.startsWith('webfred:')
      || (options.itemAliases && options.itemAliases.has(key))
      || /question|item|component|medley/i.test(key)
      || (containerLooksLikeKey && !/status|count|total|length|version|date|time|source/i.test(key));
    const valueLooksLikeAnswer = !isReadableObject(rawValue) || valueHasExplicitKey;
    if (!keyLooksLikeQuestion || !valueLooksLikeAnswer || (!containerLooksLikeKey && !valueHasExplicitKey)) {
      return;
    }
    const record = createAnswerKeyRecordFromMapEntry(key, rawValue, options);
    if (record) {
      records.push(record);
      added += 1;
    }
  });
  return added;
}

function collectAnswerKeyRecordsFromValue(rootValue, options = {}) {
  const records = [];
  const queue = [{ value: rootValue, depth: 0, fallback: options.fallback || null, semanticHint: options.semanticHint || '' }];
  const seen = [];
  let scanned = 0;
  const maxDepth = coercePositiveInteger(options.maxDepth, ANSWER_KEY_CAPTURE_CONFIG.MAX_SCAN_DEPTH);
  const maxObjects = coercePositiveInteger(options.maxObjects, ANSWER_KEY_CAPTURE_CONFIG.MAX_SCAN_OBJECTS);

  while (queue.length && scanned < maxObjects) {
    const current = queue.shift();
    if (!current || current.value === null || current.value === undefined) {
      continue;
    }

    const value = current.value;
    if (isReadableObject(value)) {
      if (seen.includes(value) || isDomElement(value)) {
        continue;
      }
      seen.push(value);
      scanned += 1;
    }

    if (Array.isArray(value)) {
      valueToArray(value).forEach((entry, index) => {
        const fallbackItem = options.itemList && options.itemList[index] ? options.itemList[index] : null;
        if (isProbablyQuestionRecord(entry) || hasAnswerKeyFields(entry) || hasChoiceCollectionFields(entry)) {
          const record = normalizeAnswerKeyRecord(entry, {
            examIdentity: options.examIdentity,
            fallback: fallbackItem,
            blockNumber: fallbackItem && fallbackItem.blockNumber,
            index: fallbackItem ? fallbackItem.itemIndex : index + 1,
            captureSource: options.captureSource,
          });
          if (record) {
            records.push(record);
          }
        }
        if (isReadableObject(entry) && current.depth < maxDepth) {
          queue.push({ value: entry, depth: current.depth + 1, fallback: fallbackItem, semanticHint: current.semanticHint });
        }
      });
      continue;
    }

    if (isProbablyQuestionRecord(value)) {
      const record = normalizeAnswerKeyRecord(value, {
        examIdentity: options.examIdentity,
        fallback: current.fallback,
        blockNumber: current.fallback && current.fallback.blockNumber,
        index: current.fallback && current.fallback.itemIndex,
        captureSource: options.captureSource,
      });
      if (record) {
        records.push(record);
      }
    } else {
      maybeCollectAnswerKeyMapEntries(value, { ...options, semanticHint: current.semanticHint }, records);
    }

    if (!isReadableObject(value) || current.depth >= maxDepth) {
      continue;
    }

    safeOwnKeys(value).forEach((key) => {
      if (!shouldScanAnswerKeyProperty(key)) {
        return;
      }
      let child;
      try {
        child = value[key];
      } catch (_error) {
        child = null;
      }
      if (child === null || child === undefined || typeof child === 'function' || isDomElement(child)) {
        return;
      }
      if (isReadableObject(child) || Array.isArray(child)) {
        queue.push({ value: child, depth: current.depth + 1, fallback: current.fallback, semanticHint: key || current.semanticHint });
      }
    });
  }

  return records;
}

function getElementAnswerId(element, index = 0) {
  if (!element) {
    return '';
  }
  return firstNonEmpty([
    safeAttribute(element, 'value'),
    safeAttribute(element, 'id'),
    safeAttribute(element, 'name') && `${safeAttribute(element, 'name')}:${safeAttribute(element, 'value')}`,
    safeDatasetValue(element, 'optionId'),
    safeDatasetValue(element, 'answerId'),
    safeDatasetValue(element, 'choiceId'),
    index ? `option-${index}` : '',
  ]);
}

function readBooleanAttribute(element, attributeNames) {
  if (!element) {
    return null;
  }
  for (const attributeName of attributeNames) {
    const direct = safeAttribute(element, attributeName);
    const datasetKey = attributeName.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const dataValue = safeDatasetValue(element, datasetKey);
    const normalized = normalizeMaybeBoolean(direct || dataValue);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function elementHasCorrectAnswerMetadata(element) {
  if (!element) {
    return false;
  }
  const booleanFlag = readBooleanAttribute(element, [
    'data-correct', 'data-is-correct', 'data-correct-answer', 'data-answer-correct',
    'data-key', 'data-keyed', 'data-is-key', 'correct',
  ]);
  if (booleanFlag !== null) {
    return booleanFlag;
  }
  const textMetadata = [
    safeAttribute(element, 'class'),
    safeAttribute(element, 'aria-label'),
    safeAttribute(element, 'title'),
    safeAttribute(element, 'data-ng-class'),
    safeAttribute(element, 'ng-class'),
  ].join(' ').toLowerCase();
  return /(^|[\s{,'"_-])correct($|[\s},'"_-])/.test(textMetadata)
    && !/(^|[\s{,'"_-])incorrect($|[\s},'"_-])/.test(textMetadata);
}

function readCorrectAnswerIdFromElementAttributes(root, choices = []) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return '';
  }
  const candidates = [root, ...Array.from(root.querySelectorAll('[data-correct-answer], [data-answer-key], [data-keyed-answer], [data-correct-response], [data-correct-option], [data-correct-choice]'))];
  for (const element of candidates) {
    const direct = firstNonEmpty([
      safeAttribute(element, 'data-correct-answer'),
      safeAttribute(element, 'data-answer-key'),
      safeAttribute(element, 'data-keyed-answer'),
      safeAttribute(element, 'data-correct-response'),
      safeAttribute(element, 'data-correct-option'),
      safeAttribute(element, 'data-correct-choice'),
      safeDatasetValue(element, 'correctAnswer'),
      safeDatasetValue(element, 'answerKey'),
      safeDatasetValue(element, 'keyedAnswer'),
      safeDatasetValue(element, 'correctResponse'),
      safeDatasetValue(element, 'correctOption'),
      safeDatasetValue(element, 'correctChoice'),
    ]);
    if (normalizeMaybeBoolean(direct) !== null) {
      continue;
    }
    const resolved = resolveAnswerIdFromCandidate(direct, choices);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

function extractAnswerKeyRecordFromDomRoot(root, adapterDocument, adapterWindow, options = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return null;
  }
  const identity = extractQuestionIdentityFromDom(root, adapterDocument, adapterWindow);
  const choices = extractChoicesFromDom(root);
  const optionRows = Array.from(root.querySelectorAll('ol.options > li.stContext, li.stContext'));
  let correctAnswerId = readCorrectAnswerIdFromElementAttributes(root, choices);

  if (!correctAnswerId) {
    optionRows.some((row, index) => {
      const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
      if (elementHasCorrectAnswerMetadata(row) || elementHasCorrectAnswerMetadata(input)) {
        correctAnswerId = getElementAnswerId(input || row, index + 1);
        return true;
      }
      return false;
    });
  }

  if (!correctAnswerId) {
    return null;
  }

  return Object.freeze({
    questionId: identity.questionId || (options.fallback && options.fallback.questionId) || '',
    componentId: identity.componentId || (options.fallback && options.fallback.componentId) || '',
    medleyId: identity.medleyId || (options.fallback && options.fallback.medleyId) || '',
    blockNumber: identity.blockNumber || (options.fallback && options.fallback.blockNumber) || 0,
    itemIndex: identity.itemIndex || (options.fallback && options.fallback.itemIndex) || 0,
    correctAnswerId,
    selectedAnswerId: (options.fallback && options.fallback.selectedAnswerId) || extractSelectedAnswerIdFromDom(root) || '',
    choices: Object.freeze(choices),
    identitySource: identity.identitySource,
    captureSource: ANSWER_KEY_CAPTURE_SOURCE.DOM_CURRENT_ITEM,
    capturedAt: nowIso(),
    confidence: identity.questionId ? 'high' : 'medium',
    contentHash: stableHashString(`${identity.questionId}:${correctAnswerId}:${root.innerHTML.length}`),
  });
}

function parseHtmlFragmentForAnswerKey(rawHtml, adapterDocument) {
  const html = normalizeString(rawHtml, '');
  if (!html || html.length > ANSWER_KEY_CAPTURE_CONFIG.MAX_HTML_PARSE_CHARS || !adapterDocument) {
    return null;
  }
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<div id="f120-html-fragment-root">${html}</div>`, 'text/html');
    return parsed.querySelector('#f120-html-fragment-root');
  } catch (_error) {
    try {
      const template = adapterDocument.createElement('template');
      template.innerHTML = html;
      return template.content && template.content.firstElementChild ? template.content.firstElementChild : null;
    } catch (_nestedError) {
      return null;
    }
  }
}

function normalizeKeyPageAnswerId(value) {
  const normalized = normalizeAnswerKeyString(value).toUpperCase();
  return /^[A-H]$/.test(normalized) ? normalized : '';
}

function addParsedKeyPagePair(pairs, seen, itemIndex, answerId) {
  const normalizedIndex = coercePositiveInteger(itemIndex, 0);
  const normalizedAnswerId = normalizeKeyPageAnswerId(answerId);
  if (!normalizedIndex || !normalizedAnswerId || seen.has(normalizedIndex)) {
    return;
  }
  seen.add(normalizedIndex);
  pairs.push(Object.freeze({ itemIndex: normalizedIndex, correctAnswerId: normalizedAnswerId }));
}

function parseAnswerKeyPairsFromText(text) {
  const normalizedText = normalizeString(text, '').replace(/\u00a0/g, ' ').replace(/[：]/g, ':');
  if (!normalizedText || !/\b(?:key|answer|correct|\d+\s*[.)\]:-]\s*[A-H])\b/i.test(normalizedText)) {
    return [];
  }
  const pairs = [];
  const seen = new Set();
  const compactText = normalizedText.replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:^|[^\d])(?:q(?:uestion)?\s*)?(\d{1,3})\s*(?:[.)\]:-]|\s)\s*(?:answer\s*)?([A-H])(?=$|[^A-Za-z])/gi,
    /(?:^|[^\d])(?:q(?:uestion)?\s*)?(\d{1,3})\s+(?:correct\s+answer|answer|key)\s*(?:is|=|:|-)?\s*([A-H])(?=$|[^A-Za-z])/gi,
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(compactText)) !== null) {
      addParsedKeyPagePair(pairs, seen, match[1], match[2]);
    }
  });
  return pairs.sort((left, right) => left.itemIndex - right.itemIndex);
}

function parseAnswerKeyPairsFromRoot(root) {
  if (!root) {
    return [];
  }
  const pairs = [];
  const seen = new Set();
  const addPairs = (text) => {
    parseAnswerKeyPairsFromText(text).forEach((pair) => {
      addParsedKeyPagePair(pairs, seen, pair.itemIndex, pair.correctAnswerId);
    });
  };
  addPairs(root.textContent || '');
  if (typeof root.querySelectorAll === 'function') {
    Array.from(root.querySelectorAll('tr, li, p, div, span')).forEach((element) => addPairs(element.textContent || ''));
  }
  return pairs.sort((left, right) => left.itemIndex - right.itemIndex);
}

function isCurrentNavigationElement(element) {
  if (!element) {
    return false;
  }
  const className = normalizeString(element.className, '').toLowerCase();
  return className.includes('currentitem') || className.includes('current') || safeAttribute(element, 'aria-current') === 'true';
}

function addUniqueDomRoot(roots, root) {
  if (root && !roots.includes(root)) {
    roots.push(root);
  }
}

function collectKeyPageRoots(adapterDocument) {
  const roots = [];
  const keyNavigationItem = findKeyNavigationItem(adapterDocument);
  addUniqueDomRoot(roots, keyNavigationItem);
  if (keyNavigationItem && isCurrentNavigationElement(keyNavigationItem) && adapterDocument && typeof adapterDocument.querySelector === 'function') {
    ['article#content', 'section#item', 'main', 'body'].forEach((selector) => addUniqueDomRoot(roots, adapterDocument.querySelector(selector)));
  }
  if (adapterDocument && typeof adapterDocument.querySelectorAll === 'function') {
    Array.from(adapterDocument.querySelectorAll('[id*="key"], [id*="Key"], [class*="key"], [class*="Key"], [aria-label*="Key"], [title*="Key"]'))
      .forEach((element) => addUniqueDomRoot(roots, element));
  }
  return roots;
}

function createAnswerKeyRecordFromKeyPagePair(pair, adapterState, adapterWindow, adapterDocument, rootIndex = 0, captureSource = ANSWER_KEY_CAPTURE_SOURCE.DOM_KEY_PAGE) {
  const itemList = adapterState && Array.isArray(adapterState.itemList) ? adapterState.itemList : [];
  const fallback = itemList[pair.itemIndex - 1] || null;
  const examIdentity = adapterState && adapterState.examIdentity ? adapterState.examIdentity : extractExamIdentityFromDom(adapterDocument, adapterWindow);
  const identity = fallback || buildQuestionIdentity({
    examProgram: examIdentity && examIdentity.program,
    examName: examIdentity && examIdentity.examName,
    examSection: examIdentity && examIdentity.section,
    blockNumber: (adapterState && adapterState.currentBlock) || 1,
    itemIndex: pair.itemIndex,
    itemId: pair.itemIndex,
  });
  const questionId = normalizeString(identity.questionId, '');
  return Object.freeze({
    questionId,
    componentId: normalizeString(identity.componentId, ''),
    medleyId: normalizeString(identity.medleyId, ''),
    blockNumber: coercePositiveInteger(identity.blockNumber, (adapterState && adapterState.currentBlock) || 0),
    itemIndex: pair.itemIndex,
    correctAnswerId: pair.correctAnswerId,
    selectedAnswerId: normalizeString(identity.selectedAnswerId, ''),
    choices: Object.freeze([]),
    identitySource: normalizeString(identity.identitySource, fallback ? 'item-list' : 'key-page-index'),
    captureSource,
    capturedAt: nowIso(),
    confidence: questionId ? 'high' : 'medium',
    contentHash: stableHashString(`key-page:${rootIndex}:${pair.itemIndex}:${pair.correctAnswerId}:${questionId}`),
  });
}

function collectDomKeyPageAnswerKeyRecords(adapterWindow, adapterDocument, adapterState) {
  const records = [];
  collectKeyPageRoots(adapterDocument).forEach((root, rootIndex) => {
    parseAnswerKeyPairsFromRoot(root).forEach((pair) => {
      records.push(createAnswerKeyRecordFromKeyPagePair(pair, adapterState, adapterWindow, adapterDocument, rootIndex));
    });
  });
  return records;
}

function collectDomAnswerKeyRecords(adapterWindow, adapterDocument, adapterState) {
  const records = [];
  records.push(...collectDomKeyPageAnswerKeyRecords(adapterWindow, adapterDocument, adapterState));

  const currentRoot = findCurrentDomItemRoot(adapterDocument, adapterWindow);
  const currentRecord = extractAnswerKeyRecordFromDomRoot(currentRoot, adapterDocument, adapterWindow, {
    fallback: adapterState && adapterState.currentItem,
  });
  if (currentRecord) {
    records.push(currentRecord);
  }

  const currentContent = adapterState && adapterState.currentContent ? adapterState.currentContent : null;
  if (currentContent) {
    [currentContent.renderedHtml, currentContent.answerBoxHtml, currentContent.promptHtml].forEach((html) => {
      const parsedRoot = parseHtmlFragmentForAnswerKey(html, adapterDocument);
      const parsedRecord = parsedRoot ? extractAnswerKeyRecordFromDomRoot(parsedRoot, adapterDocument, adapterWindow, {
        fallback: adapterState && adapterState.currentItem,
      }) : null;
      if (parsedRecord) {
        records.push(parsedRecord);
      }
    });
  }

  return records;
}

function looksLikeAnswerKeyHtmlString(value, key = '') {
  const html = normalizeString(value, '');
  if (!html || html.length > ANSWER_KEY_CAPTURE_CONFIG.MAX_HTML_PARSE_CHARS || !/[<][a-zA-Z]/.test(html)) {
    return false;
  }
  return /correct|answer[-_\s]*key|keyed|NBOptionInput|stContext|ol\.options|data-answer|data-key/i.test(`${key} ${html}`);
}

function stripHtmlForAnswerKeyText(value) {
  return normalizeString(value, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeAnswerKeyPageHtmlString(value, key = '') {
  const text = stripHtmlForAnswerKeyText(value);
  if (!text || !/(?:answer[-_\s]*key|\bkey\b)/i.test(`${key} ${text}`)) {
    return false;
  }
  return /(?:^|[^\d])(?:q(?:uestion)?\s*)?\d{1,3}\s*(?:[.)\]:-]|\s)\s*(?:answer\s*)?[A-H](?=$|[^A-Za-z])/i.test(text);
}

function collectHtmlAnswerKeyRecordsFromValue(rootValue, adapterWindow, adapterDocument, adapterState, options = {}) {
  const records = [];
  const itemList = adapterState && Array.isArray(adapterState.itemList) ? adapterState.itemList : [];
  const queue = [{ value: rootValue, depth: 0, fallback: options.fallback || null, key: '' }];
  const seen = [];
  let scanned = 0;
  const maxDepth = coercePositiveInteger(options.maxDepth, 3);
  const maxObjects = coercePositiveInteger(options.maxObjects, 400);

  while (queue.length && scanned < maxObjects) {
    const current = queue.shift();
    if (!current || current.value === null || current.value === undefined) {
      continue;
    }

    if (typeof current.value === 'string') {
      if (looksLikeAnswerKeyHtmlString(current.value, current.key)) {
        const parsedRoot = parseHtmlFragmentForAnswerKey(current.value, adapterDocument);
        if (looksLikeAnswerKeyPageHtmlString(current.value, current.key)) {
          parseAnswerKeyPairsFromText(stripHtmlForAnswerKeyText(current.value)).forEach((pair, pairIndex) => {
            records.push(createAnswerKeyRecordFromKeyPagePair(
              pair,
              adapterState,
              adapterWindow,
              adapterDocument,
              pairIndex,
              options.captureSource || ANSWER_KEY_CAPTURE_SOURCE.ANGULAR_BULK
            ));
          });
        }
        const parsedRecord = parsedRoot ? extractAnswerKeyRecordFromDomRoot(parsedRoot, adapterDocument, adapterWindow, {
          fallback: current.fallback,
        }) : null;
        if (parsedRecord) {
          records.push(Object.freeze({
            ...parsedRecord,
            captureSource: options.captureSource || parsedRecord.captureSource,
          }));
        }
      }
      continue;
    }

    if (!isReadableObject(current.value) || isDomElement(current.value) || seen.includes(current.value)) {
      continue;
    }
    seen.push(current.value);
    scanned += 1;

    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => {
        const fallback = itemList[index] || current.fallback;
        if (typeof entry === 'string' || isReadableObject(entry)) {
          queue.push({ value: entry, depth: current.depth + 1, fallback, key: String(index + 1) });
        }
      });
      continue;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    safeOwnKeys(current.value).forEach((key) => {
      if (!shouldScanAnswerKeyProperty(key)) {
        return;
      }
      let child;
      try {
        child = current.value[key];
      } catch (_error) {
        child = null;
      }
      if (typeof child === 'string' || (isReadableObject(child) && !isDomElement(child))) {
        queue.push({ value: child, depth: current.depth + 1, fallback: current.fallback, key });
      }
    });
  }

  return records;
}

function scoreAnswerKeyRecord(record) {
  if (!record || !record.correctAnswerId) {
    return 0;
  }
  const confidenceScore = record.confidence === 'high' ? 40 : (record.confidence === 'medium' ? 25 : 10);
  const sourceScore = (() => {
    if (record.captureSource === ANSWER_KEY_CAPTURE_SOURCE.ANGULAR_BULK) {
      return 15;
    }
    if (record.captureSource === ANSWER_KEY_CAPTURE_SOURCE.DOM_KEY_PAGE) {
      return 12;
    }
    return 5;
  })();
  const identityScore = record.questionId ? 20 : (record.componentId || record.medleyId ? 10 : 0);
  const choiceScore = Array.isArray(record.choices) && record.choices.length ? 5 : 0;
  return confidenceScore + sourceScore + identityScore + choiceScore;
}

function matchAnswerKeyRecordToItem(record, itemAliases) {
  if (!record || !itemAliases) {
    return null;
  }
  const keys = uniqueNormalizedStrings([
    record.questionId,
    record.componentId,
    record.medleyId,
    record.itemIndex ? String(record.itemIndex) : '',
    record.blockNumber && record.itemIndex ? `${record.blockNumber}:${record.itemIndex}` : '',
  ]);
  for (const key of keys) {
    const match = itemAliases.get(key);
    if (match) {
      return match;
    }
  }
  return null;
}

function canonicalizeAnswerKeyRecord(record, adapterState, itemAliases) {
  if (!record || !record.correctAnswerId) {
    return null;
  }
  const matchedItem = matchAnswerKeyRecordToItem(record, itemAliases);
  const questionId = normalizeString(
    (matchedItem && matchedItem.questionId) || record.questionId || record.componentId || record.medleyId || (record.itemIndex ? `item:${record.itemIndex}` : ''),
    ''
  );
  if (!questionId) {
    return null;
  }
  return Object.freeze({
    ...record,
    questionId,
    componentId: record.componentId || (matchedItem && matchedItem.componentId) || '',
    medleyId: record.medleyId || (matchedItem && matchedItem.medleyId) || '',
    blockNumber: record.blockNumber || (matchedItem && matchedItem.blockNumber) || 0,
    itemIndex: record.itemIndex || (matchedItem && matchedItem.itemIndex) || 0,
    captureSource: record.captureSource || ANSWER_KEY_CAPTURE_SOURCE.UNAVAILABLE,
    examIdentity: Object.freeze(adapterState && adapterState.examIdentity ? adapterState.examIdentity : {}),
  });
}

function mergeAnswerKeyRecords(rawRecords, adapterState) {
  const itemAliases = buildAnswerKeyItemAliasMap(adapterState);
  const byQuestionId = new Map();
  const allRecords = [];
  (Array.isArray(rawRecords) ? rawRecords : []).forEach((record) => {
    const canonical = canonicalizeAnswerKeyRecord(record, adapterState, itemAliases);
    if (!canonical) {
      return;
    }
    allRecords.push(canonical);
    const existing = byQuestionId.get(canonical.questionId);
    if (!existing || scoreAnswerKeyRecord(canonical) > scoreAnswerKeyRecord(existing)) {
      byQuestionId.set(canonical.questionId, canonical);
    }
  });
  return Object.freeze({
    records: Object.freeze(Array.from(byQuestionId.values()).sort((left, right) => {
      const leftIndex = left.itemIndex || Number.MAX_SAFE_INTEGER;
      const rightIndex = right.itemIndex || Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.questionId.localeCompare(right.questionId);
    })),
    allRecords: Object.freeze(allRecords),
  });
}

function getAnswerKeyCaptureFailureReason(status, source, knownCount, expectedCount, allRecordCount, adapterState, options = {}) {
  if (status !== ANSWER_KEY_CAPTURE_STATUS.FAILED) {
    return '';
  }
  if (normalizeString(options.lastError, '')) {
    return 'capture-error';
  }
  if (allRecordCount > 0 && knownCount === 0) {
    return 'answer-key-identity-mismatch';
  }
  if (expectedCount > 0 && knownCount === 0 && allRecordCount === 0) {
    return 'no-correct-answer-metadata';
  }
  if (adapterState && normalizeString(adapterState.status, '') === WEBFRED_ADAPTER_STATUS.UNAVAILABLE) {
    return 'webfred-state-unavailable';
  }
  if (source === ANSWER_KEY_CAPTURE_SOURCE.UNAVAILABLE) {
    return 'answer-key-source-unavailable';
  }
  return 'no-answer-keys-captured';
}

function describeAnswerKeyCaptureFailure(reason) {
  switch (reason) {
    case 'capture-error':
      return 'capture error';
    case 'webfred-state-unavailable':
      return 'WebFRED state unavailable';
    case 'no-correct-answer-metadata':
      return 'no correct-answer metadata detected';
    case 'answer-key-identity-mismatch':
      return 'captured key records did not match current item identities';
    case 'answer-key-source-unavailable':
      return 'answer-key source unavailable';
    case 'no-answer-keys-captured':
      return 'no answer keys captured';
    default:
      return '';
  }
}

function summarizeAnswerKeyCapture(mergedRecords, adapterState, options = {}) {
  const records = mergedRecords && Array.isArray(mergedRecords.records) ? mergedRecords.records : [];
  const allRecordCount = mergedRecords && Array.isArray(mergedRecords.allRecords) ? mergedRecords.allRecords.length : records.length;
  const itemList = adapterState && Array.isArray(adapterState.itemList) ? adapterState.itemList : [];
  const expectedCount = coercePositiveInteger(
    options.expectedCount,
    itemList.length || (adapterState && adapterState.itemCount) || records.length || 0
  );
  const itemQuestionIds = new Set(itemList.map((item) => normalizeString(item.questionId, '')).filter(Boolean));
  const knownCount = itemQuestionIds.size
    ? records.filter((record) => itemQuestionIds.has(record.questionId)).length
    : records.length;
  const unknownCount = Math.max(0, expectedCount - knownCount);
  const sources = uniqueNormalizedStrings(records.map((record) => record.captureSource));
  const source = sources.length > 1
    ? ANSWER_KEY_CAPTURE_SOURCE.MIXED
    : (sources[0] || ANSWER_KEY_CAPTURE_SOURCE.UNAVAILABLE);
  const status = (() => {
    if (expectedCount > 0 && knownCount >= expectedCount) {
      return ANSWER_KEY_CAPTURE_STATUS.COMPLETE;
    }
    if (knownCount > 0) {
      return ANSWER_KEY_CAPTURE_STATUS.PARTIAL;
    }
    return ANSWER_KEY_CAPTURE_STATUS.FAILED;
  })();
  const failureReason = getAnswerKeyCaptureFailureReason(status, source, knownCount, expectedCount, allRecordCount, adapterState, options);

  return Object.freeze({
    status,
    source,
    sources: Object.freeze(sources),
    expectedCount,
    knownCount,
    unknownCount,
    recordCount: records.length,
    allRecordCount,
    adapterStatus: normalizeString(adapterState && adapterState.status, ''),
    adapterSource: normalizeString(adapterState && adapterState.source, ''),
    adapterDegradedReasons: Object.freeze(Array.isArray(adapterState && adapterState.degradedReasons)
      ? adapterState.degradedReasons.map((reason) => normalizeString(reason, '')).filter(Boolean)
      : []),
    failureReason,
    failureDetail: describeAnswerKeyCaptureFailure(failureReason),
    capturedAt: nowIso(),
    retryCount: coercePositiveInteger(options.retryCount, 0),
    maxAutoRetries: ANSWER_KEY_CAPTURE_CONFIG.MAX_AUTO_RETRIES,
    manual: Boolean(options.manual),
    noNavigation: true,
    noAnswerMutation: true,
    noSubmit: true,
  });
}

function createAnswerKeyCaptureResult(rawRecords, adapterState, options = {}) {
  const merged = mergeAnswerKeyRecords(rawRecords, adapterState);
  const summary = summarizeAnswerKeyCapture(merged, adapterState, options);
  const correctAnswers = {};
  merged.records.forEach((record) => {
    correctAnswers[record.questionId] = record.correctAnswerId;
  });

  return Object.freeze({
    attemptId: normalizeString(options.attemptId, ''),
    startedAt: options.startedAt || summary.capturedAt,
    completedAt: summary.capturedAt,
    summary,
    correctAnswers: Object.freeze(correctAnswers),
    records: merged.records,
    allRecordCount: merged.allRecords.length,
    lastError: normalizeString(options.lastError, ''),
  });
}

async function persistAnswerKeyCaptureResult(storage, result, logger) {
  const attemptId = normalizeString(result && result.attemptId, '');
  if (!storage || !attemptId || !result) {
    return null;
  }
  try {
    const existing = await storage.getAttempt(attemptId);
    if (!existing) {
      return null;
    }
    const updatedCorrectAnswers = {
      ...(existing.correctAnswers || {}),
      ...(result.correctAnswers || {}),
    };
    const patch = {
      correctAnswers: updatedCorrectAnswers,
      answerKeyCapture: {
        ...(existing.answerKeyCapture || {}),
        ...result.summary,
        lastError: result.lastError || '',
        updatedAt: nowIso(),
      },
    };
    if (existing.status && existing.status !== ATTEMPT_STATUS.IN_PROGRESS) {
      patch.scoreSummary = buildAttemptScoreSummary({
        ...existing,
        correctAnswers: updatedCorrectAnswers,
      }, {
        reason: 'answer-key-capture-rescore',
      });
    }
    return await storage.updateAttempt(attemptId, patch);
  } catch (error) {
    if (logger) {
      logger.warn('Answer-key capture result could not be persisted.', error);
    }
    return null;
  }
}

function timeoutPromise(adapterWindow, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    const timer = adapterWindow && typeof adapterWindow.setTimeout === 'function' ? adapterWindow.setTimeout : setTimeout;
    timer(() => resolve(fallbackValue), timeoutMs);
  });
}

async function resolveMaybePromise(value, adapterWindow, timeoutMs, fallbackValue = undefined) {
  if (!value || typeof value.then !== 'function') {
    return value;
  }
  return Promise.race([
    Promise.resolve(value).catch(() => fallbackValue),
    timeoutPromise(adapterWindow, timeoutMs, fallbackValue),
  ]);
}

function collectReadOnlyMethodCandidates(roots, options = {}) {
  const queue = (Array.isArray(roots) ? roots : [])
    .filter((value) => isReadableObject(value) && !isDomElement(value))
    .map((value) => ({ value, depth: 0 }));
  const seen = [];
  const methods = [];
  let scanned = 0;
  const maxDepth = coercePositiveInteger(options.maxDepth, 2);
  const maxObjects = coercePositiveInteger(options.maxObjects, 120);
  const maxMethods = coercePositiveInteger(options.maxMethods, ANSWER_KEY_CAPTURE_CONFIG.MAX_READ_ONLY_METHOD_CALLS);

  while (queue.length && scanned < maxObjects && methods.length < maxMethods) {
    const current = queue.shift();
    if (!current || !isReadableObject(current.value) || isDomElement(current.value) || seen.includes(current.value)) {
      continue;
    }
    seen.push(current.value);
    scanned += 1;

    safeOwnKeys(current.value).forEach((key) => {
      if (methods.length >= maxMethods || !shouldScanAnswerKeyProperty(key)) {
        return;
      }
      let child;
      try {
        child = current.value[key];
      } catch (_error) {
        child = null;
      }
      if (typeof child === 'function') {
        if (child.length === 0 && isReadOnlyMethodName(key)) {
          methods.push(Object.freeze({ name: key, fn: child, thisArg: current.value }));
        }
        return;
      }
      if (current.depth < maxDepth && isReadableObject(child) && !isDomElement(child) && !seen.includes(child)) {
        queue.push({ value: child, depth: current.depth + 1 });
      }
    });
  }

  return methods;
}

async function collectBulkContentAnswerKeyRecords(adapterWindow, adapterDocument, adapterState, roots, options = {}, logger) {
  const records = [];
  const seen = [];
  const candidates = (Array.isArray(roots) ? roots : []).filter((root) => {
    if (!isReadableObject(root) || isDomElement(root)) {
      return false;
    }
    let method;
    try {
      method = root.getContentBulk;
    } catch (_error) {
      method = null;
    }
    if (typeof method !== 'function' || method.length !== 0 || seen.some((entry) => entry.root === root || entry.method === method)) {
      return false;
    }
    seen.push({ root, method });
    return true;
  });

  for (const service of candidates) {
    try {
      const invoked = service.getContentBulk.call(service);
      const bulkContent = await resolveMaybePromise(
        invoked,
        adapterWindow,
        ANSWER_KEY_CAPTURE_CONFIG.BULK_CONTENT_TIMEOUT_MS,
        undefined
      );
      if (bulkContent !== undefined && bulkContent !== null && bulkContent !== service && !isDomElement(bulkContent)) {
        records.push(...collectHtmlAnswerKeyRecordsFromValue(bulkContent, adapterWindow, adapterDocument, adapterState, options));
      }
    } catch (error) {
      if (logger) {
        logger.debug('Bulk content answer-key capture failed.', error);
      }
    }
  }

  return records;
}

async function collectReadOnlyMethodResults(adapterWindow, roots, logger) {
  const results = [];
  const methods = collectReadOnlyMethodCandidates(roots);
  for (const method of methods) {
    try {
      const invoked = method.fn.call(method.thisArg);
      const value = await resolveMaybePromise(
        invoked,
        adapterWindow,
        ANSWER_KEY_CAPTURE_CONFIG.READ_ONLY_METHOD_TIMEOUT_MS,
        undefined
      );
      if (value !== undefined && value !== null && value !== method.thisArg && !isDomElement(value)) {
        results.push(Object.freeze({ name: method.name, value }));
      }
    } catch (error) {
      if (logger) {
        logger.debug('Read-only answer-key method candidate failed.', method.name, error);
      }
    }
  }
  return results;
}

async function collectAngularAnswerKeyRecords(adapterWindow, adapterDocument, angularServices, adapterState, logger) {
  if (!angularServices || !angularServices.services) {
    return [];
  }

  const serviceValues = Object.values(angularServices.services).filter(Boolean);
  const roots = uniqueReadableObjects([
    ...serviceValues,
    ...collectAngularStateRoots(angularServices),
    adapterState && adapterState.currentContent,
    adapterState && adapterState.raw,
  ]);
  const itemList = adapterState && Array.isArray(adapterState.itemList) ? adapterState.itemList : [];
  const itemAliases = buildAnswerKeyItemAliasMap(adapterState);
  const baseOptions = Object.freeze({
    examIdentity: adapterState && adapterState.examIdentity ? adapterState.examIdentity : extractExamIdentityFromDom(adapterDocument, adapterWindow),
    itemList,
    itemAliases,
    captureSource: ANSWER_KEY_CAPTURE_SOURCE.ANGULAR_BULK,
    maxDepth: ANSWER_KEY_CAPTURE_CONFIG.MAX_SCAN_DEPTH,
    maxObjects: ANSWER_KEY_CAPTURE_CONFIG.MAX_SCAN_OBJECTS,
  });

  const records = [];
  roots.forEach((root) => {
    records.push(...collectAnswerKeyRecordsFromValue(root, baseOptions));
    records.push(...collectHtmlAnswerKeyRecordsFromValue(root, adapterWindow, adapterDocument, adapterState, baseOptions));
  });
  records.push(...await collectBulkContentAnswerKeyRecords(adapterWindow, adapterDocument, adapterState, roots, baseOptions, logger));

  const methodResults = await collectReadOnlyMethodResults(adapterWindow, roots, logger);
  methodResults.forEach((result) => {
    records.push(...collectAnswerKeyRecordsFromValue(result.value, {
      ...baseOptions,
      semanticHint: result.name,
    }));
    records.push(...collectHtmlAnswerKeyRecordsFromValue(result.value, adapterWindow, adapterDocument, adapterState, {
      ...baseOptions,
      semanticHint: result.name,
    }));
  });

  return records;
}

function uniqueReadableObjects(values) {
  const seen = [];
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    if (!isReadableObject(value) || isDomElement(value) || seen.includes(value)) {
      return;
    }
    seen.push(value);
    result.push(value);
  });
  return result;
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

function createAnswerKeySafetySnapshot(adapterWindow, adapterState) {
  return Object.freeze({
    href: adapterWindow && adapterWindow.location ? normalizeString(adapterWindow.location.href, '') : '',
    answers: stableJsonStringify(adapterState && adapterState.answers ? adapterState.answers : {}),
  });
}

function verifyAnswerKeyCaptureSafety(beforeSnapshot, afterSnapshot) {
  if (!beforeSnapshot || !afterSnapshot) {
    return;
  }
  if (beforeSnapshot.href && afterSnapshot.href && beforeSnapshot.href !== afterSnapshot.href) {
    throw createAnswerKeyCaptureError('Answer-key capture safety check failed: navigation changed during capture.', {
      beforeHref: beforeSnapshot.href,
      afterHref: afterSnapshot.href,
    });
  }
  if (beforeSnapshot.answers !== afterSnapshot.answers) {
    throw createAnswerKeyCaptureError('Answer-key capture safety check failed: answer state changed during capture.', {
      beforeAnswersHash: stableHashString(beforeSnapshot.answers),
      afterAnswersHash: stableHashString(afterSnapshot.answers),
    });
  }
}

function isUsableAnswerKeyAdapterState(state) {
  return Boolean(state && (
    state.status === WEBFRED_ADAPTER_STATUS.READY
    || state.status === WEBFRED_ADAPTER_STATUS.DEGRADED
    || state.currentItem
    || (Array.isArray(state.itemList) && state.itemList.length)
  ));
}

function readFreshAdapterStateForCapture(adapter, fallbackState, logger) {
  if (!adapter || typeof adapter.readState !== 'function') {
    return fallbackState;
  }
  try {
    const freshState = adapter.readState();
    return isUsableAnswerKeyAdapterState(freshState) ? freshState : fallbackState;
  } catch (error) {
    if (logger) {
      logger.debug('Could not refresh WebFRED state before answer-key capture.', error);
    }
    return fallbackState;
  }
}

async function captureAnswerKeysOnce(options = {}) {
  const adapter = options.webfredAdapter;
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const logger = options.logger || createLogger(createSettingsStore(adapterWindow.localStorage, STORAGE_KEYS.SETTINGS));
  const startedAt = nowIso();
  if (!adapter) {
    throw createAnswerKeyCaptureError('WebFRED adapter is required for answer-key capture.');
  }

  const initializedState = options.adapterState || await adapter.waitForInitialization();
  const adapterState = readFreshAdapterStateForCapture(adapter, initializedState, logger);
  const beforeSafety = createAnswerKeySafetySnapshot(adapterWindow, adapterState);
  const angularServices = typeof adapter.getAngularServices === 'function' ? adapter.getAngularServices() : null;
  const angularRecords = await collectAngularAnswerKeyRecords(adapterWindow, adapterDocument, angularServices, adapterState, logger);
  const domRecords = collectDomAnswerKeyRecords(adapterWindow, adapterDocument, adapterState);
  const afterState = readFreshAdapterStateForCapture(adapter, adapterState, logger);
  verifyAnswerKeyCaptureSafety(beforeSafety, createAnswerKeySafetySnapshot(adapterWindow, afterState));
  return createAnswerKeyCaptureResult([...angularRecords, ...domRecords], afterState || adapterState, {
    attemptId: options.attemptId,
    startedAt,
    retryCount: options.retryCount,
    manual: options.manual,
    expectedCount: options.expectedCount,
  });
}

function getAnswerKeyRetryDelayMs(retryCount) {
  const normalizedRetryCount = Math.max(1, coercePositiveInteger(retryCount, 1));
  const exponential = ANSWER_KEY_CAPTURE_CONFIG.BASE_RETRY_DELAY_MS * (2 ** (normalizedRetryCount - 1));
  return Math.min(exponential, ANSWER_KEY_CAPTURE_CONFIG.MAX_RETRY_DELAY_MS);
}

async function persistPendingAnswerKeyCapture(storage, attemptId, retryCount, manual, logger) {
  const normalizedAttemptId = normalizeString(attemptId, '');
  if (!storage || !normalizedAttemptId) {
    return null;
  }
  try {
    const existing = await storage.getAttempt(normalizedAttemptId);
    if (!existing) {
      return null;
    }
    return await storage.updateAttempt(normalizedAttemptId, {
      answerKeyCapture: {
        ...(existing.answerKeyCapture || {}),
        status: ANSWER_KEY_CAPTURE_STATUS.PENDING,
        startedAt: nowIso(),
        retryCount: coercePositiveInteger(retryCount, 0),
        maxAutoRetries: ANSWER_KEY_CAPTURE_CONFIG.MAX_AUTO_RETRIES,
        manual: Boolean(manual),
        noNavigation: true,
        noAnswerMutation: true,
        noSubmit: true,
      },
    });
  } catch (error) {
    if (logger) {
      logger.warn('Pending answer-key capture status could not be persisted.', error);
    }
    return null;
  }
}

function waitForAnswerKeyRetryDelay(adapterWindow, retryCount) {
  const delayMs = getAnswerKeyRetryDelayMs(retryCount);
  return new Promise((resolve) => {
    const timer = adapterWindow && typeof adapterWindow.setTimeout === 'function' ? adapterWindow.setTimeout : setTimeout;
    timer(resolve, delayMs);
  });
}

function createFailedAnswerKeyCaptureResult(adapterState, options = {}, error = null) {
  return createAnswerKeyCaptureResult([], adapterState || createEmptyWebfredState('answer-key-capture-failed'), {
    attemptId: options.attemptId,
    startedAt: options.startedAt || nowIso(),
    retryCount: options.retryCount,
    manual: options.manual,
    expectedCount: options.expectedCount,
    lastError: error ? normalizeString(error.message || error, 'answer-key-capture-failed') : 'answer-key-capture-failed',
  });
}

function shouldRetryAnswerKeyCapture(result, retryCount, maxRetries) {
  if (!result || !result.summary) {
    return retryCount < maxRetries;
  }
  return !isAnswerKeyStatusComplete(result.summary.status) && retryCount < maxRetries;
}

function createAnswerKeyCaptureController(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const logger = options.logger || createLogger(createSettingsStore(adapterWindow.localStorage, STORAGE_KEYS.SETTINGS));
  const webfredAdapter = options.webfredAdapter;
  const storage = options.storage || null;
  let activeCapturePromise = null;
  let lastResult = null;
  let lastError = null;

  async function resolveCaptureAttemptId(captureOptions = {}) {
    const explicitAttemptId = normalizeString(captureOptions.attemptId, '');
    if (explicitAttemptId || !storage || typeof storage.listInProgressStates !== 'function') {
      return explicitAttemptId;
    }
    try {
      const states = await storage.listInProgressStates();
      const activeStates = (Array.isArray(states) ? states : []).filter((state) => normalizeString(state && state.attemptId, ''));
      return activeStates.length === 1 ? normalizeString(activeStates[0].attemptId, '') : '';
    } catch (error) {
      logger.debug('Could not infer attempt id for answer-key capture.', error);
      return '';
    }
  }

  async function runCaptureWithRetries(captureOptions = {}) {
    if (activeCapturePromise && !captureOptions.forceNew) {
      return activeCapturePromise;
    }

    const maxRetries = coercePositiveInteger(captureOptions.maxRetries, ANSWER_KEY_CAPTURE_CONFIG.MAX_AUTO_RETRIES);
    const startedAt = nowIso();
    const manual = Boolean(captureOptions.manual);

    activeCapturePromise = (async () => {
      const attemptId = await resolveCaptureAttemptId(captureOptions);
      let result = null;
      let adapterState = captureOptions.adapterState || null;
      for (let retryCount = 0; retryCount <= maxRetries; retryCount += 1) {
        if (retryCount > 0) {
          await waitForAnswerKeyRetryDelay(adapterWindow, retryCount);
        }

        await persistPendingAnswerKeyCapture(storage, attemptId, retryCount, manual, logger);
        try {
          adapterState = adapterState || (webfredAdapter && typeof webfredAdapter.getLastState === 'function' ? webfredAdapter.getLastState() : null);
          result = await captureAnswerKeysOnce({
            webfredAdapter,
            window: adapterWindow,
            document: adapterDocument,
            logger,
            adapterState,
            attemptId,
            retryCount,
            manual,
            expectedCount: captureOptions.expectedCount,
          });
          lastResult = result;
          lastError = null;
          await persistAnswerKeyCaptureResult(storage, result, logger);
          if (!shouldRetryAnswerKeyCapture(result, retryCount, maxRetries)) {
            return result;
          }
          adapterState = null;
        } catch (error) {
          lastError = error;
          logger.warn('Answer-key capture attempt failed.', error);
          if (retryCount >= maxRetries) {
            const failed = createFailedAnswerKeyCaptureResult(
              adapterState || (webfredAdapter && typeof webfredAdapter.getLastState === 'function' ? webfredAdapter.getLastState() : null),
              {
                attemptId,
                startedAt,
                retryCount,
                manual,
                expectedCount: captureOptions.expectedCount,
              },
              error
            );
            lastResult = failed;
            await persistAnswerKeyCaptureResult(storage, failed, logger);
            return failed;
          }
        }
      }
      return result;
    })().finally(() => {
      activeCapturePromise = null;
    });

    return activeCapturePromise;
  }

  async function persistLastResultForAttempt(attemptId) {
    const normalizedAttemptId = normalizeString(attemptId, '');
    if (!lastResult || !normalizedAttemptId) {
      return null;
    }
    const resultForAttempt = Object.freeze({
      ...lastResult,
      attemptId: normalizedAttemptId,
      summary: Object.freeze({
        ...lastResult.summary,
        updatedAt: nowIso(),
      }),
    });
    return persistAnswerKeyCaptureResult(storage, resultForAttempt, logger);
  }

  return Object.freeze({
    constants: Object.freeze({
      status: ANSWER_KEY_CAPTURE_STATUS,
      source: ANSWER_KEY_CAPTURE_SOURCE,
      config: ANSWER_KEY_CAPTURE_CONFIG,
    }),
    captureOnce(captureOptions = {}) {
      return captureAnswerKeysOnce({
        ...captureOptions,
        webfredAdapter,
        window: adapterWindow,
        document: adapterDocument,
        logger,
      });
    },
    startAutoCapture(captureOptions = {}) {
      return runCaptureWithRetries({ ...captureOptions, manual: false });
    },
    manualRetry(captureOptions = {}) {
      return runCaptureWithRetries({ ...captureOptions, manual: true, forceNew: true });
    },
    persistLastResultForAttempt,
    getLastResult() {
      return lastResult;
    },
    getLastError() {
      return lastError;
    },
    getStatus() {
      if (activeCapturePromise) {
        return ANSWER_KEY_CAPTURE_STATUS.PENDING;
      }
      return lastResult && lastResult.summary ? lastResult.summary.status : ANSWER_KEY_CAPTURE_STATUS.IDLE;
    },
    isCaptureActive() {
      return Boolean(activeCapturePromise);
    },
  });
}

export {
  createAnswerKeyCaptureController,
  createAnswerKeyCaptureError,
  createAnswerKeyCaptureResult,
  createFailedAnswerKeyCaptureResult,
};
