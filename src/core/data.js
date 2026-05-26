function createDataValidationError(message, details) {
  const error = new Error(message);
  error.name = 'Free120DataValidationError';
  error.details = details || null;
  return error;
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object');
}

function hasFunction(value, name) {
  return Boolean(value && typeof value[name] === 'function');
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function plainObjectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
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

function coercePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback) {
  return coercePositiveInteger(value, fallback);
}

function coerceNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function uniqueNormalizedStrings(values) {
  const seen = new Set();
  const result = [];
  arrayOrEmpty(values).forEach((value) => {
    const normalized = normalizeString(value, '');
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function firstNonEmpty(values, fallback = '') {
  for (const value of arrayOrEmpty(values)) {
    const normalized = normalizeString(value, '');
    if (normalized) {
      return normalized;
    }
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
    throw createDataValidationError('Stored records must not exceed 50 nested levels.');
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
      throw createDataValidationError('Stored records must not contain circular arrays.');
    }
    const nextSeen = seen.concat([value]);
    return value.map((item) => sanitizeJsonCompatible(item, depth + 1, nextSeen));
  }

  if (isPlainObject(value)) {
    if (seen.includes(value)) {
      throw createDataValidationError('Stored records must not contain circular objects.');
    }
    const nextSeen = seen.concat([value]);
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

  throw createDataValidationError('Stored records must be JSON-compatible plain data.');
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
  return arrayOrEmpty(value)
    .filter((item) => isPlainObject(item))
    .map((item) => sanitizeJsonCompatible(item));
}

function normalizeIdArray(value) {
  return arrayOrEmpty(value)
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
}

function normalizeStringArray(value) {
  return arrayOrEmpty(value)
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
}

export {
  isPlainObject,
  isNonEmptyString,
  isObject,
  hasFunction,
  arrayOrEmpty,
  plainObjectOrEmpty,
  normalizeString,
  coercePositiveInteger,
  normalizePositiveInteger,
  coerceNonNegativeInteger,
  uniqueNormalizedStrings,
  firstNonEmpty,
  createStorageId,
  createQuestionSnapshotId,
  sanitizeJsonCompatible,
  normalizeRecord,
  normalizeNullableRecord,
  normalizeRecordArray,
  normalizeIdArray,
  normalizeStringArray,
};
