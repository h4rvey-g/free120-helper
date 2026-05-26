import { STORAGE_KEYS, WEBFRED_ADAPTER_STATUS, WEBFRED_STATE_SOURCE, WEBFRED_ADAPTER_CONFIG, WEBFRED_ANGULAR_SERVICE_CANDIDATES } from '../core/constants.js';
import { coercePositiveInteger, firstNonEmpty, isPlainObject, normalizeString, sanitizeJsonCompatible, uniqueNormalizedStrings } from '../core/data.js';
import { createLogger, nowIso } from '../core/logger.js';
import { createSettingsStore } from '../core/settings.js';

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

function normalizeIdentifierPart(value) {
  return normalizeString(value, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.:-]/g, '')
    .slice(0, 120);
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

function safeVisibleText(element) {
  if (!element) {
    return '';
  }
  try {
    return normalizeString(element.innerText || element.textContent || '', '');
  } catch (_error) {
    return safeElementText(element);
  }
}

function safeSmallPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 1000 ? parsed : fallback;
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
  const blockPart = blockNumber ? `Block-${blockNumber}` : '';
  const identityPrefixParts = [examProgram, examName, ...uniqueNormalizedStrings([examSection, blockPart])].filter(Boolean);
  const primaryParts = [...identityPrefixParts, medleyId, componentId].filter(Boolean);
  const fallbackParts = [...identityPrefixParts, fallbackItemId].filter(Boolean);
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
  if (stepMatch) {
    return stepMatch[0].replace(/\s+/g, ' ').trim();
  }
  const codeMatch = text.match(/\bSTPF\s*(1|2|3)\b/i);
  if (!codeMatch) {
    return '';
  }
  return codeMatch[1] === '2' ? 'Step 2 CK' : `Step ${codeMatch[1]}`;
}

function extractBlockNumberFromText(value) {
  const match = normalizeString(value, '').match(/\bblock\s*(\d+)\b/i);
  return match ? match[1] : '';
}

function isGenericProgramText(value) {
  return /^(?:usmle|nbme)$/i.test(normalizeString(value, ''));
}

function isGenericExamDriverText(value) {
  const text = normalizeString(value, '').replace(/\s+/g, ' ');
  return /^(?:nbme\s*)?(?:exam\s*)?driver$/i.test(text)
    || /\bnbme\s+exam\s+driver\b/i.test(text);
}

function preferSpecificText(primary, fallback, genericPredicate) {
  const primaryText = normalizeString(primary, '');
  const fallbackText = normalizeString(fallback, '');
  if (fallbackText && (!primaryText || (typeof genericPredicate === 'function' && genericPredicate(primaryText) && !genericPredicate(fallbackText)))) {
    return fallbackText;
  }
  return primaryText || fallbackText;
}

function getUrlFromWindow(adapterWindow) {
  try {
    return adapterWindow && adapterWindow.location ? new URL(adapterWindow.location.href) : null;
  } catch (_error) {
    return null;
  }
}

function getMergedSearchParams(adapterWindow) {
  const url = getUrlFromWindow(adapterWindow);
  const searchParams = new URLSearchParams(url ? url.search : '');
  const hash = normalizeString(url && url.hash, '');
  const hashQueryIndex = hash.indexOf('?');
  if (hashQueryIndex >= 0) {
    const hashQuery = hash.slice(hashQueryIndex + 1).split('#')[0];
    const hashParams = new URLSearchParams(hashQuery);
    hashParams.forEach((value, key) => {
      if (!searchParams.has(key)) {
        searchParams.append(key, value);
      }
    });
  }
  return Object.freeze({ url, searchParams });
}

function readSearchParam(searchParams, names) {
  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    const direct = searchParams && searchParams.get(name);
    if (normalizeString(direct, '')) {
      return normalizeString(direct, '');
    }
  }
  const lowerNames = new Set(candidates.map((name) => normalizeString(name, '').toLowerCase()).filter(Boolean));
  if (!searchParams || !lowerNames.size) {
    return '';
  }
  for (const [key, value] of searchParams.entries()) {
    if (lowerNames.has(normalizeString(key, '').toLowerCase()) && normalizeString(value, '')) {
      return normalizeString(value, '');
    }
  }
  return '';
}

function getLaunchedScopeBlockNumber(scope) {
  if (!isPlainObject(scope)) {
    return 0;
  }
  return coercePositiveInteger(scope.block || scope.selectedBlock || scope.launchedBlock, 0)
    || coercePositiveInteger(extractBlockNumberFromText(scope.testDefinitionDisplayName || scope.displayName || scope.section || scope.testDefinitionName), 0);
}

function launchedScopeTextSuggestsAllBlocks(scope) {
  if (!isPlainObject(scope)) {
    return false;
  }
  return /\b(?:all|full|entire|whole|complete)\b/i.test([
    scope.mode,
    scope.testMode,
    scope.scope,
    scope.launchMode,
    scope.deliveryMode,
  ].map((value) => normalizeString(value, '')).join(' '));
}

function resolveEffectiveCurrentBlock(rawCurrentBlock, launchedScope, options = {}) {
  const currentBlock = coercePositiveInteger(rawCurrentBlock, 0);
  const scopeBlock = getLaunchedScopeBlockNumber(launchedScope);
  const blockCount = coercePositiveInteger(options.blockCount, 0);
  if (currentBlock && (launchedScopeTextSuggestsAllBlocks(launchedScope) || (blockCount > 1 && currentBlock !== scopeBlock))) {
    return currentBlock;
  }
  return scopeBlock || currentBlock;
}

function extractExamIdentityFromDom(adapterDocument, adapterWindow) {
  const title = normalizeString(adapterDocument && adapterDocument.title, '');
  const { searchParams } = getMergedSearchParams(adapterWindow);
  const rawProgram = readSearchParam(searchParams, ['program', 'Program', 'programName']);
  const rawExamName = readSearchParam(searchParams, ['exam', 'Exam', 'examName', 'assessmentName', 'formName']);
  const rawSection = readSearchParam(searchParams, ['section', 'Section', 'block', 'testDefinitionDisplayName', 'displayName', 'testDefinitionName']);
  const candidateText = [title, rawProgram, rawExamName, rawSection];
  const programFromText = extractProgramFromText(candidateText.join(' '));
  const program = firstNonEmpty([
    isGenericProgramText(rawProgram) ? programFromText : rawProgram,
    programFromText,
    rawProgram,
  ]);
  const examName = firstNonEmpty([
    isGenericExamDriverText(rawExamName) ? '' : rawExamName,
    isGenericExamDriverText(title) ? '' : title,
  ]);
  const section = rawSection;

  return Object.freeze({
    program,
    examName,
    section,
  });
}

function extractLaunchedScopeFromDom(adapterWindow) {
  const { url, searchParams } = getMergedSearchParams(adapterWindow);
  if (!url) {
    return Object.freeze({});
  }
  const scope = {};
  [
    'program', 'programName', 'exam', 'examName', 'section', 'block', 'mode', 'test', 'scope',
    'testDefinitionName', 'testDefinitionDisplayName', 'publicationName', 'displayName',
  ].forEach((key) => {
    const value = readSearchParam(searchParams, [key, key.toUpperCase()]);
    if (value) {
      scope[key] = value;
    }
  });
  if (!scope.block) {
    const blockNumber = extractBlockNumberFromText(scope.testDefinitionDisplayName || scope.displayName || scope.section || scope.testDefinitionName);
    if (blockNumber) {
      scope.block = blockNumber;
    }
  }
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

function extractCssUrlValues(value) {
  const text = normalizeString(value, '');
  const urls = [];
  text.replace(/url\((['"]?)([^'")]+)\1\)/gi, (_match, _quote, url) => {
    urls.push(url);
    return _match;
  });
  return urls;
}

function extractResourceUrls(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }
  const urls = [];
  root.querySelectorAll('img, source, audio, video, track, a[href], [style*="url("]').forEach((element) => {
    urls.push(
      safeAttribute(element, 'src')
        || safeAttribute(element, 'data-ng-src')
        || safeAttribute(element, 'ng-src')
        || safeAttribute(element, 'data-src')
        || safeAttribute(element, 'poster')
        || safeAttribute(element, 'href')
    );
    urls.push(...extractCssUrlValues(safeAttribute(element, 'style')));
  });
  return uniqueNormalizedStrings(urls);
}

function extractChoicesFromDom(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return [];
  }

  const optionRows = Array.from(root.querySelectorAll('ol.options > li.stContext, li.stContext'));
  const sourceRows = optionRows.length
    ? optionRows.map((element) => ({ element, input: element.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]') }))
    : Array.from(root.querySelectorAll('input.NBOptionInput, input[type="radio"], input[type="checkbox"]')).map((input) => ({
        input,
        element: (typeof input.closest === 'function' && input.closest('li, tr, label, .stContext, .NBOptionListComp, .answerbox')) || input.parentElement || input,
      }));
  const seen = new Set();
  return sourceRows
    .filter(({ input, element }) => {
      const key = firstNonEmpty([
        safeAttribute(input, 'name') && safeAttribute(input, 'value') && `${safeAttribute(input, 'name')}:${safeAttribute(input, 'value')}`,
        safeAttribute(input, 'id'),
        safeElementText(element),
      ]);
      if (key && seen.has(key)) {
        return false;
      }
      if (key) {
        seen.add(key);
      }
      return Boolean(input || element);
    })
    .map(({ element, input }, index) => {
      const label = optionRows.length ? (element.querySelector('span, label') || element) : element;
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

  const selectedInput = root.querySelector('input.NBOptionInput:checked, ol.options input[type="radio"]:checked, ol.options input[type="checkbox"]:checked, input[type="radio"]:checked, input[type="checkbox"]:checked');
  if (!selectedInput) {
    return '';
  }

  return firstNonEmpty([
    safeAttribute(selectedInput, 'value'),
    safeAttribute(selectedInput, 'id'),
    safeAttribute(selectedInput, 'name') && `${safeAttribute(selectedInput, 'name')}:${safeAttribute(selectedInput, 'value')}`,
  ]);
}

function extractQuestionIdentityFromDom(root, adapterDocument, adapterWindow, options = {}) {
  const medleyElement = root && typeof root.closest === 'function'
    ? root.closest('#medley, [id*="medley"], [data-medley-id]')
    : null;
  const answerBox = root && typeof root.querySelector === 'function'
    ? root.querySelector('div[id$="_div"].NBOptionListComp.answerbox, .NBOptionListComp.answerbox, .answerbox, input.NBOptionInput[name], ol.options input[name]')
    : null;
  const answerInput = answerBox && normalizeString(answerBox.tagName, '').toLowerCase() === 'input'
    ? answerBox
    : (root && typeof root.querySelector === 'function' ? root.querySelector('input.NBOptionInput[name], ol.options input[name]') : null);
  const answerBoxId = safeAttribute(answerBox, 'id');
  const answerBoxComponentId = answerBoxId && answerBoxId.endsWith('_div') ? answerBoxId.slice(0, -4) : firstNonEmpty([safeAttribute(answerBox, 'name'), safeAttribute(answerInput, 'name')]);
  const rawMedleyId = safeDatasetValue(medleyElement, 'medleyId') || safeAttribute(medleyElement, 'data-medley-id') || safeAttribute(medleyElement, 'id');
  const medleyId = /^medley$/i.test(rawMedleyId) ? '' : rawMedleyId;
  const examIdentity = extractExamIdentityFromDom(adapterDocument, adapterWindow);
  const navState = extractNavigationStateFromDom(adapterDocument, adapterWindow);
  const itemIndex = coercePositiveInteger(
    safeDatasetValue(root, 'itemIndex') || safeDatasetValue(root, 'index') || safeAttribute(root, 'data-ng-init') && safeAttribute(root, 'data-ng-init').match(/index\D+(\d+)/i)?.[1],
    navState.currentItemIndex || 1
  );
  const blockNumber = coercePositiveInteger(options.currentBlock, 0)
    || navState.currentBlock
    || coercePositiveInteger(safeDatasetValue(root, 'block') || safeDatasetValue(root, 'blockNumber'), 1);

  return buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    medleyId,
    componentId: safeDatasetValue(root, 'componentId') || safeDatasetValue(root, 'component') || answerBoxComponentId || safeAttribute(root, 'id'),
    itemId: safeDatasetValue(root, 'itemId') || safeAttribute(root, 'data-item-id') || answerBoxComponentId || safeAttribute(root, 'id'),
    blockNumber,
    itemIndex,
  });
}

function expandContentRootForAssociatedMedia(root) {
  if (!root || typeof root.closest !== 'function') {
    return root;
  }
  const pageRoot = root.closest('div[id^="page"], .NBSinglePage');
  if (!pageRoot || !pageRoot.querySelector || pageRoot === root) {
    return root;
  }
  const hasAssociatedMedia = Boolean(pageRoot.querySelector('.NBMediaPlayer, .media-player, video, audio, img[src], source[src], [style*="url("]'));
  return hasAssociatedMedia ? pageRoot : root;
}

function extractCurrentContentFromDom(root) {
  if (!root) {
    return null;
  }
  const contentRoot = expandContentRootForAssociatedMedia(root);
  const promptElement = root.querySelector('div.NBExposition, .NBExposition, [class*="Exposition"]');
  const answerBox = root.querySelector('div[id$="_div"].NBOptionListComp.answerbox, .NBOptionListComp.answerbox, .answerbox');
  return Object.freeze({
    renderedHtml: contentRoot && contentRoot.outerHTML ? contentRoot.outerHTML : (contentRoot && contentRoot.innerHTML || ''),
    promptHtml: promptElement ? promptElement.innerHTML || '' : '',
    answerBoxHtml: answerBox ? answerBox.innerHTML || '' : '',
    choices: extractChoicesFromDom(root),
    resourceUrls: extractResourceUrls(contentRoot || root),
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
  const bodyText = safeVisibleText(adapterDocument.body || adapterDocument.documentElement);
  const blockMatch = bodyText.match(/Block\s*:\s*(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})(?!\d)/i)
    || bodyText.match(/Block\s+(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})(?!\d)/i)
    || bodyText.match(/Block\s*:\s*(\d{1,3})(?!\d)/i)
    || bodyText.match(/Block\s+(\d{1,3})(?!\d)/i);
  const currentBlock = blockMatch ? safeSmallPositiveInteger(blockMatch[1], 0) : 0;
  const blockCount = blockMatch && blockMatch[2] ? safeSmallPositiveInteger(blockMatch[2], 0) : 0;

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

function extractItemListFromDom(adapterDocument, adapterWindow, examIdentity, options = {}) {
  if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
    return [];
  }

  const nav = adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR);
  if (!nav) {
    return [];
  }

  const navState = extractNavigationStateFromDom(adapterDocument, adapterWindow);
  const effectiveCurrentBlock = coercePositiveInteger(options.currentBlock, navState.currentBlock || 1);
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
      blockNumber: effectiveCurrentBlock || 1,
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
  const effectiveCurrentBlock = resolveEffectiveCurrentBlock(navState.currentBlock, launchedScope, { blockCount: navState.blockCount });
  const terminalState = extractTerminalStateFromDom(adapterDocument, adapterWindow, { ...navState, currentBlock: effectiveCurrentBlock || navState.currentBlock });
  const itemList = extractItemListFromDom(adapterDocument, adapterWindow, examIdentity, { currentBlock: effectiveCurrentBlock });
  const identity = root ? extractQuestionIdentityFromDom(root, adapterDocument, adapterWindow, { currentBlock: effectiveCurrentBlock }) : buildQuestionIdentity({
    examProgram: examIdentity.program,
    examName: examIdentity.examName,
    examSection: examIdentity.section,
    blockNumber: effectiveCurrentBlock || navState.currentBlock || 1,
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
    currentBlock: effectiveCurrentBlock || navState.currentBlock || (currentItem && currentItem.blockNumber) || 0,
    blockCount: navState.blockCount,
    itemCount: navState.itemCount || itemList.length || (currentItem ? 1 : 0),
    currentItem,
    itemList,
    answers,
    marks,
    currentContent,
    blockMetadata: (effectiveCurrentBlock || navState.currentBlock) ? [{ blockNumber: effectiveCurrentBlock || navState.currentBlock, itemCount: navState.itemCount || itemList.length }] : [],
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

const RAW_ITEM_SELECTED_ANSWER_FIELDS = Object.freeze([
  'selectedAnswerId', 'selectedResponseId', 'selectedOptionId', 'answerId', 'responseId', 'userAnswerId', 'currentResponse', 'answer',
]);
const RESPONSE_SELECTED_ANSWER_FIELDS = Object.freeze([
  'selectedAnswerId', 'selectedResponseId', 'selectedOptionId', 'answerId', 'responseId', 'userAnswerId', 'currentResponse', 'optionId', 'choiceId', 'value', 'key', 'id', 'answer',
]);
const NESTED_RESPONSE_FIELDS = Object.freeze(['response', 'answer', 'selectedAnswer', 'selectedResponse', 'itemResponse', 'userAnswer']);
const CHOICE_COLLECTION_FIELDS = Object.freeze(['choices', 'options', 'answerOptions', 'answerChoices', 'answers']);

function readFirstDirectSemanticString(source, names) {
  if (!isReadableObject(source)) {
    return '';
  }
  for (const name of names) {
    const value = readCandidateProperty(source, [name]);
    const normalized = normalizeString(value, '');
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeSelectedAnswerIdFromNestedRecord(source) {
  if (!isReadableObject(source)) {
    return normalizeString(source, '');
  }
  if (Array.isArray(source)) {
    return '';
  }
  return readFirstDirectSemanticString(source, RESPONSE_SELECTED_ANSWER_FIELDS);
}

function normalizeSelectedAnswerIdFromNestedResponse(source) {
  if (!isReadableObject(source)) {
    return '';
  }
  for (const fieldName of NESTED_RESPONSE_FIELDS) {
    const nested = readCandidateProperty(source, [fieldName]);
    const answerId = normalizeSelectedAnswerIdFromNestedRecord(nested);
    if (answerId) {
      return answerId;
    }
  }
  return '';
}

function normalizeSelectedAnswerIdFromChoiceCollections(rawItem) {
  if (!isReadableObject(rawItem)) {
    return '';
  }
  for (const fieldName of CHOICE_COLLECTION_FIELDS) {
    const choices = valueToArray(readCandidateProperty(rawItem, [fieldName]));
    for (let index = 0; index < choices.length; index += 1) {
      const choice = choices[index];
      if (!isReadableObject(choice)) {
        continue;
      }
      const selected = normalizeMaybeBoolean(readCandidateProperty(choice, ['selected', 'isSelected', 'checked', 'isChecked']));
      if (selected === true) {
        return readFirstDirectSemanticString(choice, RESPONSE_SELECTED_ANSWER_FIELDS) || `option-${index + 1}`;
      }
    }
  }
  return '';
}

function normalizeSelectedAnswerIdFromAngularItem(rawItem) {
  if (!isReadableObject(rawItem)) {
    return '';
  }
  return firstNonEmpty([
    readFirstDirectSemanticString(rawItem, RAW_ITEM_SELECTED_ANSWER_FIELDS),
    normalizeSelectedAnswerIdFromNestedResponse(rawItem),
    normalizeSelectedAnswerIdFromChoiceCollections(rawItem),
  ]);
}

function normalizeSelectedAnswerIdFromAnswerRecord(record) {
  if (!isReadableObject(record)) {
    return normalizeString(record, '');
  }
  return firstNonEmpty([
    readFirstDirectSemanticString(record, RESPONSE_SELECTED_ANSWER_FIELDS),
    normalizeSelectedAnswerIdFromNestedResponse(record),
    normalizeSelectedAnswerIdFromChoiceCollections(record),
  ]);
}

function parseBlockNumberFromTestDefinitionCode(value) {
  const match = normalizeString(value, '').match(/\bSTPF\s*(1|2|3)\s*C0*(\d+)/i);
  if (!match) {
    return 0;
  }
  const step = match[1];
  const code = Number(match[2]);
  if (!Number.isInteger(code)) {
    return 0;
  }
  if (step === '1' && code >= 137 && code <= 139) {
    return code - 136;
  }
  if (step === '2' && code >= 152 && code <= 154) {
    return code - 151;
  }
  if (step === '3' && code >= 328 && code <= 331) {
    return code - 327;
  }
  return 0;
}

function getStepLabelFromTestDefinitionCode(value) {
  const match = normalizeString(value, '').match(/\bSTPF\s*(1|2|3)\s*C0*\d+/i);
  if (!match) {
    return '';
  }
  return match[1] === '2' ? 'Step 2 CK' : `Step ${match[1]}`;
}

function isKeyLikeDisplayName(value) {
  return /^(?:key|answer\s*key|answers?)$/i.test(normalizeString(value, ''));
}

function inferSingleBlockDefinitionFromBlockMap(rawBlockMap) {
  const entries = valueToArray(rawBlockMap).filter(isReadableObject);
  if (entries.length !== 1) {
    return Object.freeze({ blockNumber: 0, testDefinitionName: '', testDefinitionDisplayName: '' });
  }
  const entry = entries[0];
  const testDefinitionName = firstNonEmpty([
    readCandidateProperty(entry, ['testDefinitionName', 'testDefinition', 'name', 'id']),
  ]);
  const rawDisplayName = firstNonEmpty([
    readCandidateProperty(entry, ['testDefinitionDisplayName', 'displayName', 'blockName', 'sectionName', 'title', 'label', 'caption']),
  ]);
  const text = [testDefinitionName, rawDisplayName].join(' ');
  const blockNumber = coercePositiveInteger(extractBlockNumberFromText(text), parseBlockNumberFromTestDefinitionCode(text));
  const stepLabel = getStepLabelFromTestDefinitionCode(text);
  const displayName = !isKeyLikeDisplayName(rawDisplayName) && extractBlockNumberFromText(rawDisplayName)
    ? rawDisplayName
    : (blockNumber ? `${stepLabel || 'Block'}${stepLabel ? ' Block ' : ' '}${blockNumber}` : '');
  return Object.freeze({ blockNumber, testDefinitionName, testDefinitionDisplayName: displayName });
}

function normalizeExamIdentityFromAngular(roots, fallbackIdentity) {
  const fallback = fallbackIdentity || {};
  const rawProgram = firstNonEmpty([
    findFirstSemanticValue(roots, ['examProgram', 'program', 'programName', 'usmleProgram', 'testProgram'], { maxDepth: 3 }),
    fallback.program,
  ]);
  const rawExamName = firstNonEmpty([
    findFirstSemanticValue(roots, ['examName', 'examTitle', 'testName', 'assessmentName', 'formName'], { maxDepth: 3 }),
    fallback.examName,
  ]);
  const rawSection = firstNonEmpty([
    findFirstSemanticValue(roots, ['testDefinitionDisplayName', 'sectionName', 'examSection', 'section', 'sectionTitle', 'blockName'], { maxDepth: 3 }),
    fallback.section,
  ]);
  const identityText = [rawProgram, rawExamName, rawSection, fallback.program, fallback.examName, fallback.section].join(' ');
  const programFromText = extractProgramFromText(identityText);
  const program = firstNonEmpty([
    isGenericProgramText(rawProgram) ? programFromText : rawProgram,
    programFromText,
    rawProgram,
  ]);
  const examName = isGenericExamDriverText(rawExamName)
    ? (isGenericExamDriverText(fallback.examName) ? '' : normalizeString(fallback.examName, ''))
    : preferSpecificText(rawExamName, fallback.examName, isGenericExamDriverText);
  const section = rawSection;

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
  const rawBlockMap = findFirstSemanticValue(roots, ['blockMap'], { maxDepth: 4 });
  const blockMapEntries = valueToArray(rawBlockMap).filter(isReadableObject);
  const inferredBlockCount = coercePositiveInteger(
    findFirstSemanticValue(roots, ['blockCount', 'numberOfBlocks', 'totalBlocks', 'blocksCount'], { maxDepth: 3 }),
    blockMapEntries.length
  );
  const blockMapDefinition = inferSingleBlockDefinitionFromBlockMap(rawBlockMap);
  const rawScopeDisplayName = isReadableObject(rawScope) && readCandidateProperty(rawScope, ['testDefinitionDisplayName', 'displayName', 'blockName', 'sectionName', 'name']);
  const semanticDisplayName = findFirstSemanticValue(roots, ['testDefinitionDisplayName', 'blockName', 'sectionName', 'displayName'], { maxDepth: 3 });
  const rawDisplayName = firstNonEmpty([
    !isKeyLikeDisplayName(rawScopeDisplayName) ? rawScopeDisplayName : '',
    !isKeyLikeDisplayName(semanticDisplayName) ? semanticDisplayName : '',
    blockMapDefinition.testDefinitionDisplayName,
    rawScopeDisplayName,
    semanticDisplayName,
    fallback.testDefinitionDisplayName,
    fallback.displayName,
    fallback.section,
  ]);
  const rawTestDefinitionName = firstNonEmpty([
    isReadableObject(rawScope) && readCandidateProperty(rawScope, ['testDefinitionName', 'testDefinition']),
    findFirstSemanticValue(roots, ['testDefinitionName', 'testDefinition'], { maxDepth: 3 }),
    blockMapDefinition.testDefinitionName,
    fallback.testDefinitionName,
  ]);
  const explicitBlock = firstNonEmpty([
    isReadableObject(rawScope) && readCandidateProperty(rawScope, ['block', 'blockNumber', 'selectedBlock', 'launchedBlock']),
    findFirstSemanticValue(roots, ['selectedBlock', 'launchedBlock', 'blockNumber'], { maxDepth: 2 }),
    blockMapDefinition.blockNumber,
    fallback.block,
  ]);
  const blockFromText = extractBlockNumberFromText([rawDisplayName, rawTestDefinitionName, fallback.section].join(' '));
  return Object.freeze({
    ...fallback,
    ...(isPlainObject(scope) ? scope : {}),
    mode: firstNonEmpty([
      isReadableObject(rawScope) && readCandidateProperty(rawScope, ['mode', 'examMode', 'testMode']),
      findFirstSemanticValue(roots, ['mode', 'examMode', 'testMode'], { maxDepth: 2 }),
      fallback.mode,
      inferredBlockCount > 1 ? 'all' : '',
    ]),
    blockCount: inferredBlockCount || coercePositiveInteger(fallback.blockCount || fallback.blocks || fallback.totalBlocks, 0),
    block: firstNonEmpty([explicitBlock, blockFromText]),
    testDefinitionName: rawTestDefinitionName,
    testDefinitionDisplayName: rawDisplayName,
    publicationName: firstNonEmpty([
      isReadableObject(rawScope) && readCandidateProperty(rawScope, ['publicationName', 'examPublicationName']),
      findFirstSemanticValue(roots, ['publicationName', 'examPublicationName'], { maxDepth: 3 }),
      fallback.publicationName,
    ]),
  });
}

function parseAngularDisplayItemIndex(rawItem) {
  const displayText = firstNonEmpty([
    readCandidateProperty(rawItem, ['displayableName', 'displayName', 'label', 'title', 'caption']),
  ]);
  const normalized = normalizeString(displayText, '').replace(/\u00a0/g, ' ').trim();
  if (!normalized || /\b(?:key|answer)\b/i.test(normalized)) {
    return 0;
  }
  const exact = normalized.match(/^\D*(\d{1,3})\D*$/);
  return exact ? coercePositiveInteger(exact[1], 0) : 0;
}

function normalizeAngularItemIndex(rawItem, fallbackIndex = 0) {
  const rawIndex = readCandidateProperty(rawItem, ['itemIndex', 'index', 'ordinal', 'position', 'number', 'sequence']);
  const fallback = coercePositiveInteger(fallbackIndex, 0);
  const displayIndex = parseAngularDisplayItemIndex(rawItem);
  if (displayIndex && fallback > 0 && displayIndex === fallback) {
    return displayIndex;
  }
  if (typeof rawIndex === 'number' && Number.isInteger(rawIndex) && rawIndex >= 0) {
    if (fallback > 0 && rawIndex === fallback - 1) {
      return fallback;
    }
    return rawIndex > 0 ? rawIndex : (fallback || 1);
  }
  if (typeof rawIndex === 'string' && /^\d+$/.test(rawIndex.trim())) {
    const parsed = Number(rawIndex.trim());
    if (fallback > 0 && parsed === fallback - 1) {
      return fallback;
    }
    return parsed > 0 ? parsed : (fallback || 1);
  }
  return displayIndex || fallback || 1;
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
  const itemIndex = normalizeAngularItemIndex(rawItem, indexFallback || 1);
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
  const selectedAnswerId = normalizeSelectedAnswerIdFromAngularItem(rawItem);
  const marked = normalizeMaybeBoolean(findFirstSemanticValue([rawItem], ['marked', 'isMarked', 'flagged', 'isFlagged', 'mark'], { maxDepth: 2 }));
  const rawAnswered = readCandidateProperty(rawItem, ['answered', 'isAnswered', 'complete', 'isComplete']);
  const answered = normalizeMaybeBoolean(rawAnswered !== undefined ? rawAnswered : findFirstSemanticValue([rawItem], ['answered', 'isAnswered', 'complete', 'isComplete'], { maxDepth: 2 }));
  const trustedSelectedAnswerId = answered === false ? '' : selectedAnswerId;

  return Object.freeze({
    questionId: identity.questionId,
    componentId: identity.componentId,
    medleyId: identity.medleyId,
    blockNumber: identity.blockNumber || blockNumber,
    itemIndex: identity.itemIndex || itemIndex,
    selectedAnswerId: trustedSelectedAnswerId,
    marked: marked === null ? false : marked,
    answered: answered === null ? Boolean(trustedSelectedAnswerId) : answered,
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
    if (startIndex >= 0 && startIndex + domItemCount <= rawItems.length) {
      return rawItems.slice(startIndex, startIndex + domItemCount);
    }
    return rawItems.slice(0, domItemCount);
  }

  return rawItems;
}

function rebaseAngularItemsForCurrentBlock(itemList, currentBlock = 0, expectedItemCount = 0) {
  const items = Array.isArray(itemList) ? itemList : [];
  if (!items.length) {
    return [];
  }
  const blockNumber = coercePositiveInteger(currentBlock, 0);
  const expectedCount = coercePositiveInteger(expectedItemCount, items.length);
  const indexes = items.map((item) => coercePositiveInteger(item && item.itemIndex, 0)).filter(Boolean);
  const maxIndex = indexes.length ? Math.max(...indexes) : 0;
  const minIndex = indexes.length ? Math.min(...indexes) : 0;
  const shouldRebaseIndex = Boolean(blockNumber > 1 && expectedCount > 0 && minIndex > expectedCount && maxIndex > expectedCount);
  const blockOffset = shouldRebaseIndex ? (blockNumber - 1) * expectedCount : 0;
  if (!blockNumber && !shouldRebaseIndex) {
    return items;
  }
  return items.map((item) => {
    const rawItemIndex = coercePositiveInteger(item && item.itemIndex, 0);
    const rebasedItemIndex = shouldRebaseIndex ? coercePositiveInteger(rawItemIndex - blockOffset, rawItemIndex) : rawItemIndex;
    return Object.freeze({
      ...item,
      blockNumber: blockNumber || item.blockNumber,
      itemIndex: rebasedItemIndex || item.itemIndex,
    });
  });
}

function addAnswerMapping(answers, questionId, answerId) {
  const normalizedQuestionId = normalizeString(questionId, '');
  const normalizedAnswerId = normalizeString(answerId, '');
  if (normalizedQuestionId && normalizedAnswerId) {
    answers[normalizedQuestionId] = normalizedAnswerId;
  }
}

function getDenseNumericKeyIndexBase(keys, itemCount) {
  const count = coercePositiveInteger(itemCount, 0);
  const list = Array.isArray(keys) ? keys : [];
  if (count <= 1 || list.length !== count) {
    return null;
  }
  const numericKeys = list.map((key) => {
    const text = normalizeString(key, '');
    return /^\d+$/.test(text) ? Number(text) : Number.NaN;
  });
  if (numericKeys.some((value) => !Number.isInteger(value))) {
    return null;
  }
  const sorted = numericKeys.slice().sort((left, right) => left - right);
  const oneBased = sorted.every((value, index) => value === index + 1);
  if (oneBased) {
    return 1;
  }
  const zeroBased = sorted.every((value, index) => value === index);
  return zeroBased ? 0 : null;
}

function getItemByDenseNumericKey(key, itemList, indexBase) {
  if (indexBase !== 0 && indexBase !== 1) {
    return null;
  }
  const index = Number(normalizeString(key, '')) - indexBase;
  return Number.isInteger(index) && index >= 0 && index < itemList.length ? itemList[index] : null;
}

function getSparseNumericKeyIndexBase(keys, itemCount, rawMap, currentItem = null) {
  const count = coercePositiveInteger(itemCount, 0);
  const list = Array.isArray(keys) ? keys : [];
  if (count <= 1 || !list.length || list.length > count) {
    return null;
  }
  const numericKeys = list.map((key) => {
    const text = normalizeString(key, '');
    return /^\d+$/.test(text) ? Number(text) : Number.NaN;
  });
  if (numericKeys.some((value) => !Number.isInteger(value))) {
    return null;
  }
  const candidates = [];
  if (numericKeys.every((value) => value >= 1 && value <= count)) {
    candidates.push(1);
  }
  if (numericKeys.every((value) => value >= 0 && value < count)) {
    candidates.push(0);
  }
  const currentIndex = coercePositiveInteger(currentItem && currentItem.itemIndex, 0);
  const currentAnswerId = normalizeString(currentItem && currentItem.selectedAnswerId, '');
  if (!currentIndex || !currentAnswerId) {
    return null;
  }
  return candidates.find((indexBase) => {
    const key = String(currentIndex + indexBase - 1);
    if (!Object.prototype.hasOwnProperty.call(rawMap, key)) {
      return false;
    }
    return normalizeString(rawMap[key], '') === currentAnswerId;
  }) ?? null;
}

function normalizeAnswersFromAngular(rawAnswers, itemList = [], currentItem = null) {
  const answers = {};
  const rawAnswerList = Array.isArray(rawAnswers) ? rawAnswers : [];
  const allowArrayIndexFallback = rawAnswerList.length > 0 && rawAnswerList.length === itemList.length;
  const itemsByQuestionId = new Map();
  const itemsByCandidateId = new Map();
  itemList.forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (questionId) {
      itemsByQuestionId.set(questionId, questionId);
    }
    [item && item.questionId, item && item.componentId].forEach((key) => {
      const normalized = normalizeString(key, '');
      if (normalized && questionId) {
        itemsByCandidateId.set(normalized, questionId);
      }
    });
  });

  if (currentItem && currentItem.selectedAnswerId && currentItem.answered !== false) {
    addAnswerMapping(answers, currentItem.questionId, currentItem.selectedAnswerId);
  }

  if (!rawAnswers) {
    itemList.forEach((item) => {
      if (item && item.answered !== false) {
        addAnswerMapping(answers, item.questionId, item.selectedAnswerId);
      }
    });
    return Object.freeze(answers);
  }

  if (!Array.isArray(rawAnswers) && isReadableObject(rawAnswers)) {
    const rawAnswerKeys = safeOwnKeys(rawAnswers);
    const denseNumericKeyIndexBase = getDenseNumericKeyIndexBase(rawAnswerKeys, itemList.length);
    const sparseNumericKeyIndexBase = denseNumericKeyIndexBase === null
      ? getSparseNumericKeyIndexBase(rawAnswerKeys, itemList.length, rawAnswers, currentItem)
      : null;
    rawAnswerKeys.forEach((key) => {
      let value;
      try {
        value = rawAnswers[key];
      } catch (_error) {
        value = null;
      }
      const numericItem = getItemByDenseNumericKey(key, itemList, denseNumericKeyIndexBase) || getItemByDenseNumericKey(key, itemList, sparseNumericKeyIndexBase);
      const mappedQuestionId = itemsByQuestionId.get(key) || itemsByCandidateId.get(key) || (numericItem && numericItem.questionId) || (itemList.length <= 1 ? key : '');
      addAnswerMapping(answers, mappedQuestionId, normalizeSelectedAnswerIdFromAnswerRecord(value));
    });
    itemList.forEach((item) => {
      if (item && item.answered !== false) {
        addAnswerMapping(answers, item.questionId, item.selectedAnswerId);
      }
    });
    return Object.freeze(answers);
  }

  valueToArray(rawAnswers).forEach((entry, index) => {
    if (!isReadableObject(entry)) {
      const item = (itemList.length <= 1 || allowArrayIndexFallback) ? itemList[index] : null;
      if (item) {
        addAnswerMapping(answers, item.questionId, entry);
      }
      return;
    }

    const rawQuestionId = firstNonEmpty([
      findFirstSemanticValue([entry], ['questionId', 'itemId', 'id', 'componentId', 'componentID', 'itemComponentId'], { maxDepth: 1 }),
    ]);
    const indexFallbackItem = allowArrayIndexFallback && !rawQuestionId ? itemList[index] : null;
    const mappedQuestionId = itemsByQuestionId.get(rawQuestionId) || itemsByCandidateId.get(rawQuestionId) || (indexFallbackItem && indexFallbackItem.questionId) || (itemList.length <= 1 ? rawQuestionId : '');
    const answerId = normalizeSelectedAnswerIdFromAnswerRecord(entry);
    addAnswerMapping(answers, mappedQuestionId, answerId);
  });

  itemList.forEach((item) => {
    if (item && item.answered !== false) {
      addAnswerMapping(answers, item.questionId, item.selectedAnswerId);
    }
  });
  return Object.freeze(answers);
}

function normalizeMarksFromAngular(rawMarks, itemList = [], currentItem = null) {
  const marks = {};
  const rawMarkList = Array.isArray(rawMarks) ? rawMarks : [];
  const allowArrayIndexFallback = rawMarkList.length > 0 && rawMarkList.length === itemList.length;
  const itemsByQuestionId = new Map();
  const itemsByCandidateId = new Map();
  itemList.forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (questionId) {
      itemsByQuestionId.set(questionId, questionId);
    }
    [item && item.questionId, item && item.componentId].forEach((key) => {
      const normalized = normalizeString(key, '');
      if (normalized && questionId) {
        itemsByCandidateId.set(normalized, questionId);
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
        ]);
        const indexFallbackItem = allowArrayIndexFallback && !rawQuestionId ? itemList[index] : null;
        const mappedQuestionId = itemsByQuestionId.get(rawQuestionId) || itemsByCandidateId.get(rawQuestionId) || (indexFallbackItem && indexFallbackItem.questionId) || (itemList.length <= 1 ? rawQuestionId : '');
        const marked = normalizeMaybeBoolean(findFirstSemanticValue([entry], ['marked', 'isMarked', 'flagged', 'isFlagged', 'value'], { maxDepth: 2 }));
        if (mappedQuestionId && marked) {
          marks[mappedQuestionId] = true;
        }
      } else if (entry) {
        const item = (itemList.length <= 1 || allowArrayIndexFallback) ? itemList[index] : null;
        if (item) {
          marks[item.questionId] = true;
        }
      }
    });
    return Object.freeze(marks);
  }

  if (isReadableObject(rawMarks)) {
    const rawMarkKeys = safeOwnKeys(rawMarks);
    const denseNumericKeyIndexBase = getDenseNumericKeyIndexBase(rawMarkKeys, itemList.length);
    const sparseNumericKeyIndexBase = denseNumericKeyIndexBase === null
      ? getSparseNumericKeyIndexBase(rawMarkKeys, itemList.length, rawMarks, currentItem)
      : null;
    rawMarkKeys.forEach((key) => {
      let value;
      try {
        value = rawMarks[key];
      } catch (_error) {
        value = null;
      }
      const marked = normalizeMaybeBoolean(value);
      const numericItem = getItemByDenseNumericKey(key, itemList, denseNumericKeyIndexBase) || getItemByDenseNumericKey(key, itemList, sparseNumericKeyIndexBase);
      const mappedQuestionId = itemsByQuestionId.get(key) || itemsByCandidateId.get(key) || (numericItem && numericItem.questionId) || (itemList.length <= 1 ? key : '');
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
  const blockCount = coercePositiveInteger(
    domState && domState.blockCount,
    coercePositiveInteger(findFirstSemanticValue(roots, ['blockCount', 'numberOfBlocks', 'totalBlocks', 'blocksCount'], { maxDepth: 3 }), 0)
  );
  const currentBlock = resolveEffectiveCurrentBlock(coercePositiveInteger(
    domState && domState.currentBlock,
    coercePositiveInteger(findFirstSemanticValue(roots, ['currentBlock', 'blockNumber', 'activeBlock', 'selectedBlock'], { maxDepth: 3 }), 0)
  ), launchedScope, { blockCount });
  const itemCount = coercePositiveInteger(
    domState && domState.itemCount,
    coercePositiveInteger(findFirstSemanticValue(roots, ['itemCount', 'questionCount', 'itemsCount', 'totalItems', 'totalQuestions'], { maxDepth: 3 }), 0)
  );

  const rawItemList = findFirstSemanticValue(roots, ['itemList', 'items', 'questions', 'questionList', 'testItems'], { maxDepth: 3 });
  const rawCurrentItem = findFirstSemanticValue(roots, ['currentItem', 'activeItem', 'selectedItem', 'item', 'currentQuestion'], { maxDepth: 3 });
  const fallbackItem = domState && domState.currentItem ? domState.currentItem : null;
  const expectedCurrentBlockItemCount = coercePositiveInteger(domState && domState.itemCount, coercePositiveInteger(itemCount, 0));
  const scopedRawItemList = selectAngularItemsForCurrentBlock(rawItemList, currentBlock, domState);
  const itemList = rebaseAngularItemsForCurrentBlock(normalizeItemListFromAngular(scopedRawItemList, {
    examIdentity,
    blockNumber: currentBlock || (fallbackItem && fallbackItem.blockNumber) || 1,
    fallbackItem,
  }), currentBlock || (fallbackItem && fallbackItem.blockNumber) || 0, expectedCurrentBlockItemCount);
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
  const scopedRawAnswers = Array.isArray(rawAnswers) ? selectAngularItemsForCurrentBlock(rawAnswers, currentBlock, domState) : rawAnswers;
  const answers = normalizeAnswersFromAngular(scopedRawAnswers, itemList, currentItem);
  const rawMarks = findFirstSemanticValue(roots, ['marks', 'markedItems', 'flaggedItems', 'flags', 'markMap'], { maxDepth: 3 });
  const scopedRawMarks = Array.isArray(rawMarks) ? selectAngularItemsForCurrentBlock(rawMarks, currentBlock, domState) : rawMarks;
  const marks = normalizeMarksFromAngular(scopedRawMarks, itemList, currentItem);
  const rawContent = findFirstSemanticValue(roots, ['currentContent', 'content', 'itemContent', 'currentItemContent', 'contents'], { maxDepth: 3 });
  const scopedRawContent = Array.isArray(rawContent) ? selectAngularItemsForCurrentBlock(rawContent, currentBlock, domState) : rawContent;
  const angularContent = normalizeCurrentContentFromAngular(scopedRawContent, currentItem);
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

function contentHasMediaEvidence(content) {
  if (!content) {
    return false;
  }
  const renderedHtml = normalizeString(content.renderedHtml || content.promptHtml || content.answerBoxHtml, '');
  const resourceCount = Array.isArray(content.resourceUrls) ? content.resourceUrls.length : 0;
  return Boolean(resourceCount || /NBMediaPlayer|media-player|<video\b|<audio\b|<img\b|api\/Resource/i.test(renderedHtml));
}

function scoreCurrentContentForReview(content) {
  if (!content) {
    return 0;
  }
  const renderedHtml = normalizeString(content.renderedHtml || content.promptHtml || content.answerBoxHtml, '');
  const resourceCount = Array.isArray(content.resourceUrls) ? content.resourceUrls.length : 0;
  const mediaBonus = contentHasMediaEvidence(content) ? 100000 : 0;
  return mediaBonus + (resourceCount * 1000) + renderedHtml.length;
}

function chooseCurrentContent(primaryContent, fallbackContent) {
  if (!primaryContent) {
    return fallbackContent || null;
  }
  if (!fallbackContent) {
    return primaryContent;
  }
  return scoreCurrentContentForReview(fallbackContent) > scoreCurrentContentForReview(primaryContent)
    ? fallbackContent
    : primaryContent;
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

function itemPositionKey(item) {
  const blockNumber = coercePositiveInteger(item && item.blockNumber, 0);
  const itemIndex = coercePositiveInteger(item && item.itemIndex, 0);
  return blockNumber && itemIndex ? `${blockNumber}\u0000${itemIndex}` : '';
}

function itemComponentKey(item) {
  const blockNumber = coercePositiveInteger(item && item.blockNumber, 0);
  const medleyId = normalizeString(item && item.medleyId, '');
  const componentId = normalizeString(item && item.componentId, '');
  return blockNumber && medleyId && componentId ? `${blockNumber}\u0000${medleyId}\u0000${componentId}` : '';
}

function buildItemLookup(items) {
  const byQuestionId = new Map();
  const byPosition = new Map();
  const byComponent = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const questionId = normalizeString(item && item.questionId, '');
    if (questionId && !byQuestionId.has(questionId)) {
      byQuestionId.set(questionId, item);
    }
    const positionKey = itemPositionKey(item);
    if (positionKey && !byPosition.has(positionKey)) {
      byPosition.set(positionKey, item);
    }
    const componentKey = itemComponentKey(item);
    if (componentKey && !byComponent.has(componentKey)) {
      byComponent.set(componentKey, item);
    }
  });
  return Object.freeze({ byQuestionId, byPosition, byComponent });
}

function findMatchingItem(item, lookup) {
  if (!item || !lookup) {
    return null;
  }
  const questionId = normalizeString(item.questionId, '');
  const componentKey = itemComponentKey(item);
  const positionKey = itemPositionKey(item);
  return (questionId && lookup.byQuestionId.get(questionId))
    || (componentKey && lookup.byComponent.get(componentKey))
    || (positionKey && lookup.byPosition.get(positionKey))
    || null;
}

function getFallbackSelectedAnswerId(primaryItem, fallbackItem, fallbackAnswers) {
  const answers = fallbackAnswers && typeof fallbackAnswers === 'object' ? fallbackAnswers : {};
  const primaryQuestionId = normalizeString(primaryItem && primaryItem.questionId, '');
  const fallbackQuestionId = normalizeString(fallbackItem && fallbackItem.questionId, '');
  return firstNonEmpty([
    primaryQuestionId ? answers[primaryQuestionId] : '',
    fallbackQuestionId ? answers[fallbackQuestionId] : '',
    fallbackItem && fallbackItem.selectedAnswerId,
  ]);
}

function mergeItemListWithFallback(primaryItems, fallbackItems, fallbackAnswers = {}) {
  const primaryList = Array.isArray(primaryItems) ? primaryItems : [];
  const fallbackList = Array.isArray(fallbackItems) ? fallbackItems : [];
  if (!primaryList.length) {
    return fallbackList;
  }
  if (!fallbackList.length) {
    return primaryList;
  }
  const fallbackLookup = buildItemLookup(fallbackList);
  return primaryList.map((item) => {
    const fallbackItem = findMatchingItem(item, fallbackLookup);
    if (!fallbackItem) {
      return item;
    }
    const fallbackSelectedAnswerId = getFallbackSelectedAnswerId(item, fallbackItem, fallbackAnswers);
    const hasPrimaryAnswerEvidence = Boolean(item.answered || normalizeString(item.selectedAnswerId, ''));
    const fallbackSaysUnanswered = !fallbackItem.answered && !fallbackSelectedAnswerId && !hasPrimaryAnswerEvidence;
    if (fallbackSaysUnanswered) {
      return Object.freeze({
        ...item,
        selectedAnswerId: '',
        answered: false,
        marked: Boolean(item.marked || fallbackItem.marked),
        current: Boolean(item.current || fallbackItem.current),
      });
    }
    return Object.freeze({
      ...item,
      selectedAnswerId: normalizeString(item.selectedAnswerId, fallbackSelectedAnswerId),
      answered: Boolean(item.answered || fallbackItem.answered || fallbackSelectedAnswerId),
      marked: Boolean(item.marked || fallbackItem.marked),
      current: Boolean(item.current || fallbackItem.current),
    });
  });
}

function alignCurrentItemWithItemList(currentItem, itemList) {
  if (!currentItem || !Array.isArray(itemList) || !itemList.length) {
    return currentItem || null;
  }
  const lookup = buildItemLookup(itemList);
  const componentId = normalizeString(currentItem.componentId, '');
  const componentMatches = componentId
    ? itemList.filter((item) => normalizeString(item && item.componentId, '') === componentId)
    : [];
  const shouldMatchByComponentOnly = normalizeString(currentItem.identitySource, '') === 'item-id' && Boolean(componentId);
  const directMatch = shouldMatchByComponentOnly ? null : findMatchingItem(currentItem, lookup);
  const matched = directMatch || (shouldMatchByComponentOnly && componentMatches.length === 1 ? componentMatches[0] : null);
  if (!matched) {
    return currentItem;
  }
  const currentQuestionId = normalizeString(currentItem.questionId, '');
  const matchedQuestionId = normalizeString(matched.questionId, '');
  if (currentQuestionId && !matchedQuestionId) {
    return Object.freeze({ ...currentItem, current: true });
  }
  return Object.freeze({
    ...matched,
    selectedAnswerId: normalizeString(currentItem.selectedAnswerId, matched.selectedAnswerId),
    answered: Boolean(matched.answered || currentItem.answered || normalizeString(currentItem.selectedAnswerId, '')),
    marked: Boolean(matched.marked || currentItem.marked),
    current: true,
  });
}

function sanitizeAnswersWithFallbackItemList(answers, itemList, fallbackItems, fallbackAnswers = {}) {
  const draft = { ...(answers && typeof answers === 'object' ? answers : {}) };
  const fallbackList = Array.isArray(fallbackItems) ? fallbackItems : [];
  if (!fallbackList.length) {
    return Object.freeze(draft);
  }
  const fallbackLookup = buildItemLookup(fallbackList);
  (Array.isArray(itemList) ? itemList : []).forEach((item) => {
    const fallbackItem = findMatchingItem(item, fallbackLookup);
    if (!fallbackItem) {
      return;
    }
    const fallbackSelectedAnswerId = getFallbackSelectedAnswerId(item, fallbackItem, fallbackAnswers);
    if (!fallbackItem.answered && !fallbackSelectedAnswerId && !item.answered) {
      const questionId = normalizeString(item && item.questionId, '');
      const primaryAnswerId = normalizeString(draft[questionId], '');
      const primarySelectedAnswerId = normalizeString(item && item.selectedAnswerId, '');
      if (!primaryAnswerId || (primarySelectedAnswerId && primaryAnswerId === primarySelectedAnswerId)) {
        delete draft[questionId];
      }
    }
  });
  return Object.freeze(draft);
}

function mergeWebfredState(angularState, domState, options = {}) {
  const hasAngular = Boolean(angularState && angularState.capabilities && angularState.capabilities.hasAngularServices);
  const primary = hasAngular ? angularState : domState;
  const fallback = hasAngular ? domState : angularState;
  const currentTime = nowIso();

  if (!primary) {
    return createEmptyWebfredState('no-state-source');
  }

  let currentItem = primary.currentItem || (fallback && fallback.currentItem) || null;
  const fallbackItemList = (fallback && fallback.itemList) || [];
  const fallbackAnswers = (fallback && fallback.answers) || {};
  const primaryItemList = primary.itemList && primary.itemList.length ? primary.itemList : fallbackItemList;
  let itemList = mergeItemListWithFallback(primaryItemList, fallbackItemList, fallbackAnswers);
  const primaryCurrentQuestionIdForFallbackMerge = normalizeString(primary.currentItem && primary.currentItem.questionId, '');
  if (primaryCurrentQuestionIdForFallbackMerge && fallback && fallback.currentItem && primaryItemList === fallbackItemList) {
    const fallbackCurrentQuestionId = normalizeString(fallback.currentItem.questionId, '');
    itemList = itemList.map((item) => (
      fallbackCurrentQuestionId && item.questionId === fallbackCurrentQuestionId
        ? Object.freeze({ ...item, ...fallback.currentItem, current: Boolean(item.current || fallback.currentItem.current) })
        : item
    ));
  }
  const rawAnswers = {
    ...fallbackAnswers,
    ...(primary.answers || {}),
  };
  const marks = Object.freeze({
    ...((fallback && fallback.marks) || {}),
    ...(primary.marks || {}),
  });
  const currentContent = chooseCurrentContent(primary.currentContent, fallback && fallback.currentContent);
  const shouldPreferFallbackCurrentItem = Boolean(currentContent === (fallback && fallback.currentContent) && fallback && fallback.currentItem && contentHasMediaEvidence(fallback.currentContent));
  if (shouldPreferFallbackCurrentItem) {
    const fallbackCurrentItem = fallback.currentItem;
    const shouldAlignFallbackCurrent = normalizeString(fallbackCurrentItem && fallbackCurrentItem.identitySource, '') === 'item-id'
      && Boolean(normalizeString(fallbackCurrentItem && fallbackCurrentItem.componentId, ''));
    currentItem = shouldAlignFallbackCurrent ? alignCurrentItemWithItemList(fallbackCurrentItem, itemList) : fallbackCurrentItem;
    const fallbackQuestionId = normalizeString(fallbackCurrentItem && fallbackCurrentItem.questionId, '');
    const alignedQuestionId = normalizeString(currentItem && currentItem.questionId, '');
    if (fallbackQuestionId && alignedQuestionId && fallbackQuestionId !== alignedQuestionId && normalizeString(rawAnswers[fallbackQuestionId], '')) {
      rawAnswers[alignedQuestionId] = normalizeString(rawAnswers[alignedQuestionId], rawAnswers[fallbackQuestionId]);
      delete rawAnswers[fallbackQuestionId];
    }
  }
  if (!shouldPreferFallbackCurrentItem) {
    currentItem = alignCurrentItemWithItemList(currentItem, itemList);
  }
  const answers = sanitizeAnswersWithFallbackItemList(Object.freeze(rawAnswers), itemList, fallbackItemList, fallbackAnswers);
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
    currentBlock: resolveEffectiveCurrentBlock(primary.currentBlock || (fallback && fallback.currentBlock) || (currentItem && currentItem.blockNumber) || 0, {
      ...((fallback && fallback.launchedScope) || {}),
      ...(primary.launchedScope || {}),
    }, { blockCount: primary.blockCount || (fallback && fallback.blockCount) || 0 }),
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
  safeNowMs,
  firstNonEmpty,
  normalizeIdentifierPart,
  coercePositiveInteger,
  normalizeMaybeBoolean,
  safeElementText,
  safeAttribute,
  safeDatasetValue,
  uniqueNormalizedStrings,
  buildQuestionIdentity,
  createEmptyWebfredState,
  findCurrentDomItemRoot,
  extractResourceUrls,
  extractChoicesFromDom,
  extractSelectedAnswerIdFromDom,
  extractQuestionIdentityFromDom,
  extractCurrentContentFromDom,
  extractNavigationStateFromDom,
  findKeyNavigationItem,
  isNavigationKeyItem,
  isReadableObject,
  normalizeChoiceFromAngular,
  normalizeChoicesFromAngular,
  snapshotForAttemptPosition,
};
