import { STORAGE_KEYS, WEBFRED_ADAPTER_STATUS, WEBFRED_STATE_SOURCE, WEBFRED_ADAPTER_CONFIG, WEBFRED_ANGULAR_SERVICE_CANDIDATES } from '../core/constants.js';
import { createLogger, nowIso } from '../core/logger.js';
import { createSettingsStore } from '../core/settings.js';
import { isPlainObject, normalizeString, sanitizeJsonCompatible } from '../storage/attempt-store.js';

function createWebfredAdapterError(message, details) {
  const error = new Error(message);
  error.name = 'Free120WebfredAdapterError';
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

function safeNowMs(adapterWindow) {
  const performanceObject = adapterWindow && adapterWindow.performance;
  if (performanceObject && typeof performanceObject.now === 'function') {
    return performanceObject.now();
  }
  return Date.now();
}

function firstNonEmpty(values, fallback = '') {
  if (!Array.isArray(values)) {
    return fallback;
  }

  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
}

function normalizeIdentifierPart(value) {
  return normalizeString(value, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.:-]/g, '')
    .slice(0, 120);
}

function coercePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function normalizeMaybeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'marked', 'checked', 'selected', 'answered'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'unmarked', 'unchecked', 'unselected', 'unanswered'].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }
  return null;
}

function safeElementText(element) {
  if (!element) {
    return '';
  }
  try {
    return normalizeString(element.textContent || '', '');
  } catch (_error) {
    return '';
  }
}

function safeAttribute(element, attributeName) {
  if (!element || typeof element.getAttribute !== 'function') {
    return '';
  }
  try {
    return normalizeString(element.getAttribute(attributeName), '');
  } catch (_error) {
    return '';
  }
}

function safeDatasetValue(element, key) {
  if (!element || !element.dataset) {
    return '';
  }
  return normalizeString(element.dataset[key], '');
}

function isDomElement(value) {
  return Boolean(value && typeof value === 'object' && value.nodeType === 1 && typeof value.querySelector === 'function');
}

function isProbablyVisible(element, adapterWindow) {
  if (!element) {
    return false;
  }

  if (element.hidden || safeAttribute(element, 'aria-hidden') === 'true') {
    return false;
  }

  try {
    const style = adapterWindow && typeof adapterWindow.getComputedStyle === 'function'
      ? adapterWindow.getComputedStyle(element)
      : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
  } catch (_error) {}

  return true;
}

function uniqueNormalizedStrings(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeString(value, '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function buildQuestionIdentity(parts = {}) {
  const examProgram = normalizeIdentifierPart(parts.examProgram || parts.program);
  const examName = normalizeIdentifierPart(parts.examName || parts.examTitle || parts.sectionName);
  const examSection = normalizeIdentifierPart(parts.examSection || parts.section || parts.sectionId);
  const medleyId = normalizeIdentifierPart(parts.medleyId || parts.medleyID || parts.medley || parts.medley_id);
  const componentId = normalizeIdentifierPart(
    parts.componentId || parts.componentID || parts.compId || parts.compID || parts.component_id || parts.itemComponentId
  );
  const fallbackItemId = normalizeIdentifierPart(parts.itemId || parts.questionId || parts.id);
  const blockNumber = coercePositiveInteger(parts.blockNumber || parts.block || parts.blockIndex, 0);
  const itemIndex = coercePositiveInteger(parts.itemIndex || parts.index || parts.number || parts.position, 0);
  const primaryParts = [examProgram, examName || examSection, medleyId, componentId].filter(Boolean);
  const fallbackParts = [examProgram, examName || examSection, fallbackItemId].filter(Boolean);
  const hasPrimaryIdentity = Boolean(medleyId && componentId);
  const hasFallbackIdentity = Boolean(fallbackItemId && fallbackParts.length >= 2);
  const questionId = hasPrimaryIdentity
    ? `webfred:${primaryParts.join(':')}`
    : (hasFallbackIdentity ? `webfred:${fallbackParts.join(':')}` : '');

  return Object.freeze({
    questionId,
    componentId: componentId || fallbackItemId,
    medleyId,
    examProgram,
    examName,
    examSection,
    blockNumber,
    itemIndex,
    identitySource: hasPrimaryIdentity ? 'component-medley' : (hasFallbackIdentity ? 'item-id' : 'untrusted-fallback'),
  });
}

function createEmptyWebfredState(reason = 'not-initialized') {
  const currentTime = nowIso();
  return Object.freeze({
    status: WEBFRED_ADAPTER_STATUS.PENDING,
    source: WEBFRED_STATE_SOURCE.UNAVAILABLE,
    initializedAt: null,
    lastUpdatedAt: currentTime,
    degradedReasons: [reason],
    capabilities: Object.freeze({
      hasAngularServices: false,
      hasDomFallback: false,
      hasTrustedIdentity: false,
      hasItemList: false,
      hasAnswers: false,
      hasMarks: false,
      hasCurrentContent: false,
    }),
    examIdentity: Object.freeze({ program: '', examName: '', section: '' }),
    launchedScope: Object.freeze({}),
    currentBlock: 0,
    blockCount: 0,
    itemCount: 0,
    currentItem: null,
    itemList: Object.freeze([]),
    answers: Object.freeze({}),
    marks: Object.freeze({}),
    currentContent: null,
    blockMetadata: Object.freeze([]),
    terminalState: Object.freeze({
      isTerminal: false,
      blockComplete: false,
      examComplete: false,
      allBlocksComplete: false,
      currentBlock: 0,
      completedBlockNumbers: Object.freeze([]),
      source: WEBFRED_STATE_SOURCE.UNAVAILABLE,
      detectedAt: currentTime,
      reason: '',
    }),
    raw: Object.freeze({}),
  });
}

function extractProgramFromText(value) {
  const text = normalizeString(value, '');
  const stepMatch = text.match(/Step\s*(?:1|2\s*CK|3)/i);
  return stepMatch ? stepMatch[0].replace(/\s+/g, ' ').trim() : '';
}

function extractExamIdentityFromDom(adapterDocument, adapterWindow) {
  const title = normalizeString(adapterDocument && adapterDocument.title, '');
  const url = adapterWindow && adapterWindow.location ? new URL(adapterWindow.location.href) : null;
  const searchParams = url ? url.searchParams : null;
  const candidateText = [
    title,
    searchParams && searchParams.get('program'),
    searchParams && searchParams.get('exam'),
    searchParams && searchParams.get('section'),
  ];
  const program = firstNonEmpty([
    searchParams && searchParams.get('program'),
    searchParams && searchParams.get('Program'),
    extractProgramFromText(candidateText.join(' ')),
  ]);
  const examName = firstNonEmpty([
    searchParams && searchParams.get('exam'),
    searchParams && searchParams.get('Exam'),
    title,
  ]);
  const section = firstNonEmpty([
    searchParams && searchParams.get('section'),
    searchParams && searchParams.get('block'),
  ]);

  return Object.freeze({
    program,
    examName,
    section,
  });
}

function extractLaunchedScopeFromDom(adapterWindow) {
  const url = adapterWindow && adapterWindow.location ? new URL(adapterWindow.location.href) : null;
  if (!url) {
    return Object.freeze({});
  }
  const scope = {};
  ['program', 'exam', 'section', 'block', 'mode', 'test', 'scope'].forEach((key) => {
    const value = normalizeString(url.searchParams.get(key) || url.searchParams.get(key.toUpperCase()), '');
    if (value) {
      scope[key] = value;
    }
  });
  scope.path = url.pathname;
  return Object.freeze(scope);
}

function findCurrentDomItemRoot(adapterDocument, adapterWindow) {
  if (!adapterDocument || typeof adapterDocument.querySelectorAll !== 'function') {
    return null;
  }

  for (const selector of WEBFRED_ADAPTER_CONFIG.DOM_CURRENT_ITEM_SELECTORS) {
    const elements = Array.from(adapterDocument.querySelectorAll(selector));
    const current = elements.find((element) => {
      const className = normalizeString(element.className, '').toLowerCase();
      return isProbablyVisible(element, adapterWindow) && !/ng-hide|hidden|inactive/.test(className);
    });
    if (current) {
      return current;
    }
  }
  return null;
}

function extractResourceUrls(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }
  const urls = [];
  root.querySelectorAll('img[src], source[src], audio[src], video[src], a[href]').forEach((element) => {
    urls.push(safeAttribute(element, 'src') || safeAttribute(element, 'href'));
  });
  return uniqueNormalizedStrings(urls);
}

function extractChoicesFromDom(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }

  return Array.from(root.querySelectorAll('ol.options > li.stContext, li.stContext'))
    .map((element, index) => {
      const input = element.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
      const label = element.querySelector('span, label') || element;
      const id = firstNonEmpty([
        safeAttribute(input, 'value'),
        safeAttribute(input, 'id'),
        safeAttribute(input, 'name') && `${safeAttribute(input, 'name')}:${safeAttribute(input, 'value')}`,
        safeDatasetValue(element, 'optionId'),
        safeDatasetValue(element, 'answerId'),
        `option-${index + 1}`,
      ]);
      const selected = Boolean(input && (input.checked || safeAttribute(input, 'checked')));
      return Object.freeze({
        id,
        label: safeElementText(label),
        index: index + 1,
        selected,
        disabled: Boolean(input && input.disabled),
      });
    });
}

function extractSelectedAnswerIdFromDom(root) {
  if (!root || typeof root.querySelector !== 'function') {
    return '';
  }

  const selectedInput = root.querySelector('input.NBOptionInput:checked, ol.options input[type="radio"]:checked, ol.options input[type="checkbox"]:checked');
  if (!selectedInput) {
    return '';
  }

  return firstNonEmpty([
    safeAttribute(selectedInput, 'value'),
    safeAttribute(selectedInput, 'id'),
    safeAttribute(selectedInput, 'name') && `${safeAttribute(selectedInput, 'name')}:${safeAttribute(selectedInput, 'value')}`,
  ]);
}

function extractQuestionIdentityFromDom(root, adapterDocument, adapterWindow) {
  const medleyElement = root && typeof root.closest === 'function'
    ? root.closest('#medley, [id*="medley"], [data-medley-id]')
    : null;
  const examIdentity = extractExamIdentityFromDom(adapterDocument, adapterWindow);
  const navState = extractNavigationStateFromDom(adapterDocument, adapterWindow);
  const itemIndex = coercePositiveInteger(
    safeDatasetValue(root, 'itemIndex') || safeDatasetValue(root, 'index') || safeAttribute(root, 'data-ng-init') && safeAttribute(root, 'data-ng-init').match(/index\D+(\d+)/i)?.[1],
    navState.currentItemIndex || 1
  );
  const blockNumber = navState.currentBlock || coercePositiveInteger(safeDatasetValue(root, 'block') || safeDatasetValue(root, 'blockNumber'), 1);

  return buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    medleyId: safeDatasetValue(medleyElement, 'medleyId') || safeAttribute(medleyElement, 'id'),
    componentId: safeDatasetValue(root, 'componentId') || safeDatasetValue(root, 'component') || safeAttribute(root, 'id'),
    itemId: safeDatasetValue(root, 'itemId') || safeAttribute(root, 'data-item-id'),
    blockNumber,
    itemIndex,
  });
}

function extractCurrentContentFromDom(root) {
  if (!root) {
    return null;
  }
  const promptElement = root.querySelector('div.NBExposition, .NBExposition, [class*="Exposition"]');
  const answerBox = root.querySelector('div[id$="_div"].NBOptionListComp.answerbox, .NBOptionListComp.answerbox, .answerbox');
  return Object.freeze({
    renderedHtml: root.innerHTML || '',
    promptHtml: promptElement ? promptElement.innerHTML || '' : '',
    answerBoxHtml: answerBox ? answerBox.innerHTML || '' : '',
    choices: extractChoicesFromDom(root),
    resourceUrls: extractResourceUrls(root),
  });
}

function isNavigationKeyItem(item) {
  if (!item) {
    return false;
  }
  const text = safeElementText(item).replace(/\s+/g, ' ').trim();
  const className = normalizeString(item.className, '').toLowerCase();
  const id = safeAttribute(item, 'id').toLowerCase();
  const title = safeAttribute(item, 'title').toLowerCase();
  const ariaLabel = safeAttribute(item, 'aria-label').toLowerCase();
  return /^(key|answer\s*key|answers?)\b/i.test(text)
    || /\b(answer[-_\s]?key|keyitem|key-item)\b/i.test(`${className} ${id} ${title} ${ariaLabel}`);
}

function getQuestionNavigationItems(nav) {
  if (!nav || typeof nav.querySelectorAll !== 'function') {
    return [];
  }
  return Array.from(nav.querySelectorAll('li')).filter((item) => !isNavigationKeyItem(item));
}

function findKeyNavigationItem(adapterDocument) {
  if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
    return null;
  }
  const nav = adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR);
  if (!nav || typeof nav.querySelectorAll !== 'function') {
    return null;
  }
  const items = Array.from(nav.querySelectorAll('li'));
  return items.find((item) => isNavigationKeyItem(item)) || null;
}

function extractNavigationStateFromDom(adapterDocument, adapterWindow) {
  if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
    return Object.freeze({ currentBlock: 0, blockCount: 0, currentItemIndex: 0, itemCount: 0 });
  }

  const nav = adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR);
  const navItems = getQuestionNavigationItems(nav);
  const currentIndex = navItems.findIndex((item) => {
    const className = normalizeString(item.className, '').toLowerCase();
    return className.includes('currentitem') || className.includes('current') || safeAttribute(item, 'aria-current') === 'true';
  });
  const bodyText = safeElementText(adapterDocument.body || adapterDocument.documentElement);
  const blockMatch = bodyText.match(/Block\s+(\d+)\s*(?:of|\/)\s*(\d+)/i) || bodyText.match(/Block\s+(\d+)/i);
  const currentBlock = blockMatch ? coercePositiveInteger(blockMatch[1], 0) : 0;
  const blockCount = blockMatch && blockMatch[2] ? coercePositiveInteger(blockMatch[2], 0) : 0;

  return Object.freeze({
    currentBlock,
    blockCount,
    currentItemIndex: currentIndex >= 0 ? currentIndex + 1 : 0,
    itemCount: navItems.length,
  });
}

function inferCompletedBlockNumbersFromTerminal(navState, summary = {}) {
  const currentBlock = coercePositiveInteger(summary.currentBlock || navState.currentBlock, 0);
  const blockCount = coercePositiveInteger(summary.blockCount || navState.blockCount, 0);
  if (summary.examComplete || summary.allBlocksComplete) {
    if (blockCount > 0) {
      return Array.from({ length: blockCount }, (_item, index) => index + 1);
    }
    return currentBlock ? [currentBlock] : [];
  }
  if (summary.blockComplete && currentBlock > 0) {
    return [currentBlock];
  }
  return [];
}

function extractTerminalStateFromDom(adapterDocument, adapterWindow, navState = null) {
  const currentNavState = navState || extractNavigationStateFromDom(adapterDocument, adapterWindow);
  const bodyText = safeElementText(adapterDocument && (adapterDocument.body || adapterDocument.documentElement));
  const normalizedText = bodyText.replace(/\s+/g, ' ').trim();
  const blockComplete = /\b(?:you\s+have\s+)?(?:completed|finished|ended)\s+(?:this\s+)?block\b/i.test(normalizedText)
    || /\bblock\s+(?:is\s+)?(?:complete|completed|finished|ended)\b/i.test(normalizedText)
    || /\bend\s+of\s+block\b/i.test(normalizedText);
  const examComplete = /\b(?:you\s+have\s+)?(?:completed|finished|ended)\s+(?:the\s+)?(?:exam|test)\b/i.test(normalizedText)
    || /\b(?:exam|test)\s+(?:is\s+)?(?:complete|completed|finished|ended)\b/i.test(normalizedText);
  const allBlocksComplete = examComplete || /\ball\s+blocks?\s+(?:are\s+)?(?:complete|completed|finished|ended)\b/i.test(normalizedText);
  const isTerminal = Boolean(blockComplete || examComplete || allBlocksComplete);
  const completedBlockNumbers = inferCompletedBlockNumbersFromTerminal(currentNavState, {
    blockComplete,
    examComplete,
    allBlocksComplete,
  });

  return Object.freeze({
    isTerminal,
    blockComplete,
    examComplete,
    allBlocksComplete,
    currentBlock: currentNavState.currentBlock || 0,
    completedBlockNumbers: Object.freeze(completedBlockNumbers),
    source: WEBFRED_STATE_SOURCE.DOM_FALLBACK,
    detectedAt: nowIso(),
    reason: isTerminal ? 'dom-terminal-text' : '',
    textHash: isTerminal ? stableHashString(normalizedText.slice(0, 1000)) : '',
  });
}

function extractItemListFromDom(adapterDocument, adapterWindow, examIdentity) {
  if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
    return [];
  }

  const nav = adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR);
  if (!nav) {
    return [];
  }

  const navState = extractNavigationStateFromDom(adapterDocument, adapterWindow);
  return getQuestionNavigationItems(nav).map((item, index) => {
    const visibleIndex = coercePositiveInteger(safeElementText(item.querySelector('span.index') || item).match(/\d+/)?.[0], index + 1);
    const medleyId = safeDatasetValue(item, 'medleyId') || safeAttribute(item, 'data-medley-id');
    const componentId = safeDatasetValue(item, 'componentId') || safeAttribute(item, 'data-component-id') || safeAttribute(item, 'id');
    const identity = buildQuestionIdentity({
      examProgram: examIdentity && examIdentity.program,
      examName: examIdentity && examIdentity.examName,
      examSection: examIdentity && examIdentity.section,
      medleyId,
      componentId,
      itemId: safeDatasetValue(item, 'itemId') || safeAttribute(item, 'data-item-id'),
      blockNumber: navState.currentBlock || 1,
      itemIndex: visibleIndex,
    });
    const className = normalizeString(item.className, '').toLowerCase();
    return Object.freeze({
      questionId: identity.questionId,
      componentId: identity.componentId,
      medleyId: identity.medleyId,
      blockNumber: identity.blockNumber,
      itemIndex: visibleIndex,
      label: safeElementText(item.querySelector('span.index') || item),
      answered: className.includes('answered') || Boolean(item.querySelector('.ans_status.answered, .answered')),
      marked: className.includes('marked') || Boolean(item.querySelector('.mark, .marked, [aria-label*="Mark"], [title*="Mark"], [aria-label*="mark"], [title*="mark"]')),
      current: className.includes('currentitem') || className.includes('current') || safeAttribute(item, 'aria-current') === 'true',
      identitySource: identity.identitySource,
    });
  });
}

function extractDomFallbackState(adapterWindow, adapterDocument) {
  const root = findCurrentDomItemRoot(adapterDocument, adapterWindow);
  const examIdentity = extractExamIdentityFromDom(adapterDocument, adapterWindow);
  const launchedScope = extractLaunchedScopeFromDom(adapterWindow);
  const navState = extractNavigationStateFromDom(adapterDocument, adapterWindow);
  const terminalState = extractTerminalStateFromDom(adapterDocument, adapterWindow, navState);
  const itemList = extractItemListFromDom(adapterDocument, adapterWindow, examIdentity);
  const identity = root ? extractQuestionIdentityFromDom(root, adapterDocument, adapterWindow) : buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    blockNumber: navState.currentBlock || 1,
    itemIndex: navState.currentItemIndex || 1,
  });
  const selectedAnswerId = root ? extractSelectedAnswerIdFromDom(root) : '';
  const currentContent = root ? extractCurrentContentFromDom(root) : null;
  const currentItem = root ? Object.freeze({
    questionId: identity.questionId,
    componentId: identity.componentId,
    medleyId: identity.medleyId,
    blockNumber: identity.blockNumber || navState.currentBlock || 1,
    itemIndex: identity.itemIndex || navState.currentItemIndex || 1,
    selectedAnswerId,
    marked: Boolean(itemList.find((item) => item.current && item.marked)),
    identitySource: identity.identitySource,
    source: WEBFRED_STATE_SOURCE.DOM_FALLBACK,
  }) : null;

  const answers = currentItem && selectedAnswerId ? { [currentItem.questionId]: selectedAnswerId } : {};
  const marks = currentItem && currentItem.marked ? { [currentItem.questionId]: true } : {};

  return Object.freeze({
    source: WEBFRED_STATE_SOURCE.DOM_FALLBACK,
    examIdentity,
    launchedScope,
    currentBlock: navState.currentBlock || (currentItem && currentItem.blockNumber) || 0,
    blockCount: navState.blockCount,
    itemCount: navState.itemCount || itemList.length || (currentItem ? 1 : 0),
    currentItem,
    itemList,
    answers,
    marks,
    currentContent,
    blockMetadata: navState.currentBlock ? [{ blockNumber: navState.currentBlock, itemCount: navState.itemCount || itemList.length }] : [],
    terminalState,
    capabilities: Object.freeze({
      hasDomFallback: Boolean(root || itemList.length),
      hasTrustedIdentity: Boolean(currentItem && identity.identitySource === 'component-medley'),
      hasItemList: itemList.length > 0,
      hasAnswers: Object.keys(answers).length > 0,
      hasMarks: Object.keys(marks).length > 0,
      hasCurrentContent: Boolean(currentContent && currentContent.renderedHtml),
    }),
    degradedReasons: root ? [] : ['dom-current-item-unavailable'],
    raw: Object.freeze({
      currentItemRootId: root ? safeAttribute(root, 'id') : '',
      location: adapterWindow && adapterWindow.location ? adapterWindow.location.href : '',
    }),
  });
}

function safeInvokeFunction(fn, thisArg, args = []) {
  if (typeof fn !== 'function') {
    return undefined;
  }
  if (fn.length > (Array.isArray(args) ? args.length : 0)) {
    return undefined;
  }
  try {
    return fn.apply(thisArg, args);
  } catch (_error) {
    return undefined;
  }
}

function isReadableObject(value) {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function'));
}

function safeOwnKeys(value) {
  if (!isReadableObject(value)) {
    return [];
  }
  try {
    return Object.keys(value).slice(0, WEBFRED_ADAPTER_CONFIG.MAX_SCAN_KEYS_PER_OBJECT);
  } catch (_error) {
    return [];
  }
}

function readCandidateProperty(source, names) {
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
        if (typeof value === 'function') {
          const invoked = safeInvokeFunction(value, source);
          if (invoked !== undefined) {
            return invoked;
          }
        } else if (value !== undefined && value !== null) {
          return value;
        }
      }
    } catch (_error) {}
  }
  return undefined;
}

function readCandidateMethod(source, names) {
  if (!isReadableObject(source)) {
    return undefined;
  }

  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    try {
      const value = source[name];
      if (typeof value !== 'function') {
        continue;
      }
      const invoked = safeInvokeFunction(value, source);
      if (invoked !== undefined && invoked !== null) {
        return invoked;
      }
    } catch (_error) {}
  }
  return undefined;
}

function findFirstSemanticValue(objects, names, options = {}) {
  const queue = (Array.isArray(objects) ? objects : [])
    .filter((value) => isReadableObject(value))
    .map((value) => ({ value, depth: 0 }));
  const seen = [];
  let scanned = 0;
  const maxDepth = coercePositiveInteger(options.maxDepth, 3);
  const maxObjects = coercePositiveInteger(options.maxObjects, WEBFRED_ADAPTER_CONFIG.MAX_SCAN_OBJECTS);

  while (queue.length && scanned < maxObjects) {
    const current = queue.shift();
    if (!current || !isReadableObject(current.value) || seen.includes(current.value)) {
      continue;
    }
    seen.push(current.value);
    scanned += 1;

    const direct = readCandidateProperty(current.value, names) || readCandidateMethod(current.value, names);
    if (direct !== undefined && direct !== null && direct !== '') {
      return direct;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    for (const key of safeOwnKeys(current.value)) {
      if (/^\$\$|^_|prototype|constructor|window|document|element|scope/i.test(key)) {
        continue;
      }
      let child;
      try {
        child = current.value[key];
      } catch (_error) {
        child = null;
      }
      if (isReadableObject(child) && !isDomElement(child) && !seen.includes(child)) {
        queue.push({ value: child, depth: current.depth + 1 });
      }
    }
  }

  return undefined;
}

function findAllSemanticValues(objects, names, options = {}) {
  const results = [];
  const queue = (Array.isArray(objects) ? objects : [])
    .filter((value) => isReadableObject(value))
    .map((value) => ({ value, depth: 0 }));
  const seen = [];
  let scanned = 0;
  const maxDepth = coercePositiveInteger(options.maxDepth, 2);
  const maxObjects = coercePositiveInteger(options.maxObjects, WEBFRED_ADAPTER_CONFIG.MAX_SCAN_OBJECTS);

  while (queue.length && scanned < maxObjects) {
    const current = queue.shift();
    if (!current || !isReadableObject(current.value) || seen.includes(current.value)) {
      continue;
    }
    seen.push(current.value);
    scanned += 1;

    const direct = readCandidateProperty(current.value, names) || readCandidateMethod(current.value, names);
    if (direct !== undefined && direct !== null && direct !== '') {
      results.push(direct);
    }

    if (current.depth >= maxDepth) {
      continue;
    }
    for (const key of safeOwnKeys(current.value)) {
      if (/^\$\$|^_|prototype|constructor|window|document|element|scope/i.test(key)) {
        continue;
      }
      let child;
      try {
        child = current.value[key];
      } catch (_error) {
        child = null;
      }
      if (isReadableObject(child) && !isDomElement(child) && !seen.includes(child)) {
        queue.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return results;
}

function safeJsonCompatibleValue(value) {
  try {
    return sanitizeJsonCompatible(value, 0, []);
  } catch (_error) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return normalizeString(value, '');
  }
}

function findAngularRootElement(adapterWindow, adapterDocument) {
  if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
    return null;
  }
  return adapterDocument.querySelector('[ng-app], [data-ng-app], .ng-scope, [ng-controller], [data-ng-controller]')
    || adapterDocument.body
    || adapterDocument.documentElement
    || (adapterWindow && adapterWindow.document && adapterWindow.document.body);
}

function findAngularInjector(adapterWindow, adapterDocument) {
  const angularObject = adapterWindow && adapterWindow.angular;
  if (!angularObject || typeof angularObject.element !== 'function') {
    return null;
  }

  const rootElement = findAngularRootElement(adapterWindow, adapterDocument);
  const elements = [rootElement, adapterDocument && adapterDocument.body, adapterDocument && adapterDocument.documentElement].filter(Boolean);
  for (const element of elements) {
    try {
      const wrapped = angularObject.element(element);
      const injector = wrapped && typeof wrapped.injector === 'function' ? wrapped.injector() : null;
      if (injector && typeof injector.get === 'function') {
        return injector;
      }
    } catch (_error) {}
  }

  return null;
}

function readAngularAppName(adapterDocument) {
  if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
    return '';
  }
  const root = adapterDocument.querySelector('[ng-app], [data-ng-app]') || adapterDocument.documentElement;
  return firstNonEmpty([
    safeAttribute(root, 'ng-app'),
    safeAttribute(root, 'data-ng-app'),
    safeAttribute(root, 'x-ng-app'),
    safeAttribute(root, 'ng:app'),
  ]);
}

function collectAngularModuleRegistrationNames(angularObject, moduleName, seenModules = new Set()) {
  const normalizedModuleName = normalizeString(moduleName, '');
  if (!angularObject || typeof angularObject.module !== 'function' || !normalizedModuleName || seenModules.has(normalizedModuleName)) {
    return [];
  }
  seenModules.add(normalizedModuleName);

  let moduleObject;
  try {
    moduleObject = angularObject.module(normalizedModuleName);
  } catch (_error) {
    return [];
  }

  const names = [];
  const queues = [moduleObject._invokeQueue, moduleObject._configBlocks, moduleObject._runBlocks].filter(Array.isArray);
  queues.forEach((queue) => {
    queue.forEach((entry) => {
      const args = Array.isArray(entry) ? entry[2] : null;
      if (Array.isArray(args) && typeof args[0] === 'string') {
        names.push(args[0]);
      }
    });
  });

  if (Array.isArray(moduleObject.requires)) {
    moduleObject.requires.forEach((requiredModuleName) => {
      names.push(...collectAngularModuleRegistrationNames(angularObject, requiredModuleName, seenModules));
    });
  }

  return uniqueNormalizedStrings(names);
}

function discoverAngularServiceNames(adapterWindow, adapterDocument) {
  const angularObject = adapterWindow && adapterWindow.angular;
  const appName = readAngularAppName(adapterDocument);
  const registeredNames = collectAngularModuleRegistrationNames(angularObject, appName);
  return registeredNames.filter((name) => /exam|block|item|question|answer|response|mark|flag|content|medley|config|session|navigation|nav|state|scope|current/i.test(name));
}

function resolveAngularServices(injector, logger, adapterWindow, adapterDocument) {
  if (!injector || typeof injector.get !== 'function') {
    return Object.freeze({ injector: null, services: Object.freeze({}), resolvedNames: Object.freeze([]) });
  }

  const services = {};
  const resolvedNames = [];
  const serviceCandidates = uniqueNormalizedStrings([
    ...WEBFRED_ANGULAR_SERVICE_CANDIDATES,
    ...discoverAngularServiceNames(adapterWindow, adapterDocument),
  ]);
  serviceCandidates.forEach((name) => {
    try {
      if (typeof injector.has === 'function' && !injector.has(name)) {
        return;
      }
    } catch (_error) {}
    try {
      const service = injector.get(name);
      if (service !== undefined && service !== null) {
        services[name] = service;
        resolvedNames.push(name);
      }
    } catch (error) {
      if (logger) {
        logger.debug('Angular service candidate unavailable.', name, error);
      }
    }
  });

  return Object.freeze({
    injector,
    services: Object.freeze(services),
    resolvedNames: Object.freeze(resolvedNames),
  });
}

function collectAngularStateRoots(angularServices) {
  if (!angularServices || !angularServices.services) {
    return [];
  }
  const roots = [];
  Object.values(angularServices.services).forEach((service) => {
    if (!service) {
      return;
    }
    roots.push(service);
    ['state', 'model', 'data', 'exam', 'examData', 'test', 'block', 'currentBlock', 'items', 'itemList', 'responses', 'answers', 'content', 'config', 'configuration'].forEach((key) => {
      const value = readCandidateProperty(service, [key]);
      if (isReadableObject(value)) {
        roots.push(value);
      }
    });
  });
  return roots;
}

function valueToArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value.length === 'number' && value.length >= 0 && value.length < 500 && typeof value !== 'string') {
    try {
      return Array.from(value);
    } catch (_error) {}
  }
  if (isReadableObject(value)) {
    const nested = readCandidateProperty(value, ['items', 'itemList', 'questions', 'questionList', 'responses', 'answers', 'data']);
    if (Array.isArray(nested)) {
      return nested;
    }
    const keys = safeOwnKeys(value).filter((key) => !/^\$|^_|length$|selected|current/i.test(key));
    const values = keys.map((key) => {
      try {
        return value[key];
      } catch (_error) {
        return null;
      }
    }).filter((item) => item !== null && item !== undefined);
    if (values.length && values.length <= 250) {
      return values;
    }
  }
  return [];
}

function normalizeChoiceFromAngular(rawChoice, index = 0) {
  if (!isReadableObject(rawChoice)) {
    return Object.freeze({
      id: normalizeString(rawChoice, `option-${index + 1}`),
      label: normalizeString(rawChoice, ''),
      index: index + 1,
      selected: false,
      disabled: false,
    });
  }

  return Object.freeze({
    id: firstNonEmpty([
      readCandidateProperty(rawChoice, ['id', 'optionId', 'answerId', 'choiceId', 'value', 'key']),
      `option-${index + 1}`,
    ]),
    label: firstNonEmpty([
      readCandidateProperty(rawChoice, ['label', 'text', 'html', 'choiceText', 'answerText', 'displayText']),
      normalizeString(rawChoice, ''),
    ]),
    index: coercePositiveInteger(readCandidateProperty(rawChoice, ['index', 'itemIndex', 'ordinal', 'position', 'number']), index + 1),
    selected: Boolean(normalizeMaybeBoolean(readCandidateProperty(rawChoice, ['selected', 'isSelected', 'checked']))),
    disabled: Boolean(normalizeMaybeBoolean(readCandidateProperty(rawChoice, ['disabled', 'isDisabled']))),
  });
}

function normalizeChoicesFromAngular(rawChoices) {
  return valueToArray(rawChoices).map((choice, index) => normalizeChoiceFromAngular(choice, index));
}

function normalizeExamIdentityFromAngular(roots, fallbackIdentity) {
  const fallback = fallbackIdentity || {};
  const program = firstNonEmpty([
    findFirstSemanticValue(roots, ['examProgram', 'program', 'programName', 'usmleProgram', 'testProgram'], { maxDepth: 3 }),
    extractProgramFromText(findFirstSemanticValue(roots, ['examName', 'examTitle', 'testName', 'title'], { maxDepth: 2 })),
    fallback.program,
  ]);
  const examName = firstNonEmpty([
    findFirstSemanticValue(roots, ['examName', 'examTitle', 'testName', 'assessmentName', 'formName'], { maxDepth: 3 }),
    fallback.examName,
  ]);
  const section = firstNonEmpty([
    findFirstSemanticValue(roots, ['sectionName', 'examSection', 'section', 'sectionTitle', 'blockName'], { maxDepth: 3 }),
    fallback.section,
  ]);

  return Object.freeze({
    program,
    examName,
    section,
  });
}

function normalizeLaunchedScopeFromAngular(roots, fallbackScope) {
  const rawScope = findFirstSemanticValue(roots, [
    'launchedScope', 'launchScope', 'scope', 'launchConfiguration', 'launchConfig', 'configuration', 'config',
  ], { maxDepth: 2 });
  const scope = isPlainObject(rawScope) ? safeJsonCompatibleValue(rawScope) : {};
  const fallback = isPlainObject(fallbackScope) ? fallbackScope : {};
  return Object.freeze({
    ...fallback,
    ...(isPlainObject(scope) ? scope : {}),
    mode: firstNonEmpty([
      isReadableObject(rawScope) && readCandidateProperty(rawScope, ['mode', 'examMode', 'testMode']),
      findFirstSemanticValue(roots, ['mode', 'examMode', 'testMode'], { maxDepth: 2 }),
      fallback.mode,
    ]),
    block: firstNonEmpty([
      isReadableObject(rawScope) && readCandidateProperty(rawScope, ['block', 'blockNumber', 'selectedBlock']),
      findFirstSemanticValue(roots, ['selectedBlock', 'launchedBlock', 'blockNumber'], { maxDepth: 2 }),
      fallback.block,
    ]),
  });
}

function normalizeAngularItem(rawItem, options = {}) {
  const examIdentity = options.examIdentity || {};
  const fallback = options.fallback || {};
  const indexFallback = coercePositiveInteger(options.index, 0) || coercePositiveInteger(fallback.itemIndex, 0);
  const blockFallback = coercePositiveInteger(options.blockNumber, 0) || coercePositiveInteger(fallback.blockNumber, 0);

  if (!isReadableObject(rawItem)) {
    const identity = buildQuestionIdentity({
      examProgram: examIdentity.program,
      examName: examIdentity.examName,
      examSection: examIdentity.section,
      itemId: rawItem,
      blockNumber: blockFallback,
      itemIndex: indexFallback,
    });
    return Object.freeze({
      questionId: identity.questionId,
      componentId: identity.componentId,
      medleyId: identity.medleyId,
      blockNumber: identity.blockNumber,
      itemIndex: identity.itemIndex,
      selectedAnswerId: '',
      marked: false,
      answered: false,
      identitySource: identity.identitySource,
      source: WEBFRED_STATE_SOURCE.ANGULAR,
    });
  }

  const blockNumber = coercePositiveInteger(
    readCandidateProperty(rawItem, ['blockNumber', 'block', 'blockIndex', 'currentBlock', 'sectionNumber']),
    blockFallback || 1
  );
  const itemIndex = coercePositiveInteger(
    readCandidateProperty(rawItem, ['itemIndex', 'index', 'ordinal', 'position', 'number', 'sequence']),
    indexFallback || 1
  );
  const identity = buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    medleyId: findFirstSemanticValue([rawItem], ['medleyId', 'medleyID', 'medley', 'medley_id'], { maxDepth: 2 }),
    componentId: findFirstSemanticValue([rawItem], ['componentId', 'componentID', 'compId', 'compID', 'component_id', 'itemComponentId'], { maxDepth: 2 }),
    itemId: findFirstSemanticValue([rawItem], ['itemId', 'questionId', 'id', 'identifier', 'itemIdentifier'], { maxDepth: 1 }),
    blockNumber,
    itemIndex,
  });
  const selectedAnswerId = firstNonEmpty([
    findFirstSemanticValue([rawItem], ['selectedAnswerId', 'selectedResponseId', 'selectedOptionId', 'answerId', 'responseId', 'userAnswerId', 'value'], { maxDepth: 2 }),
    isReadableObject(readCandidateProperty(rawItem, ['response', 'answer', 'selectedAnswer']))
      ? findFirstSemanticValue([readCandidateProperty(rawItem, ['response', 'answer', 'selectedAnswer'])], ['id', 'answerId', 'optionId', 'value'], { maxDepth: 1 })
      : '',
  ]);
  const marked = normalizeMaybeBoolean(findFirstSemanticValue([rawItem], ['marked', 'isMarked', 'flagged', 'isFlagged', 'mark'], { maxDepth: 2 }));
  const answered = normalizeMaybeBoolean(findFirstSemanticValue([rawItem], ['answered', 'isAnswered', 'complete', 'isComplete'], { maxDepth: 2 }));

  return Object.freeze({
    questionId: identity.questionId,
    componentId: identity.componentId,
    medleyId: identity.medleyId,
    blockNumber: identity.blockNumber || blockNumber,
    itemIndex: identity.itemIndex || itemIndex,
    selectedAnswerId,
    marked: marked === null ? false : marked,
    answered: answered === null ? Boolean(selectedAnswerId) : answered,
    current: Boolean(normalizeMaybeBoolean(findFirstSemanticValue([rawItem], ['current', 'isCurrent', 'active', 'isActive', 'selectedItem'], { maxDepth: 2 }))),
    identitySource: identity.identitySource,
    source: WEBFRED_STATE_SOURCE.ANGULAR,
    rawType: Object.prototype.toString.call(rawItem),
  });
}

function normalizeItemListFromAngular(rawList, options = {}) {
  const items = valueToArray(rawList);
  if (!items.length) {
    return [];
  }
  return items.map((item, index) => normalizeAngularItem(item, {
    examIdentity: options.examIdentity,
    blockNumber: options.blockNumber,
    index: index + 1,
    fallback: options.fallbackItem,
  }));
}

function getRawAngularItemBlockNumber(rawItem) {
  if (!isReadableObject(rawItem)) {
    return 0;
  }
  return coercePositiveInteger(
    readCandidateProperty(rawItem, ['blockNumber', 'block', 'blockIndex', 'currentBlock', 'sectionNumber']),
    0
  );
}

function selectAngularItemsForCurrentBlock(rawList, currentBlock, domState = null) {
  const rawItems = valueToArray(rawList);
  if (!rawItems.length) {
    return [];
  }
  const blockNumber = coercePositiveInteger(currentBlock || (domState && domState.currentBlock), 0);
  if (!blockNumber) {
    return rawItems;
  }

  const currentBlockItems = rawItems.filter((item) => getRawAngularItemBlockNumber(item) === blockNumber);
  if (currentBlockItems.length) {
    return currentBlockItems;
  }

  const domItemCount = coercePositiveInteger(domState && domState.itemCount, 0);
  if (domItemCount > 0 && rawItems.length > domItemCount) {
    const startIndex = (blockNumber - 1) * domItemCount;
    if (startIndex >= 0 && startIndex < rawItems.length) {
      return rawItems.slice(startIndex, startIndex + domItemCount);
    }
    return rawItems.slice(0, domItemCount);
  }

  return rawItems;
}

function rebaseAngularItemsForCurrentBlock(itemList, currentBlock = 0) {
  const items = Array.isArray(itemList) ? itemList : [];
  if (!items.length) {
    return [];
  }
  const blockNumber = coercePositiveInteger(currentBlock, 0);
  const indexes = items.map((item) => coercePositiveInteger(item && item.itemIndex, 0)).filter(Boolean);
  const maxIndex = indexes.length ? Math.max(...indexes) : 0;
  const minIndex = indexes.length ? Math.min(...indexes) : 0;
  const shouldRebaseIndex = minIndex > 1 && maxIndex > items.length;
  if (!blockNumber && !shouldRebaseIndex) {
    return items;
  }
  return items.map((item, index) => Object.freeze({
    ...item,
    blockNumber: blockNumber || item.blockNumber,
    itemIndex: shouldRebaseIndex ? index + 1 : item.itemIndex,
  }));
}

function addAnswerMapping(answers, questionId, answerId) {
  const normalizedQuestionId = normalizeString(questionId, '');
  const normalizedAnswerId = normalizeString(answerId, '');
  if (normalizedQuestionId && normalizedAnswerId) {
    answers[normalizedQuestionId] = normalizedAnswerId;
  }
}

function normalizeAnswersFromAngular(rawAnswers, itemList = [], currentItem = null) {
  const answers = {};
  const itemsByCandidateId = new Map();
  itemList.forEach((item) => {
    [item.questionId, item.componentId, item.medleyId, String(item.itemIndex)].forEach((key) => {
      const normalized = normalizeString(key, '');
      if (normalized) {
        itemsByCandidateId.set(normalized, item.questionId);
      }
    });
  });

  if (currentItem && currentItem.selectedAnswerId) {
    addAnswerMapping(answers, currentItem.questionId, currentItem.selectedAnswerId);
  }

  if (!rawAnswers) {
    itemList.forEach((item) => addAnswerMapping(answers, item.questionId, item.selectedAnswerId));
    return Object.freeze(answers);
  }

  if (!Array.isArray(rawAnswers) && isReadableObject(rawAnswers)) {
    safeOwnKeys(rawAnswers).forEach((key) => {
      let value;
      try {
        value = rawAnswers[key];
      } catch (_error) {
        value = null;
      }
      const mappedQuestionId = itemsByCandidateId.get(key) || key;
      if (isReadableObject(value)) {
        const answerId = firstNonEmpty([
          findFirstSemanticValue([value], ['selectedAnswerId', 'selectedResponseId', 'selectedOptionId', 'answerId', 'responseId', 'value'], { maxDepth: 2 }),
          findFirstSemanticValue([value], ['id', 'optionId'], { maxDepth: 1 }),
        ]);
        addAnswerMapping(answers, mappedQuestionId, answerId);
      } else {
        addAnswerMapping(answers, mappedQuestionId, value);
      }
    });
    itemList.forEach((item) => addAnswerMapping(answers, item.questionId, item.selectedAnswerId));
    return Object.freeze(answers);
  }

  valueToArray(rawAnswers).forEach((entry, index) => {
    if (!isReadableObject(entry)) {
      const item = itemList[index];
      if (item) {
        addAnswerMapping(answers, item.questionId, entry);
      }
      return;
    }

    const rawQuestionId = firstNonEmpty([
      findFirstSemanticValue([entry], ['questionId', 'itemId', 'id', 'componentId', 'componentID', 'itemComponentId'], { maxDepth: 1 }),
      String(index + 1),
    ]);
    const mappedQuestionId = itemsByCandidateId.get(rawQuestionId) || rawQuestionId;
    const answerId = firstNonEmpty([
      findFirstSemanticValue([entry], ['selectedAnswerId', 'selectedResponseId', 'selectedOptionId', 'answerId', 'responseId', 'value'], { maxDepth: 2 }),
      isReadableObject(readCandidateProperty(entry, ['answer', 'response', 'selectedAnswer']))
        ? findFirstSemanticValue([readCandidateProperty(entry, ['answer', 'response', 'selectedAnswer'])], ['id', 'answerId', 'optionId', 'value'], { maxDepth: 1 })
        : '',
    ]);
    addAnswerMapping(answers, mappedQuestionId, answerId);
  });

  itemList.forEach((item) => addAnswerMapping(answers, item.questionId, item.selectedAnswerId));
  return Object.freeze(answers);
}

function normalizeMarksFromAngular(rawMarks, itemList = [], currentItem = null) {
  const marks = {};
  const itemsByCandidateId = new Map();
  itemList.forEach((item) => {
    [item.questionId, item.componentId, item.medleyId, String(item.itemIndex)].forEach((key) => {
      const normalized = normalizeString(key, '');
      if (normalized) {
        itemsByCandidateId.set(normalized, item.questionId);
      }
    });
    if (item.marked) {
      marks[item.questionId] = true;
    }
  });

  if (currentItem && currentItem.marked) {
    marks[currentItem.questionId] = true;
  }

  if (!rawMarks) {
    return Object.freeze(marks);
  }

  if (Array.isArray(rawMarks)) {
    rawMarks.forEach((entry, index) => {
      if (isReadableObject(entry)) {
        const rawQuestionId = firstNonEmpty([
          findFirstSemanticValue([entry], ['questionId', 'itemId', 'id', 'componentId', 'componentID', 'itemComponentId'], { maxDepth: 1 }),
          String(index + 1),
        ]);
        const mappedQuestionId = itemsByCandidateId.get(rawQuestionId) || rawQuestionId;
        const marked = normalizeMaybeBoolean(findFirstSemanticValue([entry], ['marked', 'isMarked', 'flagged', 'isFlagged', 'value'], { maxDepth: 2 }));
        if (mappedQuestionId && marked) {
          marks[mappedQuestionId] = true;
        }
      } else if (entry) {
        const item = itemList[index];
        if (item) {
          marks[item.questionId] = true;
        }
      }
    });
    return Object.freeze(marks);
  }

  if (isReadableObject(rawMarks)) {
    safeOwnKeys(rawMarks).forEach((key) => {
      let value;
      try {
        value = rawMarks[key];
      } catch (_error) {
        value = null;
      }
      const marked = normalizeMaybeBoolean(value);
      const mappedQuestionId = itemsByCandidateId.get(key) || key;
      if (mappedQuestionId && marked) {
        marks[mappedQuestionId] = true;
      }
    });
  }

  return Object.freeze(marks);
}

function normalizeCurrentContentFromAngular(rawContent, currentItem = null) {
  if (!isReadableObject(rawContent)) {
    return null;
  }

  const contentForCurrent = (() => {
    if (!currentItem) {
      return rawContent;
    }
    if (Array.isArray(rawContent)) {
      return rawContent.find((item) => {
        const normalized = normalizeAngularItem(item, {
          examIdentity: {},
          blockNumber: currentItem.blockNumber,
          index: currentItem.itemIndex,
        });
        return normalized.questionId === currentItem.questionId
          || normalized.componentId === currentItem.componentId
          || normalized.itemIndex === currentItem.itemIndex;
      }) || rawContent[currentItem.itemIndex - 1] || rawContent[0];
    }
    return rawContent;
  })();

  if (!isReadableObject(contentForCurrent)) {
    return null;
  }

  const promptHtml = firstNonEmpty([
    findFirstSemanticValue([contentForCurrent], ['promptHtml', 'expositionHtml', 'questionHtml', 'stemHtml', 'bodyHtml'], { maxDepth: 2 }),
    findFirstSemanticValue([contentForCurrent], ['prompt', 'exposition', 'questionText', 'stem', 'body'], { maxDepth: 2 }),
  ]);
  const renderedHtml = firstNonEmpty([
    findFirstSemanticValue([contentForCurrent], ['renderedHtml', 'html', 'contentHtml', 'itemHtml'], { maxDepth: 2 }),
    promptHtml,
  ]);
  const rawChoices = findFirstSemanticValue([contentForCurrent], ['choices', 'options', 'answers', 'answerOptions', 'answerChoices'], { maxDepth: 2 });
  const resourceUrls = uniqueNormalizedStrings([
    ...valueToArray(findFirstSemanticValue([contentForCurrent], ['resourceUrls', 'resources', 'mediaUrls', 'media'], { maxDepth: 2 })).map((item) => {
      if (isReadableObject(item)) {
        return firstNonEmpty([readCandidateProperty(item, ['url', 'src', 'href'])]);
      }
      return item;
    }),
  ]);

  return Object.freeze({
    renderedHtml,
    promptHtml,
    answerBoxHtml: '',
    choices: normalizeChoicesFromAngular(rawChoices),
    resourceUrls,
  });
}

function normalizeBlockMetadataFromAngular(rawBlocks, currentBlock, blockCount, itemCount) {
  const blocks = valueToArray(rawBlocks).map((block, index) => {
    if (!isReadableObject(block)) {
      return Object.freeze({ blockNumber: index + 1, itemCount: 0, label: normalizeString(block, '') });
    }
    return Object.freeze({
      blockNumber: coercePositiveInteger(readCandidateProperty(block, ['blockNumber', 'block', 'index', 'number']), index + 1),
      itemCount: coercePositiveInteger(readCandidateProperty(block, ['itemCount', 'questionCount', 'itemsCount', 'count', 'totalItems']), 0),
      label: firstNonEmpty([readCandidateProperty(block, ['label', 'name', 'title', 'sectionName'])]),
    });
  });

  if (blocks.length) {
    return blocks;
  }

  if (currentBlock || blockCount || itemCount) {
    return [Object.freeze({
      blockNumber: currentBlock || 1,
      itemCount: itemCount || 0,
      blockCount: blockCount || 0,
      label: currentBlock ? `Block ${currentBlock}` : '',
    })];
  }
  return [];
}

function booleanFromSemanticValue(value) {
  const direct = normalizeMaybeBoolean(value);
  if (direct !== null) {
    return direct;
  }
  const text = normalizeString(value, '').toLowerCase();
  if (!text) {
    return false;
  }
  return /complete|completed|finished|ended|terminal|submitted/.test(text)
    && !/incomplete|not\s+complete|unfinished|not\s+finished/.test(text);
}

function normalizeCompletedBlockNumbers(value) {
  const values = (() => {
    if (value === null || value === undefined || value === '') {
      return [];
    }
    if (typeof value === 'string') {
      const matches = value.match(/\d+/g);
      return matches && matches.length ? matches : [value];
    }
    if (typeof value === 'number') {
      return [value];
    }
    return valueToArray(value);
  })();
  return uniqueNormalizedStrings(values.flatMap((entry) => {
    if (isReadableObject(entry)) {
      return [
        readCandidateProperty(entry, ['blockNumber', 'block', 'index', 'number']),
        readCandidateProperty(entry, ['id']),
      ];
    }
    return [entry];
  }))
    .map((entry) => coercePositiveInteger(entry, 0))
    .filter(Boolean)
    .sort((left, right) => left - right);
}

function extractTerminalStateFromAngular(roots, currentBlock, blockCount, fallbackTerminalState = null) {
  const statusText = [
    findFirstSemanticValue(roots, ['status', 'state', 'examStatus', 'testStatus', 'blockStatus', 'mode'], { maxDepth: 3 }),
    findFirstSemanticValue(roots, ['message', 'completionMessage', 'terminalMessage', 'endMessage'], { maxDepth: 3 }),
  ].map((value) => normalizeString(value, '')).join(' ');
  const blockComplete = booleanFromSemanticValue(findFirstSemanticValue(roots, [
    'blockComplete', 'isBlockComplete', 'blockCompleted', 'currentBlockComplete', 'blockFinished', 'blockEnded', 'endOfBlock',
  ], { maxDepth: 3 })) || /\bblock\b[^.]{0,60}\b(?:complete|completed|finished|ended)\b/i.test(statusText);
  const examComplete = booleanFromSemanticValue(findFirstSemanticValue(roots, [
    'examComplete', 'isExamComplete', 'testComplete', 'isTestComplete', 'examFinished', 'testFinished', 'examEnded', 'testEnded', 'submitted', 'isSubmitted',
  ], { maxDepth: 3 })) || /\b(?:exam|test)\b[^.]{0,60}\b(?:complete|completed|finished|ended|submitted)\b/i.test(statusText);
  const allBlocksComplete = examComplete || booleanFromSemanticValue(findFirstSemanticValue(roots, [
    'allBlocksComplete', 'allBlocksCompleted', 'blocksComplete', 'sectionsComplete', 'allSectionsComplete',
  ], { maxDepth: 3 })) || /\ball\s+blocks?\b[^.]{0,60}\b(?:complete|completed|finished|ended)\b/i.test(statusText);
  const explicitCompletedBlocks = normalizeCompletedBlockNumbers(findFirstSemanticValue(roots, [
    'completedBlockNumbers', 'completeBlockNumbers', 'completedBlocks', 'completeBlocks', 'finishedBlocks', 'endedBlocks',
  ], { maxDepth: 3 }));
  const inferredCompletedBlocks = inferCompletedBlockNumbersFromTerminal({ currentBlock, blockCount }, {
    blockComplete,
    examComplete,
    allBlocksComplete,
    currentBlock,
    blockCount,
  });
  const completedBlockNumbers = explicitCompletedBlocks.length ? explicitCompletedBlocks : inferredCompletedBlocks;
  const fallback = fallbackTerminalState || {};
  const isTerminal = Boolean(blockComplete || examComplete || allBlocksComplete || fallback.isTerminal);

  return Object.freeze({
    isTerminal,
    blockComplete,
    examComplete,
    allBlocksComplete,
    currentBlock: currentBlock || (fallback && fallback.currentBlock) || 0,
    completedBlockNumbers: Object.freeze(completedBlockNumbers.length ? completedBlockNumbers : (fallback.completedBlockNumbers || [])),
    source: WEBFRED_STATE_SOURCE.ANGULAR,
    detectedAt: nowIso(),
    reason: isTerminal ? 'angular-terminal-state' : '',
  });
}

function extractAngularState(adapterWindow, adapterDocument, angularServices, domState) {
  const roots = collectAngularStateRoots(angularServices);
  const fallbackExamIdentity = domState && domState.examIdentity ? domState.examIdentity : extractExamIdentityFromDom(adapterDocument, adapterWindow);
  const examIdentity = normalizeExamIdentityFromAngular(roots, fallbackExamIdentity);
  const launchedScope = normalizeLaunchedScopeFromAngular(roots, domState && domState.launchedScope);
  const currentBlock = coercePositiveInteger(
    domState && domState.currentBlock,
    coercePositiveInteger(findFirstSemanticValue(roots, ['currentBlock', 'blockNumber', 'activeBlock', 'selectedBlock'], { maxDepth: 3 }), 0)
  );
  const blockCount = coercePositiveInteger(
    domState && domState.blockCount,
    coercePositiveInteger(findFirstSemanticValue(roots, ['blockCount', 'numberOfBlocks', 'totalBlocks', 'blocksCount'], { maxDepth: 3 }), 0)
  );
  const itemCount = coercePositiveInteger(
    domState && domState.itemCount,
    coercePositiveInteger(findFirstSemanticValue(roots, ['itemCount', 'questionCount', 'itemsCount', 'totalItems', 'totalQuestions'], { maxDepth: 3 }), 0)
  );

  const rawItemList = findFirstSemanticValue(roots, ['itemList', 'items', 'questions', 'questionList', 'testItems'], { maxDepth: 3 });
  const rawCurrentItem = findFirstSemanticValue(roots, ['currentItem', 'activeItem', 'selectedItem', 'item', 'currentQuestion'], { maxDepth: 3 });
  const fallbackItem = domState && domState.currentItem ? domState.currentItem : null;
  const scopedRawItemList = selectAngularItemsForCurrentBlock(rawItemList, currentBlock, domState);
  const itemList = rebaseAngularItemsForCurrentBlock(normalizeItemListFromAngular(scopedRawItemList, {
    examIdentity,
    blockNumber: currentBlock || (fallbackItem && fallbackItem.blockNumber) || 1,
    fallbackItem,
  }), currentBlock || (fallbackItem && fallbackItem.blockNumber) || 0);
  let currentItem = isReadableObject(rawCurrentItem)
    ? normalizeAngularItem(rawCurrentItem, {
        examIdentity,
        blockNumber: currentBlock || (fallbackItem && fallbackItem.blockNumber) || 1,
        index: fallbackItem && fallbackItem.itemIndex,
        fallback: fallbackItem,
      })
    : null;

  if (currentItem && itemList.length) {
    const matchedItem = itemList.find((item) => (
      (currentItem.questionId && item.questionId === currentItem.questionId)
        || (currentItem.componentId && item.componentId === currentItem.componentId)
        || (currentItem.medleyId && item.medleyId === currentItem.medleyId && item.itemIndex === currentItem.itemIndex)
    ));
    if (matchedItem) {
      currentItem = Object.freeze({
        ...currentItem,
        blockNumber: matchedItem.blockNumber,
        itemIndex: matchedItem.itemIndex,
        current: true,
      });
    }
  }

  if ((!currentItem || currentItem.identitySource !== 'component-medley') && itemList.length) {
    const currentFromList = itemList.find((item) => item.current)
      || itemList.find((item) => fallbackItem && item.itemIndex === fallbackItem.itemIndex)
      || itemList[0];
    currentItem = currentFromList;
  }

  if (!currentItem && fallbackItem) {
    currentItem = fallbackItem;
  }

  const rawAnswers = findFirstSemanticValue(roots, ['answers', 'responses', 'itemResponses', 'selectedAnswers', 'answerMap'], { maxDepth: 3 });
  const answers = normalizeAnswersFromAngular(rawAnswers, itemList, currentItem);
  const rawMarks = findFirstSemanticValue(roots, ['marks', 'markedItems', 'flaggedItems', 'flags', 'markMap'], { maxDepth: 3 });
  const marks = normalizeMarksFromAngular(rawMarks, itemList, currentItem);
  const rawContent = findFirstSemanticValue(roots, ['currentContent', 'content', 'itemContent', 'currentItemContent', 'contents'], { maxDepth: 3 });
  const angularContent = normalizeCurrentContentFromAngular(rawContent, currentItem);
  const currentContent = angularContent || (domState && domState.currentContent) || null;
  const rawBlocks = findFirstSemanticValue(roots, ['blocks', 'blockList', 'sections', 'blockMetadata'], { maxDepth: 3 });
  const shouldTrustDomBlock = Boolean((domState && domState.currentBlock) || itemList.length || (domState && domState.itemCount));
  const blockMetadata = normalizeBlockMetadataFromAngular(shouldTrustDomBlock ? [] : rawBlocks, currentBlock, blockCount, itemList.length || (domState && domState.itemCount) || itemCount);
  const terminalState = extractTerminalStateFromAngular(roots, currentBlock, blockCount, domState && domState.terminalState);

  return Object.freeze({
    source: WEBFRED_STATE_SOURCE.ANGULAR,
    examIdentity,
    launchedScope,
    currentBlock: currentBlock || (currentItem && currentItem.blockNumber) || 0,
    blockCount,
    itemCount: itemList.length || (domState && domState.itemCount) || itemCount || 0,
    currentItem,
    itemList,
    answers,
    marks,
    currentContent,
    blockMetadata,
    terminalState,
    capabilities: Object.freeze({
      hasAngularServices: Boolean(angularServices && angularServices.resolvedNames && angularServices.resolvedNames.length),
      hasTrustedIdentity: Boolean(currentItem && currentItem.identitySource === 'component-medley'),
      hasItemList: itemList.length > 0,
      hasAnswers: Object.keys(answers).length > 0,
      hasMarks: Object.keys(marks).length > 0,
      hasCurrentContent: Boolean(currentContent && (currentContent.renderedHtml || currentContent.promptHtml)),
    }),
    degradedReasons: [],
    raw: Object.freeze({
      resolvedServices: angularServices && angularServices.resolvedNames ? angularServices.resolvedNames : [],
    }),
  });
}

function mergeWebfredCapabilities(primary, fallback) {
  return Object.freeze({
    hasAngularServices: Boolean(primary && primary.hasAngularServices),
    hasDomFallback: Boolean((primary && primary.hasDomFallback) || (fallback && fallback.hasDomFallback)),
    hasTrustedIdentity: Boolean((primary && primary.hasTrustedIdentity) || (fallback && fallback.hasTrustedIdentity)),
    hasItemList: Boolean((primary && primary.hasItemList) || (fallback && fallback.hasItemList)),
    hasAnswers: Boolean((primary && primary.hasAnswers) || (fallback && fallback.hasAnswers)),
    hasMarks: Boolean((primary && primary.hasMarks) || (fallback && fallback.hasMarks)),
    hasCurrentContent: Boolean((primary && primary.hasCurrentContent) || (fallback && fallback.hasCurrentContent)),
  });
}

function mergeWebfredState(angularState, domState, options = {}) {
  const hasAngular = Boolean(angularState && angularState.capabilities && angularState.capabilities.hasAngularServices);
  const primary = hasAngular ? angularState : domState;
  const fallback = hasAngular ? domState : angularState;
  const currentTime = nowIso();

  if (!primary) {
    return createEmptyWebfredState('no-state-source');
  }

  const currentItem = primary.currentItem || (fallback && fallback.currentItem) || null;
  const itemList = primary.itemList && primary.itemList.length
    ? primary.itemList
    : ((fallback && fallback.itemList) || []);
  const answers = Object.freeze({
    ...((fallback && fallback.answers) || {}),
    ...(primary.answers || {}),
  });
  const marks = Object.freeze({
    ...((fallback && fallback.marks) || {}),
    ...(primary.marks || {}),
  });
  const currentContent = primary.currentContent || (fallback && fallback.currentContent) || null;
  const primaryTerminal = primary.terminalState || {};
  const fallbackTerminal = fallback && fallback.terminalState ? fallback.terminalState : {};
  const terminalState = Object.freeze({
    ...fallbackTerminal,
    ...primaryTerminal,
    isTerminal: Boolean(primaryTerminal.isTerminal || fallbackTerminal.isTerminal),
    blockComplete: Boolean(primaryTerminal.blockComplete || fallbackTerminal.blockComplete),
    examComplete: Boolean(primaryTerminal.examComplete || fallbackTerminal.examComplete),
    allBlocksComplete: Boolean(primaryTerminal.allBlocksComplete || fallbackTerminal.allBlocksComplete),
    completedBlockNumbers: Object.freeze(uniqueNormalizedStrings([
      ...((fallbackTerminal && fallbackTerminal.completedBlockNumbers) || []),
      ...((primaryTerminal && primaryTerminal.completedBlockNumbers) || []),
    ]).map((entry) => coercePositiveInteger(entry, 0)).filter(Boolean).sort((left, right) => left - right)),
  });
  const capabilities = mergeWebfredCapabilities(primary.capabilities, fallback && fallback.capabilities);
  const degradedReasons = uniqueNormalizedStrings([
    ...((fallback && fallback.degradedReasons) || []),
    ...((primary && primary.degradedReasons) || []),
  ]);
  const status = determineWebfredStatus({
    currentItem,
    itemList,
    currentContent,
    capabilities,
    degradedReasons,
    hasAngular,
  });

  return Object.freeze({
    status,
    source: hasAngular && domState && domState.capabilities && domState.capabilities.hasDomFallback
      ? WEBFRED_STATE_SOURCE.MIXED
      : primary.source,
    initializedAt: options.initializedAt || currentTime,
    lastUpdatedAt: currentTime,
    degradedReasons: Object.freeze(status === WEBFRED_ADAPTER_STATUS.READY ? [] : determineDegradedReasons({
      currentItem,
      itemList,
      currentContent,
      capabilities,
      existingReasons: degradedReasons,
      hasAngular,
    })),
    capabilities,
    examIdentity: Object.freeze({
      ...((fallback && fallback.examIdentity) || {}),
      ...(primary.examIdentity || {}),
    }),
    launchedScope: Object.freeze({
      ...((fallback && fallback.launchedScope) || {}),
      ...(primary.launchedScope || {}),
    }),
    currentBlock: primary.currentBlock || (fallback && fallback.currentBlock) || (currentItem && currentItem.blockNumber) || 0,
    blockCount: primary.blockCount || (fallback && fallback.blockCount) || 0,
    itemCount: primary.itemCount || itemList.length || (fallback && fallback.itemCount) || 0,
    currentItem,
    itemList: Object.freeze(itemList),
    answers,
    marks,
    currentContent,
    blockMetadata: Object.freeze((primary.blockMetadata && primary.blockMetadata.length)
      ? primary.blockMetadata
      : ((fallback && fallback.blockMetadata) || [])),
    terminalState,
    raw: Object.freeze({
      angular: angularState && angularState.raw ? angularState.raw : {},
      dom: domState && domState.raw ? domState.raw : {},
    }),
  });
}

function determineWebfredStatus(summary) {
  const reasons = determineDegradedReasons({
    currentItem: summary.currentItem,
    itemList: summary.itemList,
    currentContent: summary.currentContent,
    capabilities: summary.capabilities,
    existingReasons: summary.degradedReasons,
    hasAngular: summary.hasAngular,
  });

  if (!summary.currentItem && (!summary.itemList || !summary.itemList.length)) {
    return WEBFRED_ADAPTER_STATUS.UNAVAILABLE;
  }
  return reasons.length ? WEBFRED_ADAPTER_STATUS.DEGRADED : WEBFRED_ADAPTER_STATUS.READY;
}

function determineDegradedReasons(summary) {
  const reasons = Array.isArray(summary.existingReasons) ? summary.existingReasons.slice() : [];
  const capabilities = summary.capabilities || {};
  if (!summary.hasAngular) {
    reasons.push('angular-services-unavailable');
  }
  if (!summary.currentItem) {
    reasons.push('current-item-unavailable');
  }
  if (!capabilities.hasTrustedIdentity) {
    reasons.push('trusted-question-identity-unavailable');
  }
  if (!capabilities.hasItemList) {
    reasons.push('item-list-unavailable');
  }
  if (!capabilities.hasCurrentContent) {
    reasons.push('current-content-unavailable');
  }
  return uniqueNormalizedStrings(reasons);
}

function snapshotForAttemptPosition(adapterState) {
  const currentItem = adapterState && adapterState.currentItem ? adapterState.currentItem : null;
  if (!currentItem) {
    return Object.freeze({});
  }
  return Object.freeze({
    questionId: currentItem.questionId,
    blockNumber: currentItem.blockNumber,
    itemIndex: currentItem.itemIndex,
    componentId: currentItem.componentId,
    medleyId: currentItem.medleyId,
    identitySource: currentItem.identitySource,
  });
}

function createWebfredSiteAdapter(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const logger = options.logger || createLogger(createSettingsStore(adapterWindow.localStorage, STORAGE_KEYS.SETTINGS));
  const initTimeoutMs = coercePositiveInteger(options.initTimeoutMs, WEBFRED_ADAPTER_CONFIG.INIT_TIMEOUT_MS);
  const pollIntervalMs = coercePositiveInteger(options.pollIntervalMs, WEBFRED_ADAPTER_CONFIG.INIT_POLL_INTERVAL_MS);
  let initializedAt = null;
  let lastAngularServices = null;
  let lastState = createEmptyWebfredState('adapter-created');
  let initPromise = null;
  const listeners = new Set();

  function notify(state) {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        logger.debug('WebFRED adapter listener failed.', error);
      }
    });
  }

  function readAngularServices() {
    const injector = findAngularInjector(adapterWindow, adapterDocument);
    lastAngularServices = resolveAngularServices(injector, logger, adapterWindow, adapterDocument);
    return lastAngularServices;
  }

  function readState() {
    const domState = extractDomFallbackState(adapterWindow, adapterDocument);
    const angularServices = readAngularServices();
    const hasAngular = Boolean(angularServices && angularServices.resolvedNames && angularServices.resolvedNames.length);
    const angularState = hasAngular ? extractAngularState(adapterWindow, adapterDocument, angularServices, domState) : null;
    if (!initializedAt && (hasAngular || (domState.capabilities && domState.capabilities.hasDomFallback))) {
      initializedAt = nowIso();
    }
    lastState = mergeWebfredState(angularState, domState, { initializedAt });
    notify(lastState);
    return lastState;
  }

  function waitForInitialization(waitOptions = {}) {
    if (initPromise) {
      return initPromise;
    }

    const timeoutMs = coercePositiveInteger(waitOptions.timeoutMs, initTimeoutMs);
    const intervalMs = coercePositiveInteger(waitOptions.pollIntervalMs, pollIntervalMs);
    const startedAt = safeNowMs(adapterWindow);
    initPromise = new Promise((resolve) => {
      const poll = () => {
        let state;
        try {
          state = readState();
        } catch (error) {
          logger.debug('WebFRED adapter polling failed.', error);
          state = createEmptyWebfredState('adapter-read-failed');
        }

        if (state.status === WEBFRED_ADAPTER_STATUS.READY || state.status === WEBFRED_ADAPTER_STATUS.DEGRADED) {
          resolve(state);
          return;
        }

        const elapsed = safeNowMs(adapterWindow) - startedAt;
        if (elapsed >= timeoutMs) {
          lastState = mergeWebfredState(null, extractDomFallbackState(adapterWindow, adapterDocument), { initializedAt });
          resolve(Object.freeze({
            ...lastState,
            status: lastState.status === WEBFRED_ADAPTER_STATUS.READY ? WEBFRED_ADAPTER_STATUS.DEGRADED : lastState.status,
            degradedReasons: Object.freeze(uniqueNormalizedStrings((lastState.degradedReasons || []).concat('initialization-timeout'))),
          }));
          return;
        }

        adapterWindow.setTimeout(poll, intervalMs);
      };
      adapterWindow.setTimeout(poll, 0);
    }).finally(() => {
      initPromise = null;
    });
    return initPromise;
  }

  function onStateChange(listener) {
    if (typeof listener !== 'function') {
      throw createWebfredAdapterError('WebFRED adapter listener must be a function.');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    constants: Object.freeze({
      status: WEBFRED_ADAPTER_STATUS,
      source: WEBFRED_STATE_SOURCE,
      config: WEBFRED_ADAPTER_CONFIG,
    }),
    waitForInitialization,
    readState,
    getLastState() {
      return lastState;
    },
    getAngularServices() {
      return lastAngularServices || readAngularServices();
    },
    onStateChange,
    getAttemptPosition() {
      return snapshotForAttemptPosition(lastState);
    },
    isReady() {
      return lastState.status === WEBFRED_ADAPTER_STATUS.READY || lastState.status === WEBFRED_ADAPTER_STATUS.DEGRADED;
    },
    isDegraded() {
      return lastState.status === WEBFRED_ADAPTER_STATUS.DEGRADED || lastState.status === WEBFRED_ADAPTER_STATUS.UNAVAILABLE;
    },
  });
}

// Phase 5 tracking engine lives below this marker.

export {
  createWebfredSiteAdapter,
  createWebfredAdapterError,
  safeNowMs,
  firstNonEmpty,
  normalizeIdentifierPart,
  coercePositiveInteger,
  normalizeMaybeBoolean,
  safeElementText,
  safeAttribute,
  safeDatasetValue,
  isDomElement,
  isProbablyVisible,
  uniqueNormalizedStrings,
  buildQuestionIdentity,
  createEmptyWebfredState,
  findCurrentDomItemRoot,
  extractExamIdentityFromDom,
  extractResourceUrls,
  extractChoicesFromDom,
  extractSelectedAnswerIdFromDom,
  extractQuestionIdentityFromDom,
  extractCurrentContentFromDom,
  extractNavigationStateFromDom,
  findKeyNavigationItem,
  isNavigationKeyItem,
  safeInvokeFunction,
  isReadableObject,
  safeOwnKeys,
  readCandidateProperty,
  readCandidateMethod,
  findFirstSemanticValue,
  findAllSemanticValues,
  collectAngularStateRoots,
  safeJsonCompatibleValue,
  valueToArray,
  normalizeChoiceFromAngular,
  normalizeChoicesFromAngular,
  snapshotForAttemptPosition,
};
