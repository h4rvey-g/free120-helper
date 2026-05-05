import { SCRIPT } from './constants.js';

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

export { createLogger, nowIso };
