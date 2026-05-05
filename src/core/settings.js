import { DEFAULT_SETTINGS } from './constants.js';

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

export { createSettingsStore, readSettings, writeSettings, normalizeSettings };
