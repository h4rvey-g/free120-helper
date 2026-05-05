import { SCRIPT, PAGE_KIND, WEBFRED_ADAPTER_STATUS } from '../core/constants.js';
import { snapshotForAttemptPosition } from '../webfred/adapter.js';

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
      if (services.trackingEngine) {
        services.trackingEngine.start({ adapterState: state })
          .then((result) => {
            services.logger.debug('Tracking engine started.', result && result.attempt ? { attemptId: result.attempt.id, status: result.status } : result);
          })
          .catch((error) => {
            services.logger.warn('Tracking engine failed.', error);
          });
        return;
      }
      if (services.answerKeyCapture) {
        services.answerKeyCapture.startAutoCapture({ adapterState: state })
          .then((result) => {
            services.logger.debug('Answer-key capture finished.', result && result.summary ? result.summary : result);
          })
          .catch((error) => {
            services.logger.warn('Answer-key capture failed.', error);
          });
      }
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

export {
  createRuntimeState,
  bootstrapLaunchPage,
  bootstrapWebfredPage,
  bootstrapWebfredAdapter,
  summarizeWebfredStateForLog,
  bootstrapUnsupportedPage,
  bootstrapStorage,
  publishApi,
};
