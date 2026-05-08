import assert from 'node:assert/strict';
import { buildQBankSnapshotsFromSessionData, createQBankCacheAttemptId, isQuestionBlockDefinition, QBANK_CACHE_ATTEMPT_PREFIX } from '../src/qbank/cache-controller.js';
import { loadQBankCaptureContext, resolveQBankCaptureForItems, loadQBankSnapshotsForAttempt } from '../src/qbank/cache-lookup.js';
import { fetchResourceDataByUrl } from '../src/media/resource-cache.js';
import { formatQBankStorageStatus, summarizeQBankCaptureStorage } from '../src/ui/launch-history.js';
import { el } from './test-utils/fake-dom.mjs';

assert.equal(QBANK_CACHE_ATTEMPT_PREFIX, 'qbank-cache');
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 1 Block 1' }), true);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 3 FIP Drug Ad Block 2' }), true);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 1 Tutorial' }), false);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 2 All Blocks' }), false);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 3 CCS Tutorial' }), false);
assert.equal(isQuestionBlockDefinition({ displayName: 'Step 3 Case 6' }), false);
assert.equal(createQBankCacheAttemptId({
  program: 'USMLE',
  examName: 'STPF1',
  testDefinitionName: 'STPF1C0137',
}), 'qbank-cache:USMLE:STPF1:STPF1C0137');

const qbankStorageSummary = summarizeQBankCaptureStorage([
  Object.freeze({
    id: 'qbank-cache:USMLE:STPF1:STPF1C0137',
    status: 'completed',
    reviewReady: true,
    questionIds: Object.freeze(['cache-q1', 'cache-q2']),
    questionCount: 2,
    correctAnswers: Object.freeze({ 'cache-q1': 'A', 'cache-q2': 'B' }),
    source: Object.freeze({ cacheKind: 'qbank' }),
  }),
], [Object.freeze({ program: 'USMLE', examName: 'STPF1', testDefinitionName: 'STPF1C0137' })]);
assert.equal(qbankStorageSummary.complete, true);
assert.equal(qbankStorageSummary.completeCount, 1);
assert.equal(qbankStorageSummary.expectedCount, 1);
assert.equal(qbankStorageSummary.storedQuestions, 2);
assert.equal(qbankStorageSummary.knownAnswers, 2);
assert.equal(formatQBankStorageStatus(qbankStorageSummary), 'Complete');
const incompleteQBankStorageSummary = summarizeQBankCaptureStorage([
  Object.freeze({
    id: 'qbank-cache:USMLE:STPF1:STPF1C0137',
    status: 'completed',
    reviewReady: true,
    questionIds: Object.freeze(['cache-q1', 'cache-q2']),
    questionCount: 2,
    correctAnswers: Object.freeze({ 'cache-q1': 'A' }),
    source: Object.freeze({ cacheKind: 'qbank' }),
  }),
], [Object.freeze({ program: 'USMLE', examName: 'STPF1', testDefinitionName: 'STPF1C0137' })]);
assert.equal(incompleteQBankStorageSummary.complete, false);
assert.equal(formatQBankStorageStatus(incompleteQBankStorageSummary), 'Incomplete');

const qbankMediaFragment = el('div', { class: 'NBSinglePage' }, [el('div', { id: 'item1' }, [
  el('div', { class: 'NBMediaPlayer' }, [el('div', { class: 'media-player', filename: '097247.mediaGallery', 'data-media-id': '097247' }, [])]),
  el('div', { class: 'NBExposition' }, ['Media stem']),
  el('div', { id: 'COMP-MEDIA_div', class: 'NBOptionListComp answerbox' }, [el('ol', { class: 'options' }, [
    el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'COMP-MEDIA', value: 'A' }), el('span', {}, ['A'])]),
    el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'COMP-MEDIA', value: 'B' }), el('span', {}, ['B'])]),
  ]), el('fred-show-answer', { ans: 'B' }, [])]),
])]);
const qbankMediaDocument = {
  cookie: 'nbme.webfred.exam.session=previous-session',
  createElement() {
    return { content: qbankMediaFragment, set innerHTML(_value) {}, get innerHTML() { return ''; } };
  },
};
const qbankMediaFetchCalls = [];
const qbankMediaWindow = Object.freeze({
  document: qbankMediaDocument,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  fetch: async (url, options = {}) => {
    const textUrl = String(url);
    qbankMediaFetchCalls.push(Object.freeze({ url: textUrl, cache: options && options.cache || '' }));
    if (textUrl.includes('/webfred/api/metadata/097247')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ hotspotConfig: [
          { label: 'Aortic', shape: 'circle', coords: '10,10,5', contentMedia: { src: 'api/Resource?name=synthetic-aortic.webm' }, diagramMedia: { src: 'api/Resource?name=synthetic.jpg' } },
          { label: 'Mitral', shape: 'circle', coords: '20,20,5', contentMedia: { src: 'api/Resource?name=synthetic.webm' }, diagramMedia: { src: 'api/Resource?name=synthetic.jpg' } },
        ] }] }),
      };
    }
    if (textUrl.includes('synthetic.jpg')) {
      return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg'], ['content-length', '3']]), arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    }
    if (textUrl.includes('synthetic-aortic.webm')) {
      return { ok: true, status: 200, headers: new Map([['content-type', 'video/webm'], ['content-length', '3']]), arrayBuffer: async () => Uint8Array.from([7, 8, 9]).buffer };
    }
    if (textUrl.includes('synthetic.webm')) {
      return { ok: true, status: 200, headers: new Map([['content-type', 'video/webm'], ['content-length', '3']]), arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer };
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  },
});
const qbankMediaCapture = await buildQBankSnapshotsFromSessionData(qbankMediaWindow, qbankMediaDocument, {
  program: 'USMLE',
  examName: 'STPF1',
  testDefinitionName: 'STPF1C0139',
  testDefinitionDisplayName: 'Step 1 Block 3',
  blockNumber: 3,
}, {
  examBlock: { medleys: [Object.freeze({ medleyId: 'MED-MEDIA', items: [Object.freeze({ componentId: 'COMP-MEDIA', answerable: true })] })] },
}, {
  'MED-MEDIA': '<synthetic media html>',
}, 'synthetic-session');
assert.equal(qbankMediaCapture.snapshots.length, 1);
assert.ok(qbankMediaCapture.snapshots[0].resourceUrls.includes('api/Resource?name=synthetic.webm'), 'qbank media metadata resources captured');
assert.ok(qbankMediaCapture.snapshots[0].resourceUrls.includes('api/Resource?name=synthetic-aortic.webm'), 'qbank hotspot media resources captured');
assert.ok(qbankMediaCapture.snapshots[0].resourceDataByUrl['https://orientation.nbme.org/webfred/api/Resource?name=synthetic.webm'], 'qbank media video cached as data URL');
assert.ok(qbankMediaCapture.snapshots[0].resourceDataByUrl['https://orientation.nbme.org/webfred/api/Resource?name=synthetic-aortic.webm'], 'qbank hotspot media video cached as data URL');
assert.ok(qbankMediaCapture.snapshots[0].resourceDataByUrl['https://orientation.nbme.org/webfred/api/Resource?name=synthetic.jpg'], 'qbank media image cached as data URL');
assert.equal(qbankMediaCapture.snapshots[0].metadata.mediaInteractions.length >= 2, true, 'qbank media hotspot interactions captured');
const aorticInteraction = qbankMediaCapture.snapshots[0].metadata.mediaInteractions.find((entry) => entry.label === 'Aortic');
assert.ok(aorticInteraction, 'qbank media hotspot label captured');
assert.equal(aorticInteraction.coords, '10,10,5');
assert.ok(qbankMediaFetchCalls.some((call) => call.url.includes('synthetic.webm') && call.cache === 'no-store'), 'qbank resource capture bypasses stale browser cache');
assert.ok(qbankMediaFetchCalls.some((call) => call.url.includes('synthetic.jpg') && call.cache === 'no-store'), 'qbank image capture bypasses stale browser cache');
assert.ok(qbankMediaDocument.cookie.startsWith('nbme.webfred.exam.session=previous-session'), 'qbank capture restores prior active WebFRED session cookie after resource fetch');
const cacheRetryCalls = [];
const cacheRetryDocument = { cookie: '' };
const cacheRetryWindow = Object.freeze({
  document: cacheRetryDocument,
  location: Object.freeze({ href: 'https://orientation.nbme.org/webfred/#!/main' }),
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  fetch: async (url, options = {}) => {
    cacheRetryCalls.push(Object.freeze({ url: String(url), cache: options && options.cache || '', cookie: cacheRetryDocument.cookie }));
    if ((options && options.cache) === 'no-store') {
      return { ok: false, status: 404, headers: new Map() };
    }
    if ((options && options.cache) === 'reload') {
      return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg'], ['content-length', '2']]), arrayBuffer: async () => Uint8Array.from([7, 8]).buffer };
    }
    throw new Error('expected cache retry mode');
  },
});
const cacheRetryData = await fetchResourceDataByUrl(cacheRetryWindow, ['api/Resource?name=stale-cache.jpg'], { baseUrl: 'https://orientation.nbme.org/webfred/', cache: 'no-store', sessionId: 'session-for-resource' });
assert.ok(cacheRetryData['https://orientation.nbme.org/webfred/api/Resource?name=stale-cache.jpg'], 'resource capture retries after stale 404 cache entry');
assert.deepEqual(cacheRetryCalls.map((call) => call.cache), ['no-store', 'reload']);
assert.ok(cacheRetryCalls.every((call) => call.cookie.startsWith('nbme.webfred.exam.session=session-for-resource')), 'resource fetch binds WebFRED session cookie while reading protected assets');
assert.ok(cacheRetryDocument.cookie.startsWith('nbme.webfred.exam.session='), 'temporary WebFRED session cookie removed after resource capture');
assert.ok(cacheRetryDocument.cookie.includes('Max-Age=0'), 'temporary WebFRED session cookie expires after resource capture');

const qbankAttempt = Object.freeze({
  id: 'qbank-cache:USMLE:STPF1:Block1',
  correctAnswers: Object.freeze({ 'webfred:USMLE:STPF1:MED1:COMP1': 'A' }),
  source: Object.freeze({ cacheKind: 'qbank' }),
});
const qbankSnapshot = Object.freeze({
  id: 'qbank-snapshot-1',
  attemptId: qbankAttempt.id,
  questionId: 'webfred:USMLE:STPF1:MED1:COMP1',
  blockNumber: 1,
  itemIndex: 1,
  correctAnswerId: 'A',
  renderedHtml: '<div id="item1"><ol class="options"></ol></div>',
  metadata: Object.freeze({ componentId: 'COMP1', medleyId: 'MED1' }),
});
const qbankStorage = Object.freeze({
  async listAttempts() { return [qbankAttempt]; },
  async listQuestionSnapshots() { return [qbankSnapshot]; },
});
const context = await loadQBankCaptureContext(qbankStorage);
assert.equal(context.available, true);
const capture = resolveQBankCaptureForItems(context, {
  itemList: [Object.freeze({ questionId: 'live-q1', componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 })],
  expectedCount: 1,
});
assert.deepEqual(capture.correctAnswers, { 'live-q1': 'A' });
assert.equal(capture.summary.source, 'qbank-cache');
assert.equal(capture.source.matchSourcesByQuestionId['live-q1'], 'component-medley');
const blockTwoCapture = resolveQBankCaptureForItems(context, {
  itemList: [Object.freeze({ questionId: 'live-b2-q1', componentId: 'COMP1', medleyId: 'MED1', blockNumber: 2, itemIndex: 1 })],
  expectedCount: 1,
});
assert.deepEqual(blockTwoCapture.correctAnswers, {}, 'qbank component matches stay block-scoped');
const staleScopeLiveBlockCapture = resolveQBankCaptureForItems(context, {
  launchedScope: Object.freeze({ block: '1', testDefinitionDisplayName: 'Step 1 Block 1' }),
  itemList: [Object.freeze({ questionId: 'live-b5-q1', componentId: 'COMP1', medleyId: 'MED1', blockNumber: 5, itemIndex: 1 })],
  expectedCount: 1,
});
assert.deepEqual(staleScopeLiveBlockCapture.correctAnswers, {}, 'live item block does not fall back to stale launched-scope block keys');
const qbankSnapshots = await loadQBankSnapshotsForAttempt(qbankStorage, {
  questionIds: ['live-q1'],
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({ 'live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }) }) }),
});
assert.equal(qbankSnapshots.length, 1);
assert.equal(qbankSnapshots[0].questionId, 'live-q1');
assert.equal(qbankSnapshots[0].metadata.qbankCacheOriginalQuestionId, qbankSnapshot.questionId);
const metadataOnlyScopeCapture = resolveQBankCaptureForItems(context, {
  attempt: Object.freeze({
    launchedScope: Object.freeze({ mode: 'test', block: '1' }),
    questionIds: Object.freeze(['legacy-live-q1']),
    source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({
      'legacy-live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 9, itemIndex: 1 }),
    }) }),
  }),
  questionIds: ['legacy-live-q1'],
  expectedCount: 1,
});
assert.deepEqual(metadataOnlyScopeCapture.correctAnswers, { 'legacy-live-q1': 'A' }, 'launched scope block repairs stale item metadata at endExam');
assert.equal(metadataOnlyScopeCapture.source.matchSourcesByQuestionId['legacy-live-q1'], 'component-medley');
const metadataOnlyScopeSnapshots = await loadQBankSnapshotsForAttempt(qbankStorage, {
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze(['legacy-live-q1']),
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({
    'legacy-live-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 9, itemIndex: 1 }),
  }) }),
}, []);
assert.equal(metadataOnlyScopeSnapshots.length, 1, 'review qbank fallback uses launched scope block when stored metadata drifted');
assert.equal(metadataOnlyScopeSnapshots[0].questionId, 'legacy-live-q1');

const staleReviewBlockQBankStorage = Object.freeze({
  async listAttempts() {
    return [
      Object.freeze({ id: 'qbank-cache:USMLE:STPF1:StaleBlock1', correctAnswers: Object.freeze({ 'qbank-stale-b1': 'A' }), source: Object.freeze({ cacheKind: 'qbank' }) }),
      Object.freeze({ id: 'qbank-cache:USMLE:STPF1:ActualBlock3', correctAnswers: Object.freeze({ 'qbank-actual-b3': 'C' }), source: Object.freeze({ cacheKind: 'qbank' }) }),
    ];
  },
  async listQuestionSnapshots(attemptId) {
    if (attemptId.endsWith('StaleBlock1')) {
      return [Object.freeze({
        id: 'qbank-stale-review-b1-snapshot',
        attemptId,
        questionId: 'qbank-stale-b1',
        blockNumber: 1,
        itemIndex: 1,
        correctAnswerId: 'A',
        renderedHtml: '<div id="stale-b1"><ol class="options"></ol></div>',
        metadata: Object.freeze({ componentId: 'COMP-STUCK', medleyId: 'MED-STUCK', blockNumber: 1, itemIndex: 1 }),
      })];
    }
    return [Object.freeze({
      id: 'qbank-stale-review-b3-snapshot',
      attemptId,
      questionId: 'qbank-actual-b3',
      blockNumber: 3,
      itemIndex: 1,
      correctAnswerId: 'C',
      renderedHtml: '<div id="actual-b3"><ol class="options"></ol></div>',
      metadata: Object.freeze({ componentId: 'COMP-STUCK', medleyId: 'MED-STUCK', blockNumber: 3, itemIndex: 1 }),
    })];
  },
});
const staleReviewBlockSnapshots = await loadQBankSnapshotsForAttempt(staleReviewBlockQBankStorage, {
  id: 'attempt-stale-launched-scope-review-block-three',
  launchedScope: Object.freeze({ mode: 'test', block: '1', testDefinitionDisplayName: 'Step 1 Block 1' }),
  questionIds: Object.freeze(['live-actual-b3-q1']),
  questionCount: 1,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 3, itemCount: 1, label: 'Block 3' })]),
  source: Object.freeze({
    progress: Object.freeze({ byBlock: Object.freeze({ 3: Object.freeze({ blockNumber: 3, total: 1, questionIds: Object.freeze(['live-actual-b3-q1']) }) }) }),
    itemMetadataByQuestionId: Object.freeze({
      'live-actual-b3-q1': Object.freeze({ componentId: 'COMP-STUCK', medleyId: 'MED-STUCK', blockNumber: 3, itemIndex: 1 }),
    }),
  }),
}, []);
assert.equal(staleReviewBlockSnapshots.length, 1);
assert.equal(staleReviewBlockSnapshots[0].correctAnswerId, 'C', 'review qbank fallback trusts recorded block over stale launched scope');
assert.equal(staleReviewBlockSnapshots[0].blockNumber, 3);

const staleQuestionIdBlockStorage = Object.freeze({
  async listAttempts() {
    return [Object.freeze({
      id: 'qbank-cache:USMLE:StaleIds:AllBlocks',
      correctAnswers: Object.freeze({
        'webfred:USMLE:Block-1:MED-SAME:COMP-SAME': 'A',
        'webfred:USMLE:Block-4:MED-SAME:COMP-SAME': 'D',
      }),
      source: Object.freeze({ cacheKind: 'qbank' }),
    })];
  },
  async listQuestionSnapshots() {
    return [
      Object.freeze({
        id: 'qbank-stale-id-b1',
        attemptId: 'qbank-cache:USMLE:StaleIds:AllBlocks',
        questionId: 'webfred:USMLE:Block-1:MED-SAME:COMP-SAME',
        blockNumber: 1,
        itemIndex: 1,
        correctAnswerId: 'A',
        renderedHtml: '<div id="qid-b1"><ol class="options"></ol></div>',
        metadata: Object.freeze({ componentId: 'COMP-SAME', medleyId: 'MED-SAME', blockNumber: 1, itemIndex: 1 }),
      }),
      Object.freeze({
        id: 'qbank-stale-id-b4',
        attemptId: 'qbank-cache:USMLE:StaleIds:AllBlocks',
        questionId: 'webfred:USMLE:Block-4:MED-SAME:COMP-SAME',
        blockNumber: 4,
        itemIndex: 1,
        correctAnswerId: 'D',
        renderedHtml: '<div id="qid-b4"><ol class="options"></ol></div>',
        metadata: Object.freeze({ componentId: 'COMP-SAME', medleyId: 'MED-SAME', blockNumber: 4, itemIndex: 1 }),
      }),
    ];
  },
});
const staleQuestionIdBlockSnapshots = await loadQBankSnapshotsForAttempt(staleQuestionIdBlockStorage, {
  id: 'attempt-stale-question-id-block-four',
  launchedScope: Object.freeze({ mode: 'test', block: '4', testDefinitionDisplayName: 'Step 1 Block 4' }),
  questionIds: Object.freeze(['webfred:USMLE:Block-1:MED-SAME:COMP-SAME']),
  questionCount: 1,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 4, itemCount: 1, label: 'Block 4' })]),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze({
      'webfred:USMLE:Block-1:MED-SAME:COMP-SAME': Object.freeze({ componentId: 'COMP-SAME', medleyId: 'MED-SAME', blockNumber: 4, itemIndex: 1 }),
    }),
  }),
}, []);
assert.equal(staleQuestionIdBlockSnapshots.length, 1);
assert.equal(staleQuestionIdBlockSnapshots[0].correctAnswerId, 'D', 'qbank fallback ignores stale Block-1 question id when metadata says Block 4');
assert.equal(staleQuestionIdBlockSnapshots[0].questionId, 'webfred:USMLE:Block-1:MED-SAME:COMP-SAME', 'snapshot still attaches to live stale question id');
assert.equal(staleQuestionIdBlockSnapshots[0].metadata.qbankCacheOriginalQuestionId, 'webfred:USMLE:Block-4:MED-SAME:COMP-SAME');

const qbankLegacyUnscopedAttempt = Object.freeze({
  id: 'qbank-cache:USMLE:LegacyUnscoped:Block1',
  correctAnswers: Object.freeze({ 'webfred:USMLE:Block-1:LEGACY-MED:LEGACY-COMP': 'B' }),
  source: Object.freeze({ cacheKind: 'qbank' }),
});
const qbankLegacyUnscopedStorage = Object.freeze({
  async listAttempts() { return [qbankLegacyUnscopedAttempt]; },
  async listQuestionSnapshots() {
    return [Object.freeze({
      id: 'qbank-legacy-unscoped-b1',
      attemptId: qbankLegacyUnscopedAttempt.id,
      questionId: 'webfred:USMLE:Block-1:LEGACY-MED:LEGACY-COMP',
      blockNumber: 1,
      itemIndex: 7,
      correctAnswerId: 'B',
      renderedHtml: '<div id="legacy-unscoped"><ol class="options"></ol></div>',
      metadata: Object.freeze({ componentId: 'LEGACY-COMP', medleyId: 'LEGACY-MED', blockNumber: 1, itemIndex: 7 }),
    })];
  },
});
const qbankLegacyUnscopedSnapshots = await loadQBankSnapshotsForAttempt(qbankLegacyUnscopedStorage, {
  id: 'attempt-legacy-unscoped-block-six',
  launchedScope: Object.freeze({ mode: 'test', block: '6', testDefinitionDisplayName: 'Step 1 Block 6' }),
  questionIds: Object.freeze(['webfred:USMLE:Block-6:LEGACY-MED:LEGACY-COMP']),
  questionCount: 40,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 6, itemCount: 40, label: 'Block 6' })]),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze({
      'webfred:USMLE:Block-6:LEGACY-MED:LEGACY-COMP': Object.freeze({ componentId: 'LEGACY-COMP', medleyId: 'LEGACY-MED', blockNumber: 6, itemIndex: 7 }),
    }),
  }),
}, []);
assert.equal(qbankLegacyUnscopedSnapshots.length, 1, 'review qbank fallback can reuse unique component snapshot when cache has old block scope');
assert.equal(qbankLegacyUnscopedSnapshots[0].questionId, 'webfred:USMLE:Block-6:LEGACY-MED:LEGACY-COMP');
assert.equal(qbankLegacyUnscopedSnapshots[0].blockNumber, 6, 'unscoped fallback rebases cloned snapshot to live block');
assert.equal(qbankLegacyUnscopedSnapshots[0].itemIndex, 7);
assert.equal(qbankLegacyUnscopedSnapshots[0].metadata.qbankCacheOriginalBlockNumber, 1);
assert.equal(qbankLegacyUnscopedSnapshots[0].metadata.qbankCacheMatchSource, 'component-medley-unscoped-block-mismatch');

const shiftedQBankAttempt = Object.freeze({
  id: 'qbank-cache:USMLE:STPF1:ShiftedBlock1',
  correctAnswers: Object.freeze({
    'webfred:USMLE:STPF1:Block-1:MED1:COMP1': 'A',
    'webfred:USMLE:STPF1:Block-1:MED1:COMP2': 'B',
    'webfred:USMLE:STPF1:Block-1:MED1:COMP3': 'C',
  }),
  source: Object.freeze({ cacheKind: 'qbank' }),
});
const shiftedQBankSnapshots = [1, 2, 3].map((itemIndex) => Object.freeze({
  id: `qbank-shifted-snapshot-${itemIndex}`,
  attemptId: shiftedQBankAttempt.id,
  questionId: `webfred:USMLE:STPF1:Block-1:MED1:COMP${itemIndex}`,
  blockNumber: 1,
  itemIndex,
  correctAnswerId: ['A', 'B', 'C'][itemIndex - 1],
  renderedHtml: `<div id="item${itemIndex}"><div class="NBExposition">Q${itemIndex}</div><ol class="options"></ol></div>`,
  metadata: Object.freeze({ componentId: `COMP${itemIndex}`, medleyId: 'MED1', blockNumber: 1, itemIndex }),
}));
const shiftedQBankStorage = Object.freeze({
  async listAttempts() { return [shiftedQBankAttempt]; },
  async listQuestionSnapshots() { return shiftedQBankSnapshots; },
});
const shiftedLiveSnapshots = await loadQBankSnapshotsForAttempt(shiftedQBankStorage, {
  id: 'attempt-shifted-live-review',
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze([
    'webfred:USMLE:STPF1:Block-1:MED1:COMP2',
    'webfred:USMLE:STPF1:Block-1:MED1:COMP3',
  ]),
  questionCount: 3,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 3 })]),
  source: Object.freeze({ itemMetadataByQuestionId: Object.freeze({
    'webfred:USMLE:STPF1:Block-1:MED1:COMP2': Object.freeze({ componentId: 'COMP2', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }),
    'webfred:USMLE:STPF1:Block-1:MED1:COMP3': Object.freeze({ componentId: 'COMP3', medleyId: 'MED1', blockNumber: 1, itemIndex: 2 }),
  }) }),
}, []);
assert.deepEqual(shiftedLiveSnapshots.slice().sort((left, right) => left.itemIndex - right.itemIndex).map((snapshot) => snapshot.correctAnswerId), ['A', 'B', 'C'], 'qbank review fallback backfills skipped first item and preserves original positions');
assert.match(shiftedLiveSnapshots.find((snapshot) => snapshot.itemIndex === 1).questionId, /^webfred:review-missing:/);
assert.equal(shiftedLiveSnapshots.find((snapshot) => snapshot.correctAnswerId === 'B').itemIndex, 2);

console.log('qbank cache tests passed');
