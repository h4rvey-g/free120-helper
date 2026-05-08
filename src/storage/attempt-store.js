import { SCRIPT, DB_SCHEMA, ATTEMPT_STATUS, EXPORT_TYPES, FULL_BACKUP_WARNING } from '../core/constants.js';
import { nowIso } from '../core/logger.js';
import {
  createQuestionSnapshotId,
  createStorageId,
  isNonEmptyString,
  isPlainObject,
  normalizeIdArray,
  normalizeNullableRecord,
  normalizePositiveInteger,
  normalizeRecord,
  normalizeRecordArray,
  normalizeString,
  normalizeStringArray,
  sanitizeJsonCompatible,
} from '../core/data.js';

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
    answerKeyCapture: normalizeRecord(candidate.answerKeyCapture || (existing && existing.answerKeyCapture)),
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

export {
  createAttemptStore,
  createStorageError,
  createStorageValidationError,
  normalizeAttemptStatus,
  normalizeIsoDate,
  normalizeNullableIsoDate,
};
