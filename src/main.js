import {
  SCRIPT,
  STORAGE_KEYS,
  DB_SCHEMA,
  ATTEMPT_STATUS,
  EXPORT_TYPES,
  FULL_BACKUP_WARNING,
  PAGE_KIND,
  ANSWER_KEY_CAPTURE_STATUS,
  ANSWER_KEY_CAPTURE_SOURCE,
  TRACKING_ENGINE_STATUS,
} from './core/constants.js';
import { createSettingsStore } from './core/settings.js';
import { createLogger } from './core/logger.js';
import { detectRuntimeContext } from './core/runtime-context.js';
import { createAttemptStore } from './storage/attempt-store.js';
import { createWebfredSiteAdapter } from './webfred/adapter.js';
import { createAnswerKeyCaptureController } from './answer-keys/controller.js';
import { createTrackingEngine } from './tracking/engine.js';
import {
  createRuntimeState,
  bootstrapLaunchPage,
  bootstrapWebfredPage,
  bootstrapUnsupportedPage,
  publishApi,
} from './runtime/bootstrap.js';

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
const answerKeyCapture = createAnswerKeyCaptureController({
  window,
  document,
  logger,
  webfredAdapter,
  storage: attemptStore,
});
const trackingEngine = createTrackingEngine({
  window,
  document,
  logger,
  storage: attemptStore,
  webfredAdapter,
  answerKeyCapture,
  runtimeContext,
});
const helperSettings = Object.freeze({
  ...settingsStore,
  retryAnswerKeyCapture(captureOptions = {}) {
    return answerKeyCapture.manualRetry(captureOptions);
  },
  getAnswerKeyCaptureStatus() {
    return answerKeyCapture.getStatus();
  },
  getLastAnswerKeyCaptureResult() {
    return answerKeyCapture.getLastResult();
  },
  getTrackingStatus() {
    return trackingEngine.getStatus();
  },
  flushTracking(reason = 'settings-flush') {
    return trackingEngine.flush(reason);
  },
});

const api = Object.freeze({
  constants: SCRIPT,
  storageKeys: STORAGE_KEYS,
  storageSchema: DB_SCHEMA,
  attemptStatuses: ATTEMPT_STATUS,
  exportTypes: EXPORT_TYPES,
  fullBackupWarning: FULL_BACKUP_WARNING,
  settings: helperSettings,
  storage: attemptStore,
  webfred: webfredAdapter,
  answerKeys: answerKeyCapture,
  answerKeyCapture,
  answerKeyCaptureStatuses: ANSWER_KEY_CAPTURE_STATUS,
  answerKeyCaptureSources: ANSWER_KEY_CAPTURE_SOURCE,
  tracking: trackingEngine,
  trackingEngine,
  trackingEngineStatuses: TRACKING_ENGINE_STATUS,
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
  answerKeyCapture,
  trackingEngine,
});

if (runtimeContext.pageKind === PAGE_KIND.LAUNCH) {
  bootstrapLaunchPage(services);
} else if (runtimeContext.pageKind === PAGE_KIND.WEBFRED) {
  bootstrapWebfredPage(services);
} else {
  bootstrapUnsupportedPage(services);
}
