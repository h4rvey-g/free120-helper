import {
  SCRIPT,
  STORAGE_KEYS,
  DB_SCHEMA,
  ATTEMPT_STATUS,
  EXPORT_TYPES,
  FULL_BACKUP_WARNING,
  PAGE_KIND,
  TRACKING_ENGINE_STATUS,
} from './core/constants.js';
import { createSettingsStore } from './core/settings.js';
import { createLogger } from './core/logger.js';
import { detectRuntimeContext } from './core/runtime-context.js';
import { createAttemptStore } from './storage/attempt-store.js';
import { createWebfredSiteAdapter } from './webfred/adapter.js';
import { createTrackingEngine } from './tracking/engine.js';
import { createActiveExamPill } from './ui/active-exam-pill.js';
import { createLaunchHistory } from './ui/launch-history.js';
import { createQBankCacheController } from './qbank/cache-controller.js';
import { buildReviewHtml, openReviewTab } from './review/blob-builder.js';
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
const trackingEngine = createTrackingEngine({
  window,
  document,
  logger,
  storage: attemptStore,
  webfredAdapter,
  runtimeContext,
});
let activeExamPill = null;
if (runtimeContext.pageKind === PAGE_KIND.WEBFRED) {
  try {
    activeExamPill = createActiveExamPill({
      window,
      document,
      logger,
      settingsStore,
      storage: attemptStore,
      webfredAdapter,
      trackingEngine,
      reviewLauncher(attemptId, attempt) {
        return openReviewTab({ window, storage: attemptStore, attemptId, attempt });
      },
    });
  } catch (error) {
    logger.warn('Active-exam pill failed.', error);
  }
}

let qbankCache = null;
let launchHistory = null;
if (runtimeContext.pageKind === PAGE_KIND.LAUNCH) {
  try {
    qbankCache = createQBankCacheController({
      window,
      document,
      logger,
      storage: attemptStore,
    });
    launchHistory = createLaunchHistory({
      window,
      document,
      logger,
      storage: attemptStore,
      qbankCache,
      reviewLauncher(attemptId, attempt) {
        return openReviewTab({ window, storage: attemptStore, attemptId, attempt });
      },
    });
  } catch (error) {
    logger.warn('Launch history UI failed.', error);
  }
}
const helperSettings = Object.freeze({
  ...settingsStore,
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
  review: Object.freeze({
    buildReviewHtml,
    openAttempt(attemptId) {
      return openReviewTab({ window, storage: attemptStore, attemptId });
    },
  }),
  tracking: trackingEngine,
  trackingEngine,
  trackingEngineStatuses: TRACKING_ENGINE_STATUS,
  qbankCache,
  ui: Object.freeze({
    activeExamPill,
    launchHistory,
    qbankCache,
    getActiveExamPill() {
      return activeExamPill;
    },
    getLaunchHistory() {
      return launchHistory;
    },
    getQBankCache() {
      return qbankCache;
    },
  }),
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
  trackingEngine,
  activeExamPill,
  launchHistory,
  qbankCache,
});

if (runtimeContext.pageKind === PAGE_KIND.LAUNCH) {
  bootstrapLaunchPage(services);
} else if (runtimeContext.pageKind === PAGE_KIND.WEBFRED) {
  bootstrapWebfredPage(services);
} else {
  bootstrapUnsupportedPage(services);
}
