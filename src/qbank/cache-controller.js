import { SCRIPT, ATTEMPT_STATUS, ANSWER_KEY_CAPTURE_STATUS } from '../core/constants.js';
import { nowIso } from '../core/logger.js';
import { buildAttemptScoreSummary } from '../scoring/grader.js';
import { createQuestionSnapshotId, normalizeString, uniqueNormalizedStrings } from '../core/data.js';
import { buildQuestionIdentity, extractChoicesFromDom, extractResourceUrls } from '../webfred/adapter.js';
import { extractMediaInteractionsForHtml, extractMediaResourceUrlsForHtml, extractResourceUrlsFromHtml, fetchResourceDataByUrl } from '../media/resource-cache.js';

const QBANK_CACHE_ATTEMPT_PREFIX = 'qbank-cache';
const QBANK_CAPTURE_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  FAILED: 'failed',
});

function stableHashString(value) {
  const text = normalizeString(value, '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeIdentifier(value) {
  return normalizeString(value, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_.:-]/g, '')
    .slice(0, 120);
}

function createQBankCacheAttemptId(definition) {
  return [
    QBANK_CACHE_ATTEMPT_PREFIX,
    normalizeIdentifier(definition && definition.program || 'USMLE'),
    normalizeIdentifier(definition && definition.examName || 'exam'),
    normalizeIdentifier(definition && definition.testDefinitionName || definition && definition.displayName || 'block'),
  ].join(':');
}

function isQuestionBlockDefinition(testDefinition) {
  const text = normalizeString(
    testDefinition && (testDefinition.displayName || testDefinition.name || testDefinition.description),
    ''
  );
  if (!text || /\b(?:tutorial|overview|all\s+blocks?|ccs|case\s*\d+|all\s+cases?)\b/i.test(text)) {
    return false;
  }
  return /\bblock\s*\d+\b/i.test(text);
}

function parseBlockNumber(value, fallback = 1) {
  const match = normalizeString(value, '').match(/\bblock\s*(\d+)\b/i);
  const parsed = match ? Number(match[1]) : Number(fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function discoverLaunchQuestionDefinitions(adapterWindow = window, adapterDocument = document) {
  const angularObject = adapterWindow.angular;
  const root = adapterDocument.querySelector('[ng-controller], [ng-app], body');
  if (!angularObject || !root) {
    throw new Error('NBME launch Angular scope unavailable. Wait for page load and retry.');
  }
  const element = angularObject.element(root);
  const scope = element && typeof element.scope === 'function' ? element.scope() : null;
  const injector = element && typeof element.injector === 'function' ? element.injector() : null;
  const programs = scope && scope.programs ? scope.programs : null;
  if (!programs || !Array.isArray(programs.exams) || !injector) {
    throw new Error('NBME launch metadata unavailable.');
  }
  const program = normalizeString(scope.program || programs.name, 'USMLE');
  const definitions = [];
  programs.exams.forEach((exam) => {
    (Array.isArray(exam && exam.examPublications) ? exam.examPublications : []).forEach((publication) => {
      (Array.isArray(publication && publication.testDefinitions) ? publication.testDefinitions : []).forEach((testDefinition) => {
        if (!isQuestionBlockDefinition(testDefinition)) {
          return;
        }
        const displayName = normalizeString(testDefinition.displayName || testDefinition.name, 'Exam block');
        definitions.push(Object.freeze({
          program,
          programName: normalizeString(programs.name || program, program),
          examName: normalizeString(exam && exam.name, ''),
          examDisplayName: normalizeString(exam && (exam.description || exam.name), ''),
          publicationName: normalizeString(publication && publication.publicationName, ''),
          testDefinitionName: normalizeString(testDefinition && testDefinition.name, ''),
          testDefinitionDisplayName: displayName,
          blockNumber: parseBlockNumber(displayName, definitions.length + 1),
        }));
      });
    });
  });
  return Object.freeze({ scope, injector, definitions: Object.freeze(definitions) });
}

function createGuid(adapterWindow, uuid2, scope) {
  const fromUuid = uuid2 && typeof uuid2.newguid === 'function' ? uuid2.newguid() : '';
  const random = adapterWindow.crypto && typeof adapterWindow.crypto.randomUUID === 'function'
    ? adapterWindow.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${fromUuid || random}IP${normalizeString(scope && scope.ipa, '')}`;
}

async function createExamSession(adapterWindow, launchContext, definition) {
  const launchService = launchContext.injector.get('launchService');
  let uuid2 = null;
  try {
    uuid2 = launchContext.injector.get('uuid2');
  } catch (_error) {}
  const guid = createGuid(adapterWindow, uuid2, launchContext.scope);
  const params = Object.freeze({
    examineeId: guid,
    authorizationCode: guid,
    programName: definition.programName,
    examName: definition.examName,
    examPublicationName: definition.publicationName,
    testDefinition: definition.testDefinitionName,
    showAnswers: true,
    disableTimer: true,
    EndOfSessionUrl: adapterWindow.location ? adapterWindow.location.href : SCRIPT.ORIGIN,
  });
  const response = await launchService.createSession(params);
  const result = response && response.data && response.data.result ? response.data.result : response && response.result;
  const sessionId = normalizeString(result && result.examSession && result.examSession.id, '');
  if (!sessionId) {
    throw new Error(`CreateExamSession returned no session id for ${definition.testDefinitionDisplayName}.`);
  }
  return Object.freeze({ sessionId, params });
}

async function postJson(adapterWindow, path, body) {
  const response = await adapterWindow.fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function parseHtml(adapterDocument, html) {
  const template = adapterDocument.createElement('template');
  template.innerHTML = normalizeString(html, '');
  return template.content;
}

function cssEscape(adapterWindow, value) {
  const text = normalizeString(value, '');
  if (adapterWindow.CSS && typeof adapterWindow.CSS.escape === 'function') {
    return adapterWindow.CSS.escape(text);
  }
  return text.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function findItemRoot(adapterWindow, fragment, componentId) {
  if (!fragment || !componentId) {
    return null;
  }
  const escaped = cssEscape(adapterWindow, componentId);
  const answerBox = fragment.querySelector(`#${escaped}_div, input[name="${escaped}"]`);
  if (!answerBox) {
    return fragment.firstElementChild || null;
  }
  return answerBox.closest('div[id^="page"], div.NBSinglePage, .NBSinglePage') || answerBox.closest('div') || fragment.firstElementChild || null;
}

function extractCorrectAnswerId(root, choices) {
  const marker = root && root.querySelector('fred-show-answer[ans], fred-show-answer[data-ans], [ans][ng-if*="showAnswers"]');
  const raw = normalizeString(marker && (marker.getAttribute('ans') || marker.getAttribute('data-ans')), '');
  if (!raw) {
    return '';
  }
  const match = (Array.isArray(choices) ? choices : []).find((choice) => {
    const id = normalizeString(choice && choice.id, '');
    return id === raw || id.toLowerCase() === raw.toLowerCase();
  });
  return match ? match.id : raw;
}

function normalizeQBankChoices(root) {
  return extractChoicesFromDom(root).map((choice) => Object.freeze({
    id: normalizeString(choice && choice.id, ''),
    label: normalizeString(choice && choice.label, ''),
    index: Number(choice && choice.index) || 0,
    selected: false,
    disabled: Boolean(choice && choice.disabled),
  })).filter((choice) => choice.id);
}

async function buildQBankSnapshotsFromSessionData(adapterWindow, adapterDocument, definition, statusResult, bulkContent, sessionId) {
  const status = statusResult && statusResult.result ? statusResult.result : statusResult;
  const medleys = status && status.examBlock && Array.isArray(status.examBlock.medleys) ? status.examBlock.medleys : [];
  const snapshots = [];
  const correctAnswers = {};
  const itemMetadataByQuestionId = {};
  let answerableIndex = 0;
  for (const medley of medleys) {
    const medleyId = normalizeString(medley && medley.medleyId, '');
    const html = normalizeString(bulkContent && bulkContent[medleyId], '');
    const fragment = parseHtml(adapterDocument, html);
    for (const item of (Array.isArray(medley && medley.items) ? medley.items : [])) {
      const componentId = normalizeString(item && item.componentId, '');
      if (!componentId || item && item.answerable === false) {
        continue;
      }
      answerableIndex += 1;
      const itemRoot = findItemRoot(adapterWindow, fragment, componentId) || fragment;
      const choices = normalizeQBankChoices(itemRoot);
      const correctAnswerId = extractCorrectAnswerId(itemRoot, choices);
      const identity = buildQuestionIdentity({
        examProgram: definition.program,
        examName: definition.examName,
        examSection: definition.testDefinitionName,
        medleyId,
        componentId,
        blockNumber: definition.blockNumber,
        itemIndex: answerableIndex,
      });
      const questionId = identity.questionId || `${definition.examName}:${medleyId}:${componentId}`;
      const renderedHtml = normalizeString(itemRoot && itemRoot.outerHTML, html);
      const promptElement = itemRoot && itemRoot.querySelector ? itemRoot.querySelector('.NBExposition, [class*="Exposition"]') : null;
      const mediaMetadataOptions = { cache: 'no-store', sessionId };
      const mediaMetadataResourceUrls = await extractMediaResourceUrlsForHtml(adapterWindow, renderedHtml, mediaMetadataOptions);
      const mediaInteractions = await extractMediaInteractionsForHtml(adapterWindow, renderedHtml, mediaMetadataOptions);
      const mediaInteractionResourceUrls = mediaInteractions.flatMap((interaction) => [interaction && interaction.src, interaction && interaction.image]);
      const resourceUrls = uniqueNormalizedStrings([
        ...extractResourceUrls(itemRoot),
        ...extractResourceUrlsFromHtml(renderedHtml),
        ...mediaMetadataResourceUrls,
        ...mediaInteractionResourceUrls,
      ]);
      const resourceDataByUrl = await fetchResourceDataByUrl(adapterWindow, resourceUrls, { baseUrl: `${SCRIPT.ORIGIN}/webfred/`, cache: 'no-store', sessionId });
      if (correctAnswerId) {
        correctAnswers[questionId] = correctAnswerId;
      }
      itemMetadataByQuestionId[questionId] = Object.freeze({
        questionId,
        blockNumber: definition.blockNumber,
        itemIndex: answerableIndex,
        componentId,
        medleyId,
        identitySource: identity.identitySource,
        source: 'qbank-cache',
      });
      snapshots.push(Object.freeze({
        questionId,
        blockNumber: definition.blockNumber,
        itemIndex: answerableIndex,
        metadata: Object.freeze({ ...itemMetadataByQuestionId[questionId], cacheKind: 'qbank', sessionId, mediaInteractions }),
        promptHtml: normalizeString(promptElement && promptElement.innerHTML, ''),
        renderedHtml,
        choices,
        selectedAnswerId: '',
        correctAnswerId,
        marked: false,
        notes: '',
        annotations: Object.freeze({}),
        timingMs: 0,
        resourceUrls,
        resourceDataByUrl,
        contentHash: stableHashString(`${questionId}\n${renderedHtml}\n${choices.map((choice) => `${choice.id}:${choice.label}`).join('|')}\n${resourceUrls.join('|')}`),
        snapshot: Object.freeze({ qbankCache: Object.freeze({ definition, sessionId, capturedAt: nowIso() }) }),
      }));
    }
  }
  return Object.freeze({ snapshots: Object.freeze(snapshots), correctAnswers: Object.freeze(correctAnswers), itemMetadataByQuestionId: Object.freeze(itemMetadataByQuestionId) });
}

async function persistQBankCapture(storage, definition, sessionId, captureData) {
  const attemptId = createQBankCacheAttemptId(definition);
  const questionIds = captureData.snapshots.map((snapshot) => snapshot.questionId);
  const completedAt = nowIso();
  const attemptBase = Object.freeze({
    id: attemptId,
    status: ATTEMPT_STATUS.COMPLETED,
    reviewReady: true,
    startedAt: completedAt,
    completedAt,
    examIdentity: { program: definition.program, examName: definition.examName, section: definition.testDefinitionDisplayName },
    launchedScope: { mode: 'qbank-cache', block: definition.blockNumber, testDefinitionName: definition.testDefinitionName, testDefinitionDisplayName: definition.testDefinitionDisplayName, publicationName: definition.publicationName },
    blockMetadata: [{ blockNumber: definition.blockNumber, itemCount: questionIds.length, label: definition.testDefinitionDisplayName }],
    questionIds,
    questionCount: questionIds.length,
    responses: {},
    correctAnswers: captureData.correctAnswers,
    answerKeyCapture: { status: ANSWER_KEY_CAPTURE_STATUS.COMPLETE, source: 'qbank-cache', knownCount: Object.keys(captureData.correctAnswers).length, expectedCount: questionIds.length, capturedAt: completedAt },
    source: { createdBy: 'qbank-cache-controller', cacheKind: 'qbank', sessionId, launchDefinition: definition, itemMetadataByQuestionId: captureData.itemMetadataByQuestionId },
  });
  const attempt = Object.freeze({ ...attemptBase, scoreSummary: buildAttemptScoreSummary(attemptBase, { scoredAt: completedAt, reason: 'qbank-cache' }) });
  if (await storage.getAttempt(attemptId)) {
    await storage.deleteAttempt(attemptId);
  }
  await storage.upsertAttempt(attempt);
  for (const snapshot of captureData.snapshots) {
    await storage.saveQuestionSnapshot({ ...snapshot, id: createQuestionSnapshotId(attemptId, snapshot.questionId), attemptId });
  }
  return attempt;
}

function createQBankCacheController(options = {}) {
  const adapterWindow = options.window || window;
  const adapterDocument = options.document || adapterWindow.document || document;
  const storage = options.storage;
  const logger = options.logger || { debug() {}, warn() {}, error() {} };
  let status = QBANK_CAPTURE_STATUS.IDLE;
  let lastResult = null;

  async function captureDefinition(launchContext, definition) {
    const session = await createExamSession(adapterWindow, launchContext, definition);
    const statusResult = await postJson(adapterWindow, '/webfred/api/services/WebFred/examStatus/GetExamStatus', { sessionId: session.sessionId });
    const bulkContent = await postJson(adapterWindow, '/webfred/api/Content/GetBulk', { sessionId: session.sessionId, program: definition.program, exam: definition.examName });
    const captureData = await buildQBankSnapshotsFromSessionData(adapterWindow, adapterDocument, definition, statusResult, bulkContent, session.sessionId);
    if (!captureData.snapshots.length) {
      throw new Error(`No answerable items found in ${definition.testDefinitionDisplayName}.`);
    }
    const attempt = await persistQBankCapture(storage, definition, session.sessionId, captureData);
    return Object.freeze({ definition, attemptId: attempt.id, questionCount: captureData.snapshots.length, knownAnswerCount: Object.keys(captureData.correctAnswers).length });
  }

  async function captureAllAvailable(captureOptions = {}) {
    if (!storage) {
      throw new Error('QBank cache requires storage.');
    }
    const startedAt = nowIso();
    status = QBANK_CAPTURE_STATUS.RUNNING;
    const launchContext = discoverLaunchQuestionDefinitions(adapterWindow, adapterDocument);
    const definitions = launchContext.definitions;
    const results = [];
    const errors = [];
    if (!definitions.length) {
      status = QBANK_CAPTURE_STATUS.FAILED;
      throw new Error('No MCQ block launch definitions found.');
    }
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];
      if (typeof captureOptions.onProgress === 'function') {
        captureOptions.onProgress(Object.freeze({ current: index + 1, total: definitions.length, definition, message: `Capturing ${definition.testDefinitionDisplayName}` }));
      }
      try {
        results.push(await captureDefinition(launchContext, definition));
      } catch (error) {
        logger.warn('QBank block capture failed.', definition, error);
        errors.push(Object.freeze({ definition, message: normalizeString(error && error.message, 'capture failed') }));
      }
    }
    status = errors.length ? (results.length ? QBANK_CAPTURE_STATUS.PARTIAL : QBANK_CAPTURE_STATUS.FAILED) : QBANK_CAPTURE_STATUS.COMPLETE;
    lastResult = Object.freeze({ status, startedAt, completedAt: nowIso(), definitionsCount: definitions.length, capturedDefinitions: results.length, failedDefinitions: errors.length, questionCount: results.reduce((sum, result) => sum + result.questionCount, 0), knownAnswerCount: results.reduce((sum, result) => sum + result.knownAnswerCount, 0), results: Object.freeze(results), errors: Object.freeze(errors) });
    return lastResult;
  }

  function reset() {
    status = QBANK_CAPTURE_STATUS.IDLE;
    lastResult = null;
    return true;
  }

  return Object.freeze({
    captureAllAvailable,
    reset,
    getStatus() { return status; },
    getLastResult() { return lastResult; },
    constants: Object.freeze({ status: QBANK_CAPTURE_STATUS, attemptPrefix: QBANK_CACHE_ATTEMPT_PREFIX }),
  });
}

export {
  QBANK_CACHE_ATTEMPT_PREFIX,
  QBANK_CAPTURE_STATUS,
  createQBankCacheAttemptId,
  isQuestionBlockDefinition,
  discoverLaunchQuestionDefinitions,
  buildQBankSnapshotsFromSessionData,
  createQBankCacheController,
};
