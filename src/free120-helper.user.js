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

  const DEFAULT_SETTINGS = Object.freeze({
    debug: false,
    pillVisible: true,
  });

  const PAGE_KIND = Object.freeze({
    LAUNCH: 'launch',
    WEBFRED: 'webfred',
    UNSUPPORTED: 'unsupported',
  });

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
  }

  function bootstrapWebfredPage(services) {
    services.logger.debug('WebFRED page shell ready.', services.runtimeState.snapshot());
  }

  function bootstrapUnsupportedPage(services) {
    services.logger.debug('Unsupported page ignored.', services.runtimeState.snapshot());
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

  const api = Object.freeze({
    constants: SCRIPT,
    storageKeys: STORAGE_KEYS,
    settings: settingsStore,
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
  });

  if (runtimeContext.pageKind === PAGE_KIND.LAUNCH) {
    bootstrapLaunchPage(services);
  } else if (runtimeContext.pageKind === PAGE_KIND.WEBFRED) {
    bootstrapWebfredPage(services);
  } else {
    bootstrapUnsupportedPage(services);
  }
})();
