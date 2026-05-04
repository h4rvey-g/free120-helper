// ==UserScript==
// @name         USMLE Free 120 QBank Helper
// @namespace    https://github.com/hvg/free120-helper
// @version      0.1.0
// @description  Local-only scaffold for a USMLE Free 120 review/history helper.
// @author       free120-helper contributors
// @match        https://orientation.nbme.org/
// @match        https://orientation.nbme.org/Launch*
// @match        https://orientation.nbme.org/Launch/*
// @match        https://orientation.nbme.org/webfred*
// @match        https://orientation.nbme.org/webfred/*
// @match        https://orientation.nbme.org/WebFRED*
// @match        https://orientation.nbme.org/WebFRED/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT = Object.freeze({
    NAME: 'USMLE Free 120 QBank Helper',
    VERSION: '0.1.0',
    STORAGE_SCHEMA_VERSION: 1,
    STORAGE_NAMESPACE: 'free120-helper',
    ORIGIN: 'https://orientation.nbme.org',
    USER_SCRIPT_MATCHES: Object.freeze([
      'https://orientation.nbme.org/',
      'https://orientation.nbme.org/Launch*',
      'https://orientation.nbme.org/Launch/*',
      'https://orientation.nbme.org/webfred*',
      'https://orientation.nbme.org/webfred/*',
      'https://orientation.nbme.org/WebFRED*',
      'https://orientation.nbme.org/WebFRED/*',
    ]),
    URL_PATTERNS: Object.freeze({
      LAUNCH_PAGE: '^/(?:$|launch(?:/|$))',
      WEBFRED_PAGE: '^/webfred(?:/|$)',
    }),
    UI_Z_INDEX: Object.freeze({
      BASE: 2147483000,
      PILL: 2147483001,
      SETTINGS_PANEL: 2147483002,
      MODAL: 2147483003,
      TOAST: 2147483004,
    }),
  });

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: `${SCRIPT.STORAGE_NAMESPACE}:v${SCRIPT.STORAGE_SCHEMA_VERSION}:settings`,
    INDEXED_DB: `${SCRIPT.STORAGE_NAMESPACE}:db`,
  });

  const DB_SCHEMA = Object.freeze({
    VERSION: SCRIPT.STORAGE_SCHEMA_VERSION,
    EXPORT_FORMAT_VERSION: 1,
    STORES: Object.freeze({
      ATTEMPTS: 'attempts',
      IN_PROGRESS_ATTEMPT_STATES: 'inProgressAttemptStates',
      QUESTION_SNAPSHOTS: 'questionSnapshots',
      SCHEMA_METADATA: 'schemaMetadata',
    }),
    INDEXES: Object.freeze({
      ATTEMPTS_BY_STARTED_AT: 'byStartedAt',
      ATTEMPTS_BY_UPDATED_AT: 'byUpdatedAt',
      ATTEMPTS_BY_STATUS: 'byStatus',
      IN_PROGRESS_BY_UPDATED_AT: 'byUpdatedAt',
      SNAPSHOTS_BY_ATTEMPT_ID: 'byAttemptId',
      SNAPSHOTS_BY_QUESTION_ID: 'byQuestionId',
      SNAPSHOTS_BY_ATTEMPT_AND_QUESTION: 'byAttemptAndQuestion',
    }),
  });

  const ATTEMPT_STATUS = Object.freeze({
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    PARTIAL: 'partial',
    ABANDONED: 'abandoned',
  });

  const EXPORT_TYPES = Object.freeze({
    HISTORY_ONLY: 'history-only',
    FULL_BACKUP: 'full-backup',
  });

  const FULL_BACKUP_WARNING = 'Full backup export includes locally stored question snapshots and may contain official NBME question content. Keep it private and do not share it.';

  const DEFAULT_SETTINGS = Object.freeze({
    debug: false,
    pillVisible: true,
  });

  const PAGE_KIND = Object.freeze({
    LAUNCH: 'launch',
    WEBFRED: 'webfred',
    UNSUPPORTED: 'unsupported',
  });

  const WEBFRED_ADAPTER_STATUS = Object.freeze({
    PENDING: 'pending',
    READY: 'ready',
    DEGRADED: 'degraded',
    UNAVAILABLE: 'unavailable',
  });

  const WEBFRED_STATE_SOURCE = Object.freeze({
    ANGULAR: 'angular',
    DOM_FALLBACK: 'dom-fallback',
    MIXED: 'mixed',
    UNAVAILABLE: 'unavailable',
  });

  const WEBFRED_ADAPTER_CONFIG = Object.freeze({
    INIT_TIMEOUT_MS: 8000,
    INIT_POLL_INTERVAL_MS: 250,
    MAX_SCAN_OBJECTS: 600,
    MAX_SCAN_KEYS_PER_OBJECT: 80,
    DOM_CURRENT_ITEM_SELECTORS: Object.freeze([
      'section#item article#content div#medley div[id^="item"]',
      'article#content div#medley div[id^="item"]',
      'div#medley div[id^="item"]',
      'section#item div[id^="item"]',
      'article#content div[id^="item"]',
    ]),
    DOM_NAV_SELECTOR: 'nav > ol#leftnav, ol#leftnav',
  });

  const WEBFRED_ANGULAR_SERVICE_CANDIDATES = Object.freeze([
    'ExamService', 'examService', 'ExamState', 'examState', 'ExamDataService', 'examDataService',
    'BlockService', 'blockService', 'NavigationService', 'navigationService', 'navService',
    'ItemService', 'itemService', 'CurrentItemService', 'currentItemService', 'ItemResponseService',
    'ResponseService', 'responseService', 'AnswerService', 'answerService', 'answersService',
    'ContentService', 'contentService', 'MedleyService', 'medleyService', 'ConfigService',
    'configService', 'ConfigurationService', 'configurationService', 'SessionService',
    'sessionService', '$state', '$stateParams', '$rootScope', '$location',
  ]);

  const launchPagePattern = new RegExp(SCRIPT.URL_PATTERNS.LAUNCH_PAGE, 'i');
  const webfredPagePattern = new RegExp(SCRIPT.URL_PATTERNS.WEBFRED_PAGE, 'i');

  function createSettingsStore(storage, storageKey) {
    let cachedSettings = readSettings(storage, storageKey);

    function get() {
      return Object.freeze({ ...cachedSettings });
    }

    function update(patch) {
      cachedSettings = normalizeSettings({ ...cachedSettings, ...patch });
      writeSettings(storage, storageKey, cachedSettings);
      return get();
    }

    return Object.freeze({
      get,
      setDebugLogging(enabled) {
        return update({ debug: Boolean(enabled) });
      },
      setPillVisible(visible) {
        return update({ pillVisible: Boolean(visible) });
      },
      reset() {
        cachedSettings = { ...DEFAULT_SETTINGS };
        writeSettings(storage, storageKey, cachedSettings);
        return get();
      },
    });
  }

  function readSettings(storage, storageKey) {
    try {
      const rawValue = storage.getItem(storageKey);
      if (!rawValue) {
        return { ...DEFAULT_SETTINGS };
      }

      return normalizeSettings(JSON.parse(rawValue));
    } catch (_error) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function writeSettings(storage, storageKey, settings) {
    try {
      storage.setItem(storageKey, JSON.stringify(normalizeSettings(settings)));
    } catch (_error) {}
  }

  function normalizeSettings(candidate) {
    const normalized = { ...DEFAULT_SETTINGS };
    if (!candidate || typeof candidate !== 'object') {
      return normalized;
    }

    if (typeof candidate.debug === 'boolean') {
      normalized.debug = candidate.debug;
    }

    if (typeof candidate.pillVisible === 'boolean') {
      normalized.pillVisible = candidate.pillVisible;
    }

    return normalized;
  }

  function createLogger(settingsStore) {
    const prefix = `[Free120 Helper v${SCRIPT.VERSION}]`;

    function isEnabled() {
      return settingsStore.get().debug === true;
    }

    function emit(method, args) {
      if (!isEnabled()) {
        return;
      }

      const consoleMethod = console[method] || console.log;
      consoleMethod.call(console, prefix, ...args);
    }

    return Object.freeze({
      debug(...args) {
        emit('debug', args);
      },
      info(...args) {
        emit('info', args);
      },
      warn(...args) {
        emit('warn', args);
      },
      error(...args) {
        emit('error', args);
      },
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createStorageError(message, cause) {
    const error = new Error(message);
    error.name = 'Free120StorageError';
    if (cause) {
      try {
        error.cause = cause;
      } catch (_error) {}
    }
    return error;
  }

  function createStorageValidationError(message, details) {
    const error = createStorageError(message);
    error.name = 'Free120StorageValidationError';
    error.details = details || null;
    return error;
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function normalizeString(value, fallback = '') {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || fallback;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return fallback;
  }

  function normalizeAttemptStatus(value) {
    const normalized = normalizeString(value, ATTEMPT_STATUS.IN_PROGRESS).toLowerCase();
    return Object.values(ATTEMPT_STATUS).includes(normalized)
      ? normalized
      : ATTEMPT_STATUS.IN_PROGRESS;
  }

  function normalizeIsoDate(value, fallback = nowIso()) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString();
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (Number.isFinite(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return fallback;
  }

  function normalizeNullableIsoDate(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = normalizeIsoDate(value, null);
    return parsed || null;
  }

  function normalizePositiveInteger(value, fallback) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    return fallback;
  }

  function createStorageId(prefix) {
    const safePrefix = normalizeString(prefix, 'record');
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return `${safePrefix}:${crypto.randomUUID()}`;
    }

    const randomPart = Math.random().toString(36).slice(2, 12);
    const timePart = Date.now().toString(36);
    return `${safePrefix}:${timePart}:${randomPart}`;
  }

  function createQuestionSnapshotId(attemptId, questionId) {
    return `${normalizeString(attemptId, 'attempt')}:${normalizeString(questionId, 'question')}`;
  }

  function sanitizeJsonCompatible(value, depth = 0, seen = []) {
    if (depth > 50) {
      throw createStorageValidationError('Stored records must not exceed 50 nested levels.');
    }

    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    if (Array.isArray(value)) {
      if (seen.includes(value)) {
        throw createStorageValidationError('Stored records must not contain circular arrays.');
      }
      const nextSeen = seen.concat(value);
      return value.map((item) => sanitizeJsonCompatible(item, depth + 1, nextSeen));
    }

    if (isPlainObject(value)) {
      if (seen.includes(value)) {
        throw createStorageValidationError('Stored records must not contain circular objects.');
      }
      const nextSeen = seen.concat(value);
      const sanitized = {};
      Object.entries(value).forEach(([key, item]) => {
        if (!isNonEmptyString(key)) {
          return;
        }
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return;
        }
        sanitized[key] = sanitizeJsonCompatible(item, depth + 1, nextSeen);
      });
      return sanitized;
    }

    throw createStorageValidationError('Stored records must be JSON-compatible plain data.');
  }

  function normalizeRecord(value, fallback = {}) {
    if (!isPlainObject(value)) {
      return { ...fallback };
    }
    return sanitizeJsonCompatible(value);
  }

  function normalizeNullableRecord(value) {
    if (value === null || value === undefined) {
      return null;
    }
    return normalizeRecord(value);
  }

  function normalizeRecordArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item) => isPlainObject(item))
      .map((item) => sanitizeJsonCompatible(item));
  }

  function normalizeIdArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => normalizeString(item))
      .filter((item) => item.length > 0);
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => normalizeString(item))
      .filter((item) => item.length > 0);
  }

  // Phase 2 storage foundation lives below this marker.

  function createIndexedDbOpenPromise(databaseName, version, logger) {
    if (!window.indexedDB) {
      return Promise.reject(createStorageError('IndexedDB is not available in this browser.'));
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, version);

      request.onupgradeneeded = (event) => {
        try {
          applyIndexedDbMigrations(request.result, event.oldVersion || 0, event.newVersion || version, request.transaction);
        } catch (error) {
          reject(createStorageError('IndexedDB migration failed.', error));
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          logger.warn('IndexedDB version changed in another tab; closing old connection.');
          db.close();
        };
        resolve(db);
      };

      request.onerror = () => {
        reject(createStorageError('IndexedDB open failed.', request.error));
      };

      request.onblocked = () => {
        logger.warn('IndexedDB upgrade blocked by another open tab. Close other Free120 pages if storage does not initialize.');
      };
    });
  }

  function applyIndexedDbMigrations(db, oldVersion, newVersion, transaction) {
    if (oldVersion < 1) {
      migrateIndexedDbToVersion1(db, transaction);
    }

    const metadataStore = transaction && transaction.objectStoreNames.contains(DB_SCHEMA.STORES.SCHEMA_METADATA)
      ? transaction.objectStore(DB_SCHEMA.STORES.SCHEMA_METADATA)
      : null;

    if (metadataStore) {
      metadataStore.put({
        key: 'schema',
        schemaVersion: DB_SCHEMA.VERSION,
        databaseVersion: newVersion,
        migratedFromVersion: oldVersion,
        migratedAt: nowIso(),
        stores: Object.values(DB_SCHEMA.STORES),
      });
    }
  }

  function migrateIndexedDbToVersion1(db, transaction) {
    const attemptsStore = ensureObjectStore(db, transaction, DB_SCHEMA.STORES.ATTEMPTS, { keyPath: 'id' });
    ensureIndex(attemptsStore, DB_SCHEMA.INDEXES.ATTEMPTS_BY_STARTED_AT, 'startedAt');
    ensureIndex(attemptsStore, DB_SCHEMA.INDEXES.ATTEMPTS_BY_UPDATED_AT, 'updatedAt');
    ensureIndex(attemptsStore, DB_SCHEMA.INDEXES.ATTEMPTS_BY_STATUS, 'status');

    const inProgressStore = ensureObjectStore(db, transaction, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES, { keyPath: 'attemptId' });
    ensureIndex(inProgressStore, DB_SCHEMA.INDEXES.IN_PROGRESS_BY_UPDATED_AT, 'updatedAt');

    const snapshotsStore = ensureObjectStore(db, transaction, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, { keyPath: 'id' });
    ensureIndex(snapshotsStore, DB_SCHEMA.INDEXES.SNAPSHOTS_BY_ATTEMPT_ID, 'attemptId');
    ensureIndex(snapshotsStore, DB_SCHEMA.INDEXES.SNAPSHOTS_BY_QUESTION_ID, 'questionId');
    ensureIndex(snapshotsStore, DB_SCHEMA.INDEXES.SNAPSHOTS_BY_ATTEMPT_AND_QUESTION, ['attemptId', 'questionId'], { unique: true });

    ensureObjectStore(db, transaction, DB_SCHEMA.STORES.SCHEMA_METADATA, { keyPath: 'key' });
  }

  function ensureObjectStore(db, transaction, storeName, options) {
    if (db.objectStoreNames.contains(storeName)) {
      if (transaction && transaction.objectStoreNames && transaction.objectStoreNames.contains(storeName)) {
        return transaction.objectStore(storeName);
      }
      throw createStorageError(`Object store ${storeName} already exists but is not available in this migration transaction.`);
    }

    return db.createObjectStore(storeName, options);
  }

  function ensureIndex(store, indexName, keyPath, options = {}) {
    if (!store.indexNames.contains(indexName)) {
      store.createIndex(indexName, keyPath, options);
    }
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(createStorageError('IndexedDB request failed.', request.error));
    });
  }

  function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(createStorageError('IndexedDB transaction failed.', transaction.error));
      transaction.onabort = () => reject(createStorageError('IndexedDB transaction aborted.', transaction.error));
    });
  }

  async function idbGet(db, storeName, key) {
    const transaction = db.transaction(storeName, 'readonly');
    const transactionDone = transactionToPromise(transaction);
    const result = await requestToPromise(transaction.objectStore(storeName).get(key));
    await transactionDone;
    return result || null;
  }

  async function idbGetAll(db, storeName) {
    const transaction = db.transaction(storeName, 'readonly');
    const transactionDone = transactionToPromise(transaction);
    const result = await requestToPromise(transaction.objectStore(storeName).getAll());
    await transactionDone;
    return result || [];
  }

  async function idbGetAllByIndex(db, storeName, indexName, key) {
    const transaction = db.transaction(storeName, 'readonly');
    const transactionDone = transactionToPromise(transaction);
    const index = transaction.objectStore(storeName).index(indexName);
    const result = await requestToPromise(index.getAll(key));
    await transactionDone;
    return result || [];
  }

  async function idbGetByIndex(db, storeName, indexName, key) {
    const transaction = db.transaction(storeName, 'readonly');
    const transactionDone = transactionToPromise(transaction);
    const index = transaction.objectStore(storeName).index(indexName);
    const result = await requestToPromise(index.get(key));
    await transactionDone;
    return result || null;
  }

  async function idbPut(db, storeName, record) {
    const transaction = db.transaction(storeName, 'readwrite');
    const transactionDone = transactionToPromise(transaction);
    const result = await requestToPromise(transaction.objectStore(storeName).put(record));
    await transactionDone;
    return result;
  }

  async function idbDelete(db, storeName, key) {
    const transaction = db.transaction(storeName, 'readwrite');
    const transactionDone = transactionToPromise(transaction);
    await requestToPromise(transaction.objectStore(storeName).delete(key));
    await transactionDone;
  }

  async function idbClear(db, storeName) {
    const transaction = db.transaction(storeName, 'readwrite');
    const transactionDone = transactionToPromise(transaction);
    await requestToPromise(transaction.objectStore(storeName).clear());
    await transactionDone;
  }

  async function idbDeleteAllByIndex(db, storeName, indexName, key) {
    const transaction = db.transaction(storeName, 'readwrite');
    const transactionDone = transactionToPromise(transaction);
    const index = transaction.objectStore(storeName).index(indexName);

    await new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(key);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        const deleteRequest = cursor.delete();
        deleteRequest.onsuccess = () => cursor.continue();
        deleteRequest.onerror = () => reject(createStorageError('IndexedDB cursor record delete failed.', deleteRequest.error));
      };
      cursorRequest.onerror = () => reject(createStorageError('IndexedDB cursor delete failed.', cursorRequest.error));
    });

    await transactionDone;
  }

  function normalizeAttemptRecord(candidate, options = {}) {
    if (!isPlainObject(candidate)) {
      throw createStorageValidationError('Attempt must be an object.');
    }

    const existing = isPlainObject(options.existing) ? options.existing : null;
    const currentTime = nowIso();
    const id = normalizeString(candidate.id, existing && existing.id ? existing.id : createStorageId('attempt'));
    if (!isNonEmptyString(id)) {
      throw createStorageValidationError('Attempt id is required.');
    }

    const startedAt = normalizeIsoDate(candidate.startedAt || (existing && existing.startedAt), currentTime);
    const createdAt = normalizeIsoDate(candidate.createdAt || (existing && existing.createdAt), startedAt);
    const completedAt = normalizeNullableIsoDate(candidate.completedAt || (existing && existing.completedAt));
    const updatedAt = options.preserveUpdatedAt
      ? normalizeIsoDate(candidate.updatedAt || (existing && existing.updatedAt), currentTime)
      : currentTime;

    const status = normalizeAttemptStatus(candidate.status || (existing && existing.status));
    const questionIds = normalizeIdArray(candidate.questionIds || (existing && existing.questionIds));
    const explicitQuestionCount = candidate.questionCount !== undefined
      ? candidate.questionCount
      : (existing && existing.questionCount);

    return Object.freeze({
      id,
      schemaVersion: normalizePositiveInteger(candidate.schemaVersion, DB_SCHEMA.VERSION),
      scriptVersion: normalizeString(candidate.scriptVersion, SCRIPT.VERSION),
      createdAt,
      startedAt,
      updatedAt,
      completedAt,
      status,
      reviewReady: Boolean(candidate.reviewReady !== undefined ? candidate.reviewReady : (existing && existing.reviewReady)),
      examIdentity: normalizeRecord(candidate.examIdentity || (existing && existing.examIdentity)),
      launchedScope: normalizeRecord(candidate.launchedScope || (existing && existing.launchedScope)),
      blockMetadata: normalizeRecordArray(candidate.blockMetadata || (existing && existing.blockMetadata)),
      questionIds,
      questionCount: normalizePositiveInteger(explicitQuestionCount, questionIds.length),
      responses: normalizeRecord(candidate.responses || (existing && existing.responses)),
      answerTimeline: normalizeRecordArray(candidate.answerTimeline || (existing && existing.answerTimeline)),
      correctAnswers: normalizeRecord(candidate.correctAnswers || (existing && existing.correctAnswers)),
      markedQuestionIds: normalizeIdArray(candidate.markedQuestionIds || (existing && existing.markedQuestionIds)),
      notesByQuestionId: normalizeRecord(candidate.notesByQuestionId || (existing && existing.notesByQuestionId)),
      annotationsByQuestionId: normalizeRecord(candidate.annotationsByQuestionId || (existing && existing.annotationsByQuestionId)),
      timingByQuestionId: normalizeRecord(candidate.timingByQuestionId || (existing && existing.timingByQuestionId)),
      scoreSummary: normalizeNullableRecord(candidate.scoreSummary !== undefined ? candidate.scoreSummary : (existing && existing.scoreSummary)),
      source: normalizeRecord(candidate.source || (existing && existing.source)),
      importMetadata: normalizeNullableRecord(candidate.importMetadata !== undefined ? candidate.importMetadata : (existing && existing.importMetadata)),
    });
  }

  function mergeAttemptPatch(existing, patch) {
    if (!existing) {
      throw createStorageValidationError('Existing attempt is required for update.');
    }
    if (!isPlainObject(patch)) {
      throw createStorageValidationError('Attempt patch must be an object.');
    }
    return normalizeAttemptRecord({ ...existing, ...patch, id: existing.id }, { existing });
  }

  function normalizeInProgressState(candidate, existing = null) {
    if (!isPlainObject(candidate)) {
      throw createStorageValidationError('In-progress attempt state must be an object.');
    }

    const attemptId = normalizeString(candidate.attemptId || (existing && existing.attemptId));
    if (!isNonEmptyString(attemptId)) {
      throw createStorageValidationError('In-progress attempt state attemptId is required.');
    }

    const currentTime = nowIso();
    const createdAt = normalizeIsoDate(candidate.createdAt || (existing && existing.createdAt), currentTime);

    return Object.freeze({
      attemptId,
      schemaVersion: normalizePositiveInteger(candidate.schemaVersion, DB_SCHEMA.VERSION),
      scriptVersion: normalizeString(candidate.scriptVersion, SCRIPT.VERSION),
      createdAt,
      updatedAt: normalizeIsoDate(candidate.updatedAt, currentTime),
      pageContext: normalizeRecord(candidate.pageContext || (existing && existing.pageContext)),
      activeBlock: normalizePositiveInteger(candidate.activeBlock !== undefined ? candidate.activeBlock : (existing && existing.activeBlock), 1),
      activeQuestionId: normalizeString(candidate.activeQuestionId || (existing && existing.activeQuestionId), ''),
      answeredQuestionIds: normalizeIdArray(candidate.answeredQuestionIds || (existing && existing.answeredQuestionIds)),
      visitedQuestionIds: normalizeIdArray(candidate.visitedQuestionIds || (existing && existing.visitedQuestionIds)),
      state: normalizeRecord(candidate.state || (existing && existing.state)),
    });
  }

  function normalizeQuestionSnapshot(candidate, existing = null) {
    if (!isPlainObject(candidate)) {
      throw createStorageValidationError('Question snapshot must be an object.');
    }

    const attemptId = normalizeString(candidate.attemptId || (existing && existing.attemptId));
    const questionId = normalizeString(candidate.questionId || (existing && existing.questionId));
    if (!isNonEmptyString(attemptId)) {
      throw createStorageValidationError('Question snapshot attemptId is required.');
    }
    if (!isNonEmptyString(questionId)) {
      throw createStorageValidationError('Question snapshot questionId is required.');
    }

    const currentTime = nowIso();
    const id = normalizeString(candidate.id || (existing && existing.id), createQuestionSnapshotId(attemptId, questionId));
    const createdAt = normalizeIsoDate(candidate.createdAt || (existing && existing.createdAt), currentTime);

    return Object.freeze({
      id,
      attemptId,
      questionId,
      schemaVersion: normalizePositiveInteger(candidate.schemaVersion, DB_SCHEMA.VERSION),
      scriptVersion: normalizeString(candidate.scriptVersion, SCRIPT.VERSION),
      createdAt,
      updatedAt: normalizeIsoDate(candidate.updatedAt, currentTime),
      capturedAt: normalizeIsoDate(candidate.capturedAt || (existing && existing.capturedAt), currentTime),
      blockNumber: normalizePositiveInteger(candidate.blockNumber !== undefined ? candidate.blockNumber : (existing && existing.blockNumber), 1),
      itemIndex: normalizePositiveInteger(candidate.itemIndex !== undefined ? candidate.itemIndex : (existing && existing.itemIndex), 1),
      metadata: normalizeRecord(candidate.metadata || (existing && existing.metadata)),
      promptHtml: normalizeString(candidate.promptHtml !== undefined ? candidate.promptHtml : (existing && existing.promptHtml), ''),
      renderedHtml: normalizeString(candidate.renderedHtml !== undefined ? candidate.renderedHtml : (existing && existing.renderedHtml), ''),
      choices: normalizeRecordArray(candidate.choices || (existing && existing.choices)),
      selectedAnswerId: normalizeString(candidate.selectedAnswerId !== undefined ? candidate.selectedAnswerId : (existing && existing.selectedAnswerId), ''),
      correctAnswerId: normalizeString(candidate.correctAnswerId !== undefined ? candidate.correctAnswerId : (existing && existing.correctAnswerId), ''),
      marked: Boolean(candidate.marked !== undefined ? candidate.marked : (existing && existing.marked)),
      notes: normalizeString(candidate.notes !== undefined ? candidate.notes : (existing && existing.notes), ''),
      annotations: normalizeRecord(candidate.annotations || (existing && existing.annotations)),
      timingMs: normalizePositiveInteger(candidate.timingMs !== undefined ? candidate.timingMs : (existing && existing.timingMs), 0),
      resourceUrls: normalizeStringArray(candidate.resourceUrls || (existing && existing.resourceUrls)),
      contentHash: normalizeString(candidate.contentHash !== undefined ? candidate.contentHash : (existing && existing.contentHash), ''),
      snapshot: normalizeRecord(candidate.snapshot || (existing && existing.snapshot)),
    });
  }

  function removeQuestionContentFromAttempt(attempt) {
    const sanitized = sanitizeJsonCompatible(attempt);
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

  function removeQuestionContentFromSnapshot(snapshot) {
    const sanitized = sanitizeJsonCompatible(snapshot);
    delete sanitized.promptHtml;
    delete sanitized.renderedHtml;
    delete sanitized.choices;
    delete sanitized.notes;
    delete sanitized.annotations;
    delete sanitized.snapshot;
    delete sanitized.resourceUrls;
    return sanitized;
  }

  function createExportEnvelope(exportType, attempts, snapshots) {
    const includeSnapshots = exportType === EXPORT_TYPES.FULL_BACKUP;
    return Object.freeze({
      exportType,
      formatVersion: DB_SCHEMA.EXPORT_FORMAT_VERSION,
      schemaVersion: DB_SCHEMA.VERSION,
      script: Object.freeze({
        name: SCRIPT.NAME,
        version: SCRIPT.VERSION,
        storageNamespace: SCRIPT.STORAGE_NAMESPACE,
      }),
      exportedAt: nowIso(),
      warning: includeSnapshots ? FULL_BACKUP_WARNING : null,
      attempts: attempts.map((attempt) => (includeSnapshots ? sanitizeJsonCompatible(attempt) : removeQuestionContentFromAttempt(attempt))),
      questionSnapshots: includeSnapshots ? snapshots.map((snapshot) => sanitizeJsonCompatible(snapshot)) : [],
    });
  }

  function parseImportPayload(payload) {
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload);
      } catch (error) {
        throw createStorageValidationError('Import JSON is malformed.', error.message);
      }
    }

    if (isPlainObject(payload)) {
      return payload;
    }

    throw createStorageValidationError('Import payload must be a JSON string or object.');
  }

  function validateImportEnvelope(payload) {
    const envelope = parseImportPayload(payload);
    if (!isPlainObject(envelope)) {
      throw createStorageValidationError('Import root must be an object.');
    }

    const formatVersion = normalizePositiveInteger(envelope.formatVersion, 0);
    if (formatVersion < 1 || formatVersion > DB_SCHEMA.EXPORT_FORMAT_VERSION) {
      throw createStorageValidationError(`Unsupported import format version: ${envelope.formatVersion}`);
    }

    const schemaVersion = normalizePositiveInteger(envelope.schemaVersion, DB_SCHEMA.VERSION);
    if (schemaVersion > DB_SCHEMA.VERSION) {
      throw createStorageValidationError(`Unsupported import schema version: ${envelope.schemaVersion}`);
    }

    const exportType = Object.values(EXPORT_TYPES).includes(envelope.exportType)
      ? envelope.exportType
      : EXPORT_TYPES.HISTORY_ONLY;

    if (!Array.isArray(envelope.attempts)) {
      throw createStorageValidationError('Import attempts must be an array.');
    }

    const attempts = envelope.attempts.map((attempt) => normalizeAttemptRecord(attempt, { preserveUpdatedAt: true }));
    const unsupportedAttempt = attempts.find((attempt) => attempt.schemaVersion > DB_SCHEMA.VERSION);
    if (unsupportedAttempt) {
      throw createStorageValidationError(`Unsupported attempt schema version for attempt: ${unsupportedAttempt.id}`);
    }

    const attemptIds = new Set(attempts.map((attempt) => attempt.id));
    if (attemptIds.size !== attempts.length) {
      throw createStorageValidationError('Import attempts contain duplicate ids.');
    }

    const rawSnapshots = Array.isArray(envelope.questionSnapshots) ? envelope.questionSnapshots : [];
    const questionSnapshots = rawSnapshots.map((snapshot) => normalizeQuestionSnapshot(snapshot));
    const unsupportedSnapshot = questionSnapshots.find((snapshot) => snapshot.schemaVersion > DB_SCHEMA.VERSION);
    if (unsupportedSnapshot) {
      throw createStorageValidationError(`Unsupported snapshot schema version for snapshot: ${unsupportedSnapshot.id}`);
    }

    const invalidSnapshot = questionSnapshots.find((snapshot) => !attemptIds.has(snapshot.attemptId));
    if (invalidSnapshot) {
      throw createStorageValidationError(`Import snapshot references missing attempt: ${invalidSnapshot.attemptId}`);
    }

    const snapshotPairs = new Set();
    const duplicateSnapshot = questionSnapshots.find((snapshot) => {
      const pairKey = `${snapshot.attemptId}\u0000${snapshot.questionId}`;
      if (snapshotPairs.has(pairKey)) {
        return true;
      }
      snapshotPairs.add(pairKey);
      return false;
    });
    if (duplicateSnapshot) {
      throw createStorageValidationError(`Import snapshots contain duplicate attempt/question pair: ${duplicateSnapshot.attemptId}/${duplicateSnapshot.questionId}`);
    }

    return Object.freeze({
      exportType,
      formatVersion,
      schemaVersion,
      importedAt: nowIso(),
      attempts,
      questionSnapshots,
    });
  }

  function sortAttemptsNewestFirst(attempts) {
    return attempts.slice().sort((left, right) => {
      const leftTime = Date.parse(left.startedAt || left.createdAt || 0) || 0;
      const rightTime = Date.parse(right.startedAt || right.createdAt || 0) || 0;
      return rightTime - leftTime;
    });
  }

  function createAttemptStore(options) {
    const logger = options.logger;
    let dbPromise = null;

    function getDb() {
      if (!dbPromise) {
        dbPromise = createIndexedDbOpenPromise(options.databaseName, DB_SCHEMA.VERSION, logger)
          .catch((error) => {
            dbPromise = null;
            throw error;
          });
      }
      return dbPromise;
    }

    async function ready() {
      await getDb();
      return Object.freeze({
        databaseName: options.databaseName,
        schemaVersion: DB_SCHEMA.VERSION,
        stores: DB_SCHEMA.STORES,
      });
    }

    async function getSchemaMetadata() {
      const db = await getDb();
      return idbGet(db, DB_SCHEMA.STORES.SCHEMA_METADATA, 'schema');
    }

    async function createAttempt(candidate = {}) {
      const db = await getDb();
      const attempt = normalizeAttemptRecord(candidate);
      const existing = await idbGet(db, DB_SCHEMA.STORES.ATTEMPTS, attempt.id);
      if (existing) {
        throw createStorageValidationError(`Attempt already exists: ${attempt.id}`);
      }
      await idbPut(db, DB_SCHEMA.STORES.ATTEMPTS, attempt);
      if (attempt.status === ATTEMPT_STATUS.IN_PROGRESS) {
        await saveInProgressState({ attemptId: attempt.id, state: { createdWithAttempt: true } });
      }
      return attempt;
    }

    async function upsertAttempt(candidate = {}) {
      const db = await getDb();
      const existingId = normalizeString(candidate.id);
      const existing = existingId ? await idbGet(db, DB_SCHEMA.STORES.ATTEMPTS, existingId) : null;
      const attempt = normalizeAttemptRecord(candidate, { existing });
      await idbPut(db, DB_SCHEMA.STORES.ATTEMPTS, attempt);
      if (attempt.status === ATTEMPT_STATUS.IN_PROGRESS) {
        const state = await getInProgressState(attempt.id);
        if (!state) {
          await saveInProgressState({ attemptId: attempt.id, state: { upsertedWithAttempt: true } });
        }
      } else {
        await deleteInProgressState(attempt.id);
      }
      return attempt;
    }

    async function updateAttempt(attemptId, patch = {}) {
      const db = await getDb();
      const id = normalizeString(attemptId);
      if (!isNonEmptyString(id)) {
        throw createStorageValidationError('Attempt id is required.');
      }
      const existing = await idbGet(db, DB_SCHEMA.STORES.ATTEMPTS, id);
      if (!existing) {
        throw createStorageValidationError(`Attempt not found: ${id}`);
      }
      const attempt = mergeAttemptPatch(existing, patch);
      await idbPut(db, DB_SCHEMA.STORES.ATTEMPTS, attempt);
      if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
        await deleteInProgressState(attempt.id);
      }
      return attempt;
    }

    async function getAttempt(attemptId) {
      const db = await getDb();
      const id = normalizeString(attemptId);
      if (!id) {
        return null;
      }
      return idbGet(db, DB_SCHEMA.STORES.ATTEMPTS, id);
    }

    async function listAttempts(filter = {}) {
      const db = await getDb();
      let attempts = await idbGetAll(db, DB_SCHEMA.STORES.ATTEMPTS);
      if (filter.status) {
        const status = normalizeAttemptStatus(filter.status);
        attempts = attempts.filter((attempt) => attempt.status === status);
      }
      if (filter.includeInProgress === false) {
        attempts = attempts.filter((attempt) => attempt.status !== ATTEMPT_STATUS.IN_PROGRESS);
      }
      return sortAttemptsNewestFirst(attempts);
    }

    async function deleteAttempt(attemptId) {
      const db = await getDb();
      const id = normalizeString(attemptId);
      if (!isNonEmptyString(id)) {
        throw createStorageValidationError('Attempt id is required.');
      }
      await idbDelete(db, DB_SCHEMA.STORES.ATTEMPTS, id);
      await idbDelete(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES, id);
      await idbDeleteAllByIndex(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, DB_SCHEMA.INDEXES.SNAPSHOTS_BY_ATTEMPT_ID, id);
      return true;
    }

    async function clearAllHistory() {
      const db = await getDb();
      await idbClear(db, DB_SCHEMA.STORES.ATTEMPTS);
      await idbClear(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES);
      await idbClear(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS);
      return true;
    }

    async function saveInProgressState(candidate = {}) {
      const db = await getDb();
      const attemptId = normalizeString(candidate.attemptId);
      const existing = attemptId ? await idbGet(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES, attemptId) : null;
      const state = normalizeInProgressState(candidate, existing);
      await idbPut(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES, state);
      return state;
    }

    async function getInProgressState(attemptId) {
      const db = await getDb();
      const id = normalizeString(attemptId);
      if (!id) {
        return null;
      }
      return idbGet(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES, id);
    }

    async function listInProgressStates() {
      const db = await getDb();
      const states = await idbGetAll(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES);
      return states.slice().sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0));
    }

    async function deleteInProgressState(attemptId) {
      const db = await getDb();
      const id = normalizeString(attemptId);
      if (!id) {
        return false;
      }
      await idbDelete(db, DB_SCHEMA.STORES.IN_PROGRESS_ATTEMPT_STATES, id);
      return true;
    }

    async function saveQuestionSnapshot(candidate = {}) {
      const db = await getDb();
      const candidateId = normalizeString(candidate.id);
      const candidateAttemptId = normalizeString(candidate.attemptId);
      const candidateQuestionId = normalizeString(candidate.questionId);
      const existingById = candidateId ? await idbGet(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, candidateId) : null;
      const existingByPair = !existingById && candidateAttemptId && candidateQuestionId
        ? await idbGetByIndex(
            db,
            DB_SCHEMA.STORES.QUESTION_SNAPSHOTS,
            DB_SCHEMA.INDEXES.SNAPSHOTS_BY_ATTEMPT_AND_QUESTION,
            [candidateAttemptId, candidateQuestionId]
          )
        : null;
      const snapshot = normalizeQuestionSnapshot(candidate, existingById || existingByPair);
      const attempt = await getAttempt(snapshot.attemptId);
      if (!attempt) {
        throw createStorageValidationError(`Cannot save snapshot for missing attempt: ${snapshot.attemptId}`);
      }
      await idbPut(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, snapshot);
      if (!attempt.questionIds.includes(snapshot.questionId)) {
        await updateAttempt(attempt.id, {
          questionIds: attempt.questionIds.concat(snapshot.questionId),
          questionCount: Math.max(attempt.questionCount || 0, attempt.questionIds.length + 1),
        });
      }
      return snapshot;
    }

    async function getQuestionSnapshot(attemptId, questionId) {
      const db = await getDb();
      if (questionId === undefined) {
        const id = normalizeString(attemptId);
        return id ? idbGet(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, id) : null;
      }

      const normalizedAttemptId = normalizeString(attemptId);
      const normalizedQuestionId = normalizeString(questionId);
      if (!normalizedAttemptId || !normalizedQuestionId) {
        return null;
      }

      return idbGetByIndex(
        db,
        DB_SCHEMA.STORES.QUESTION_SNAPSHOTS,
        DB_SCHEMA.INDEXES.SNAPSHOTS_BY_ATTEMPT_AND_QUESTION,
        [normalizedAttemptId, normalizedQuestionId]
      );
    }

    async function listQuestionSnapshots(attemptId) {
      const db = await getDb();
      const id = normalizeString(attemptId);
      if (!id) {
        return [];
      }
      const snapshots = await idbGetAllByIndex(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, DB_SCHEMA.INDEXES.SNAPSHOTS_BY_ATTEMPT_ID, id);
      return snapshots.slice().sort((left, right) => {
        if (left.blockNumber !== right.blockNumber) {
          return left.blockNumber - right.blockNumber;
        }
        return left.itemIndex - right.itemIndex;
      });
    }

    async function deleteQuestionSnapshot(attemptId, questionId) {
      const db = await getDb();
      const snapshot = await getQuestionSnapshot(attemptId, questionId);
      if (!snapshot) {
        return false;
      }
      await idbDelete(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, snapshot.id);
      return true;
    }

    async function exportHistoryOnly() {
      const db = await getDb();
      const attempts = await idbGetAll(db, DB_SCHEMA.STORES.ATTEMPTS);
      return createExportEnvelope(EXPORT_TYPES.HISTORY_ONLY, sortAttemptsNewestFirst(attempts), []);
    }

    async function exportHistoryOnlyJson() {
      return JSON.stringify(await exportHistoryOnly(), null, 2);
    }

    async function exportFullBackup(optionsForExport = {}) {
      if (optionsForExport.acknowledgeWarning !== true) {
        throw createStorageValidationError('Full backup export requires explicit warning acknowledgement.', FULL_BACKUP_WARNING);
      }
      const db = await getDb();
      const attempts = await idbGetAll(db, DB_SCHEMA.STORES.ATTEMPTS);
      const snapshots = await idbGetAll(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS);
      return createExportEnvelope(EXPORT_TYPES.FULL_BACKUP, sortAttemptsNewestFirst(attempts), snapshots);
    }

    async function exportFullBackupJson(optionsForExport = {}) {
      return JSON.stringify(await exportFullBackup(optionsForExport), null, 2);
    }

    async function importJson(payload, importOptions = {}) {
      const importEnvelope = validateImportEnvelope(payload);
      const conflictMode = ['skip', 'replace', 'keep-both'].includes(importOptions.conflictMode)
        ? importOptions.conflictMode
        : 'skip';
      const db = await getDb();
      const existingAttemptIds = new Set((await idbGetAll(db, DB_SCHEMA.STORES.ATTEMPTS)).map((attempt) => attempt.id));
      const plannedImportedIds = new Set();
      const importedAttemptIdByOriginalId = new Map();
      const result = {
        importedAt: importEnvelope.importedAt,
        importedAttempts: 0,
        skippedAttempts: 0,
        replacedAttempts: 0,
        importedQuestionSnapshots: 0,
        skippedQuestionSnapshots: 0,
        conflictMode,
      };

      for (const rawAttempt of importEnvelope.attempts) {
        const existing = await idbGet(db, DB_SCHEMA.STORES.ATTEMPTS, rawAttempt.id);
        if (existing && conflictMode === 'skip') {
          importedAttemptIdByOriginalId.set(rawAttempt.id, null);
          result.skippedAttempts += 1;
          continue;
        }

        let attempt = rawAttempt;
        if (existing && conflictMode === 'keep-both') {
          let newId = createStorageId('attempt');
          while (existingAttemptIds.has(newId) || plannedImportedIds.has(newId)) {
            newId = createStorageId('attempt');
          }
          importedAttemptIdByOriginalId.set(rawAttempt.id, newId);
          attempt = normalizeAttemptRecord({
            ...rawAttempt,
            id: newId,
            source: { ...rawAttempt.source, importedFromAttemptId: rawAttempt.id },
            importMetadata: {
              originalAttemptId: rawAttempt.id,
              importedAt: importEnvelope.importedAt,
              conflictMode,
            },
          }, { preserveUpdatedAt: true });
        } else {
          importedAttemptIdByOriginalId.set(rawAttempt.id, rawAttempt.id);
          attempt = normalizeAttemptRecord({
            ...rawAttempt,
            importMetadata: {
              ...(rawAttempt.importMetadata || {}),
              importedAt: importEnvelope.importedAt,
              conflictMode,
            },
          }, { preserveUpdatedAt: true });
        }

        if (existing && conflictMode === 'replace') {
          await deleteAttempt(rawAttempt.id);
          result.replacedAttempts += 1;
        }

        plannedImportedIds.add(attempt.id);
        await idbPut(db, DB_SCHEMA.STORES.ATTEMPTS, attempt);
        result.importedAttempts += 1;
      }

      const existingSnapshotKeys = new Set((await idbGetAll(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS)).map((snapshot) => snapshot.id));
      const plannedSnapshotKeys = new Set();

      for (const rawSnapshot of importEnvelope.questionSnapshots) {
        const mappedAttemptId = importedAttemptIdByOriginalId.get(rawSnapshot.attemptId);
        if (!mappedAttemptId) {
          result.skippedQuestionSnapshots += 1;
          continue;
        }

        const snapshotCandidate = mappedAttemptId === rawSnapshot.attemptId
          ? rawSnapshot
          : {
              ...rawSnapshot,
              id: createQuestionSnapshotId(mappedAttemptId, rawSnapshot.questionId),
              attemptId: mappedAttemptId,
            };

        try {
          const snapshot = normalizeQuestionSnapshot(snapshotCandidate);
          if (plannedSnapshotKeys.has(snapshot.id)) {
            result.skippedQuestionSnapshots += 1;
            continue;
          }
          if (existingSnapshotKeys.has(snapshot.id) && conflictMode === 'skip') {
            result.skippedQuestionSnapshots += 1;
            continue;
          }
          plannedSnapshotKeys.add(snapshot.id);
          await idbPut(db, DB_SCHEMA.STORES.QUESTION_SNAPSHOTS, snapshot);
          result.importedQuestionSnapshots += 1;
        } catch (error) {
          logger.warn('Skipped invalid imported question snapshot.', error);
          result.skippedQuestionSnapshots += 1;
        }
      }

      return Object.freeze(result);
    }

    return Object.freeze({
      ready,
      getSchemaMetadata,
      createAttempt,
      upsertAttempt,
      updateAttempt,
      getAttempt,
      listAttempts,
      deleteAttempt,
      clearAllHistory,
      saveInProgressState,
      getInProgressState,
      listInProgressStates,
      deleteInProgressState,
      saveQuestionSnapshot,
      getQuestionSnapshot,
      listQuestionSnapshots,
      deleteQuestionSnapshot,
      exportHistoryOnly,
      exportHistoryOnlyJson,
      exportFullBackup,
      exportFullBackupJson,
      importJson,
      constants: Object.freeze({
        schema: DB_SCHEMA,
        statuses: ATTEMPT_STATUS,
        exportTypes: EXPORT_TYPES,
        fullBackupWarning: FULL_BACKUP_WARNING,
      }),
    });
  }

  // Phase 3 WebFRED site adapter lives below this marker.

  function createWebfredAdapterError(message, details) {
    const error = new Error(message);
    error.name = 'Free120WebfredAdapterError';
    error.details = details || null;
    return error;
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

  function extractNavigationStateFromDom(adapterDocument, adapterWindow) {
    if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
      return Object.freeze({ currentBlock: 0, blockCount: 0, currentItemIndex: 0, itemCount: 0 });
    }

    const nav = adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR);
    const navItems = nav ? Array.from(nav.querySelectorAll('li')) : [];
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

  function extractItemListFromDom(adapterDocument, adapterWindow, examIdentity) {
    if (!adapterDocument || typeof adapterDocument.querySelector !== 'function') {
      return [];
    }

    const nav = adapterDocument.querySelector(WEBFRED_ADAPTER_CONFIG.DOM_NAV_SELECTOR);
    if (!nav) {
      return [];
    }

    const navState = extractNavigationStateFromDom(adapterDocument, adapterWindow);
    return Array.from(nav.querySelectorAll('li')).map((item, index) => {
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

  function extractAngularState(adapterWindow, adapterDocument, angularServices, domState) {
    const roots = collectAngularStateRoots(angularServices);
    const fallbackExamIdentity = domState && domState.examIdentity ? domState.examIdentity : extractExamIdentityFromDom(adapterDocument, adapterWindow);
    const examIdentity = normalizeExamIdentityFromAngular(roots, fallbackExamIdentity);
    const launchedScope = normalizeLaunchedScopeFromAngular(roots, domState && domState.launchedScope);
    const currentBlock = coercePositiveInteger(
      findFirstSemanticValue(roots, ['currentBlock', 'blockNumber', 'activeBlock', 'selectedBlock'], { maxDepth: 3 }),
      domState && domState.currentBlock ? domState.currentBlock : 0
    );
    const blockCount = coercePositiveInteger(
      findFirstSemanticValue(roots, ['blockCount', 'numberOfBlocks', 'totalBlocks', 'blocksCount'], { maxDepth: 3 }),
      domState && domState.blockCount ? domState.blockCount : 0
    );
    const itemCount = coercePositiveInteger(
      findFirstSemanticValue(roots, ['itemCount', 'questionCount', 'itemsCount', 'totalItems', 'totalQuestions'], { maxDepth: 3 }),
      domState && domState.itemCount ? domState.itemCount : 0
    );

    const rawItemList = findFirstSemanticValue(roots, ['itemList', 'items', 'questions', 'questionList', 'testItems'], { maxDepth: 3 });
    const rawCurrentItem = findFirstSemanticValue(roots, ['currentItem', 'activeItem', 'selectedItem', 'item', 'currentQuestion'], { maxDepth: 3 });
    const fallbackItem = domState && domState.currentItem ? domState.currentItem : null;
    const itemList = normalizeItemListFromAngular(rawItemList, {
      examIdentity,
      blockNumber: currentBlock || (fallbackItem && fallbackItem.blockNumber) || 1,
      fallbackItem,
    });
    let currentItem = isReadableObject(rawCurrentItem)
      ? normalizeAngularItem(rawCurrentItem, {
          examIdentity,
          blockNumber: currentBlock || (fallbackItem && fallbackItem.blockNumber) || 1,
          index: fallbackItem && fallbackItem.itemIndex,
          fallback: fallbackItem,
        })
      : null;

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
    const blockMetadata = normalizeBlockMetadataFromAngular(rawBlocks, currentBlock, blockCount, itemCount || itemList.length);

    return Object.freeze({
      source: WEBFRED_STATE_SOURCE.ANGULAR,
      examIdentity,
      launchedScope,
      currentBlock: currentBlock || (currentItem && currentItem.blockNumber) || 0,
      blockCount,
      itemCount: itemCount || itemList.length || (domState && domState.itemCount) || 0,
      currentItem,
      itemList,
      answers,
      marks,
      currentContent,
      blockMetadata,
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

  function detectRuntimeContext(currentLocation) {
    const url = new URL(currentLocation.href);
    const pathname = url.pathname || '/';

    if (url.origin !== SCRIPT.ORIGIN) {
      return freezeRuntimeContext({
        pageKind: PAGE_KIND.UNSUPPORTED,
        supported: false,
        reason: 'unsupported-origin',
        url,
      });
    }

    if (launchPagePattern.test(pathname)) {
      return freezeRuntimeContext({
        pageKind: PAGE_KIND.LAUNCH,
        supported: true,
        reason: 'launch-page-match',
        url,
      });
    }

    if (webfredPagePattern.test(pathname)) {
      return freezeRuntimeContext({
        pageKind: PAGE_KIND.WEBFRED,
        supported: true,
        reason: 'webfred-page-match',
        url,
      });
    }

    return freezeRuntimeContext({
      pageKind: PAGE_KIND.UNSUPPORTED,
      supported: false,
      reason: 'unsupported-path',
      url,
    });
  }

  function freezeRuntimeContext(context) {
    return Object.freeze({
      pageKind: context.pageKind,
      supported: context.supported,
      reason: context.reason,
      href: context.url.href,
      origin: context.url.origin,
      pathname: context.url.pathname,
      search: context.url.search,
    });
  }

  function createRuntimeState(runtimeContext) {
    const startedAt = new Date().toISOString();
    let bootstrapped = false;

    return Object.freeze({
      markBootstrapped() {
        bootstrapped = true;
      },
      snapshot() {
        return Object.freeze({
          scriptName: SCRIPT.NAME,
          scriptVersion: SCRIPT.VERSION,
          storageSchemaVersion: SCRIPT.STORAGE_SCHEMA_VERSION,
          startedAt,
          bootstrapped,
          context: runtimeContext,
        });
      },
    });
  }

  function bootstrapLaunchPage(services) {
    services.logger.debug('Launch page shell ready.', services.runtimeState.snapshot());
    bootstrapStorage(services);
  }

  function bootstrapWebfredPage(services) {
    services.logger.debug('WebFRED page shell ready.', services.runtimeState.snapshot());
    bootstrapStorage(services);
    bootstrapWebfredAdapter(services);
  }

  function bootstrapWebfredAdapter(services) {
    if (!services.webfredAdapter) {
      return;
    }

    services.webfredAdapter.waitForInitialization()
      .then((state) => {
        services.logger.debug('WebFRED adapter initialized.', summarizeWebfredStateForLog(state));
      })
      .catch((error) => {
        services.logger.error('WebFRED adapter initialization failed.', error);
      });
  }

  function summarizeWebfredStateForLog(state) {
    if (!state) {
      return Object.freeze({ status: WEBFRED_ADAPTER_STATUS.UNAVAILABLE });
    }

    return Object.freeze({
      status: state.status,
      source: state.source,
      degradedReasons: state.degradedReasons || [],
      examIdentity: state.examIdentity || {},
      launchedScope: state.launchedScope || {},
      currentBlock: state.currentBlock || 0,
      blockCount: state.blockCount || 0,
      itemCount: state.itemCount || 0,
      currentItem: state.currentItem ? snapshotForAttemptPosition(state) : null,
      itemListCount: state.itemList ? state.itemList.length : 0,
      answersCount: state.answers ? Object.keys(state.answers).length : 0,
      marksCount: state.marks ? Object.keys(state.marks).length : 0,
      capabilities: state.capabilities || {},
    });
  }

  function bootstrapUnsupportedPage(services) {
    services.logger.debug('Unsupported page ignored.', services.runtimeState.snapshot());
  }

  function bootstrapStorage(services) {
    services.storage.ready()
      .then((metadata) => {
        services.logger.debug('Storage foundation ready.', metadata);
      })
      .catch((error) => {
        services.logger.error('Storage foundation unavailable.', error);
      });
  }

  function publishApi(api, logger) {
    try {
      Object.defineProperty(window, 'Free120Helper', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: api,
      });
    } catch (error) {
      logger.debug('Could not expose Free120Helper API.', error);
    }
  }

  const settingsStore = createSettingsStore(window.localStorage, STORAGE_KEYS.SETTINGS);
  const logger = createLogger(settingsStore);
  const runtimeContext = detectRuntimeContext(window.location);
  const runtimeState = createRuntimeState(runtimeContext);
  const attemptStore = createAttemptStore({
    databaseName: STORAGE_KEYS.INDEXED_DB,
    logger,
  });
  const webfredAdapter = createWebfredSiteAdapter({
    window,
    document,
    logger,
  });

  const api = Object.freeze({
    constants: SCRIPT,
    storageKeys: STORAGE_KEYS,
    storageSchema: DB_SCHEMA,
    attemptStatuses: ATTEMPT_STATUS,
    exportTypes: EXPORT_TYPES,
    fullBackupWarning: FULL_BACKUP_WARNING,
    settings: settingsStore,
    storage: attemptStore,
    webfred: webfredAdapter,
    logger,
    runtime: Object.freeze({
      context: runtimeContext,
      state: runtimeState,
      isLaunchPage() {
        return runtimeContext.pageKind === PAGE_KIND.LAUNCH;
      },
      isWebfredPage() {
        return runtimeContext.pageKind === PAGE_KIND.WEBFRED;
      },
    }),
  });

  publishApi(api, logger);
  runtimeState.markBootstrapped();

  const services = Object.freeze({
    logger,
    runtimeContext,
    runtimeState,
    storage: attemptStore,
    webfredAdapter,
  });

  if (runtimeContext.pageKind === PAGE_KIND.LAUNCH) {
    bootstrapLaunchPage(services);
  } else if (runtimeContext.pageKind === PAGE_KIND.WEBFRED) {
    bootstrapWebfredPage(services);
  } else {
    bootstrapUnsupportedPage(services);
  }
})();
