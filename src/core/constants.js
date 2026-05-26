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
    'https://orientation.nbme.org/launch*',
    'https://orientation.nbme.org/launch/*',
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
  pillVisible: false,
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
    'section#item article#content div#medley .NBSinglePage',
    'article#content div#medley .NBSinglePage',
    'div#medley .NBSinglePage',
    'section#item .NBSinglePage',
    'article#content .NBSinglePage',
    'section#item article#content div#medley .NBDefault',
    'article#content div#medley .NBDefault',
    'div#medley .NBDefault',
    'section#item .NBDefault',
    'article#content .NBDefault',
  ]),
  DOM_NAV_SELECTOR: 'nav > ol#leftnav, ol#leftnav',
});

const ANSWER_KEY_CAPTURE_STATUS = Object.freeze({
  IDLE: 'idle',
  PENDING: 'pending',
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  FAILED: 'failed',
});

const TRACKING_ENGINE_STATUS = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  TRACKING: 'tracking',
  DEGRADED: 'degraded',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

const TRACKING_ENGINE_CONFIG = Object.freeze({
  POLL_INTERVAL_MS: 1500,
  EVENT_FLUSH_DELAY_MS: 75,
  ATTEMPT_READY_TIMEOUT_MS: 5000,
  MAX_TIMING_SEGMENTS_PER_QUESTION: 200,
  MAX_ANNOTATION_ITEMS: 80,
  MAX_ANNOTATION_HTML_CHARS: 4000,
  NOTE_SELECTOR: 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]',
});

const WEBFRED_ANGULAR_SERVICE_CANDIDATES = Object.freeze([
  'dataService', 'DataService', 'fredDataService', 'FredDataService', 'webfredDataService', 'WebFredDataService',
  'ExamService', 'examService', 'ExamState', 'examState', 'ExamDataService', 'examDataService',
  'BlockService', 'blockService', 'NavigationService', 'navigationService', 'navService', 'nav',
  'ItemService', 'itemService', 'CurrentItemService', 'currentItemService', 'ItemResponseService',
  'ResponseService', 'responseService', 'AnswerService', 'answerService', 'answersService',
  'ContentService', 'contentService', 'MedleyService', 'medleyService', 'ConfigService',
  'configService', 'ConfigurationService', 'configurationService', 'SessionService',
  'sessionService', 'examStatus', 'itemStatus', 'scores', 'scoreService', '$state', '$stateParams', '$rootScope', '$location',
]);

const launchPagePattern = new RegExp(SCRIPT.URL_PATTERNS.LAUNCH_PAGE, 'i');
const webfredPagePattern = new RegExp(SCRIPT.URL_PATTERNS.WEBFRED_PAGE, 'i');

export {
  SCRIPT,
  STORAGE_KEYS,
  DB_SCHEMA,
  ATTEMPT_STATUS,
  EXPORT_TYPES,
  FULL_BACKUP_WARNING,
  DEFAULT_SETTINGS,
  PAGE_KIND,
  WEBFRED_ADAPTER_STATUS,
  WEBFRED_STATE_SOURCE,
  WEBFRED_ADAPTER_CONFIG,
  ANSWER_KEY_CAPTURE_STATUS,
  TRACKING_ENGINE_STATUS,
  TRACKING_ENGINE_CONFIG,
  WEBFRED_ANGULAR_SERVICE_CANDIDATES,
  launchPagePattern,
  webfredPagePattern,
};
