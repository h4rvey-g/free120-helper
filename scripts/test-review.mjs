import assert from 'node:assert/strict';
import { buildReviewHtml, isQBankCacheAttempt, loadQBankFallbackSnapshots, openReviewTab } from '../src/review/blob-builder.js';
import { buildReviewModel } from '../src/review/model.js';
import { ATTEMPT_STATUS } from '../src/core/constants.js';
import { canOpenReviewFromHistory, formatHistoryAttemptRow, IMPORT_REPLACE_WARNING } from '../src/ui/launch-history.js';

const attempt = Object.freeze({
  id: 'attempt-review-test',
  status: ATTEMPT_STATUS.COMPLETED,
  startedAt: '2026-05-04T12:00:00.000Z',
  completedAt: '2026-05-04T13:00:00.000Z',
  questionIds: ['q1', 'q2', 'q3'],
  questionCount: 3,
  responses: Object.freeze({ q1: 'A', q2: 'B' }),
  correctAnswers: Object.freeze({ q1: 'A', q2: 'C' }),
  markedQuestionIds: Object.freeze(['q2']),
  timingByQuestionId: Object.freeze({
    q1: Object.freeze({ totalMs: 65000, blockNumber: 1, itemIndex: 1 }),
    q2: Object.freeze({ totalMs: 125000, blockNumber: 1, itemIndex: 2 }),
  }),
  answerTimeline: Object.freeze([
    Object.freeze({ questionId: 'q2', fromAnswerId: '', toAnswerId: 'B', changedAt: '2026-05-04T12:05:00.000Z' }),
  ]),
  notesByQuestionId: Object.freeze({ q2: 'review note' }),
  annotationsByQuestionId: Object.freeze({
    q2: Object.freeze({ highlights: [Object.freeze({ text: 'highlighted clue' })], strikeouts: [Object.freeze({ text: 'bad distractor' })] }),
  }),
});

const snapshots = Object.freeze([
  Object.freeze({
    attemptId: attempt.id,
    questionId: 'q1',
    blockNumber: 1,
    itemIndex: 1,
    renderedHtml: '<div id="item1"><div class="NBExposition">Synthetic stem</div><div id="q1_div" class="NBOptionListComp answerbox"><form><ol class="options"><li class="stContext"><input class="NBOptionInput" type="radio" value="A"><span>Option A</span></li><li class="stContext"><input class="NBOptionInput" type="radio" value="B"><span>Option B</span></li></ol></form></div><div class="proceedContainer" ng-show="exam.currItem.index != exam.items.length - 1"><button class="button-blue" tabindex="-1" disabled="" aria-disabled="true">{{ ::localize(\'proceedToNext\') }}</button></div><button class="button-red exit-media-player" ng-show="fred.zoomMedia == \'zoomed-media-player\'" ng-mouseup="fred.zoomMedia = \'\'">X</button><button class="button-red full-media-player" ng-mouseup="fred.zoomMedia = \'zoomed-media-player\'">{{ ::localize(\'viewFullScreen\') }}</button></div>',
    choices: Object.freeze([
      Object.freeze({ id: 'A', label: 'Option A', index: 1 }),
      Object.freeze({ id: 'B', label: 'Option B', index: 2 }),
    ]),
    snapshot: Object.freeze({
      webfredShell: Object.freeze({
        title: 'Synthetic WebFRED',
        itemShellHtml: '<section id="item"><article id="content"><div id="medley"></div></article></section>',
      }),
    }),
  }),
  Object.freeze({
    attemptId: attempt.id,
    questionId: 'q2',
    blockNumber: 1,
    itemIndex: 2,
    renderedHtml: '<div id="item2"><div class="NBExposition">Synthetic stem 2</div><div id="q2_div" class="NBOptionListComp answerbox"><form><ol class="options"><li class="stContext"><input class="NBOptionInput" type="radio" value="B"><span>Option B</span></li><li class="stContext"><input class="NBOptionInput" type="radio" value="C"><span>Option C</span></li></ol></form></div></div>',
    choices: Object.freeze([
      Object.freeze({ id: 'B', label: 'Option B', index: 1 }),
      Object.freeze({ id: 'C', label: 'Option C', index: 2 }),
    ]),
  }),
]);

const model = buildReviewModel(attempt, snapshots);
const byQuestionId = new Map(model.questions.map((question) => [question.questionId, question]));
assert.equal(model.questions.length, 3, 'model includes scored questions without snapshots');
assert.equal(byQuestionId.get('q1').status, 'correct');
assert.equal(byQuestionId.get('q2').status, 'incorrect');
assert.equal(byQuestionId.get('q3').status, 'omitted');
assert.equal(byQuestionId.get('q2').marked, true);
assert.equal(byQuestionId.get('q2').timingMs, 125000);
assert.equal(byQuestionId.get('q2').notes, 'review note');
assert.equal(byQuestionId.get('q2').annotations.highlights.length, 1);

const html = buildReviewHtml(attempt, snapshots);
assert.match(html, /ol#leftnav/);
assert.match(html, /f120-review-nav-status/);
assert.match(html, /f120-review-option-status/);
assert.match(html, /f120-review-time-spent/);
assert.match(html, /ol\.options > li\.stContext/);
assert.match(html, /div\[id\$="_div"\]\.NBOptionListComp\.answerbox/);
assert.match(html, /f120-review-block-filter/);
assert.match(html, /Score summary/);
assert.match(html, /<div class="f120-review-current-header">[\s\S]*id="f120-review-current-label"[\s\S]*<div class="f120-review-question-nav"[\s\S]*id="f120-review-prev"[\s\S]*id="f120-review-next"[\s\S]*id="f120-review-current-status"/, 'previous/next controls render in the current question header');
const toolbarControlsHtml = html.match(/<div class="f120-review-controls"[\s\S]*?<\/div>/)?.[0] || '';
assert.doesNotMatch(toolbarControlsHtml, /f120-review-(prev|next)/, 'previous/next controls are not in the top toolbar');
assert.match(html, /function getNavScrollContainer/, 'review runtime can identify the scrollable left nav container');
assert.match(html, /restoreScrollPosition\(scrollContainer, previousScroll\)/, 'review nav preserves left-nav scroll position across item selection renders');
assert.match(html, /<base href="https:\/\/orientation\.nbme\.org\/webfred\/">/);
assert.match(html, /media-src 'self' data:/);
assert.match(html, /function normalizeSnapshotMedia/);
assert.match(html, /preload', 'none'/);
assert.match(html, /function applyCachedResourceData/);
assert.match(html, /function organizeReviewImages/, 'review runtime moves image previews below the stem and above answer options');
assert.match(html, /function shouldSkipReviewImageOptimization/, 'review runtime skips image optimization for auscultation/hotspot media so click points stay aligned');
assert.match(html, /getSnapshotMediaInteractions\(question\)\.length/, 'review runtime detects auscultation media interactions before moving images');
assert.match(html, /f120-review-hotspot-diagram/, 'review runtime protects hotspot diagrams from thumbnail relocation');
assert.match(html, /function openReviewImageDialog/, 'review runtime supports click-to-enlarge image previews');
assert.match(html, /f120-review-image-strip/, 'review page styles include compact image preview strip');
assert.match(html, /f120-review-image-dialog/, 'review page styles include enlarged image dialog');
assert.match(html, /max-width: 240px/, 'review image thumbnails start at a compact size');
assert.match(html, /function getDirectOptionText/, 'review runtime reads direct answer text without duplicating nested choice letters');
assert.match(html, /function normalizeReviewOptionRow/, 'review runtime normalizes answer choices into one-line letter and text rows');
assert.match(html, /replaceChildren\(row, \[label\]\)/, 'review runtime removes disabled original answer inputs from normalized rows');
assert.match(html, /function removeOptionNumericPrefixes/, 'review runtime removes ordered-list numeric prefixes from answer choices');
assert.match(html, /f120-review-options-list/, 'review page styles suppress numeric answer choice list markers');
assert.match(html, /f120-review-option-label/, 'review page styles keep answer letter and text on one line');
assert.match(html, /function applyQuestionHighlights/, 'review runtime applies captured highlights back onto question content');
assert.match(html, /function findCollapsedTextRanges/, 'review runtime can find every repeated occurrence of highlighted text');
assert.match(html, /function wrapTextNodeHighlights/, 'review runtime can apply multiple inline highlights in one text node');
assert.match(html, /f120-review-text-highlight/, 'review page styles include inline yellow highlight marks');
assert.doesNotMatch(html, /appendDetail\(details, 'Highlights'/, 'question detail pane does not list highlights separately');
assert.doesNotMatch(html, /compact\.appendChild\(el\('strong', \{ text: 'Highlights'/, 'compact side pane does not duplicate highlight text');
assert.match(html, /#medley \.NBExposition[\s\S]*max-width: 820px/, 'review page styles constrain question stem line length for readability');
assert.match(html, /#medley \.NBExposition[\s\S]*line-height: 1\.58/, 'review page styles improve question stem line spacing');
assert.match(html, /#medley \.NBExposition[\s\S]*font-size: 16px/, 'review page styles keep question stem font size aligned with options');
assert.match(html, /#medley ol\.options\.f120-review-options-list[\s\S]*max-width: 820px/, 'review page styles align answer options with readable stem width');
assert.match(html, /function isTableOptionRow/, 'review runtime detects table-form answer choices');
assert.match(html, /#medley tr\.f120-review-option-row \{ display: table-row; \}/, 'review page styles preserve table-form answer choice layout');
assert.match(html, /\.NBOptionTableComp\.answerbox table[\s\S]*border-collapse: collapse/, 'review page styles keep answer option tables readable');
assert.match(html, /function removeExamOnlyProceedControls/, 'review runtime removes exam-only proceed controls from snapshots');
assert.match(html, /\.proceedContainer/, 'review runtime targets stale exam proceed containers');
assert.match(html, /function removeExamOnlyMediaControls/, 'review runtime removes disabled WebFRED media fullscreen/exit buttons from snapshots');
assert.match(html, /\.exit-media-player/, 'review runtime targets stale media exit controls');
assert.match(html, /\.full-media-player/, 'review runtime targets stale media fullscreen controls');
assert.doesNotMatch(html, /fetch\s*\(/);
assert.doesNotMatch(html, /XMLHttpRequest/);

const cachedMediaReviewModel = buildReviewModel(Object.freeze({
  id: 'attempt-cached-media-review',
  status: ATTEMPT_STATUS.COMPLETED,
  questionIds: Object.freeze(['media-q1']),
  questionCount: 1,
  responses: Object.freeze({}),
  correctAnswers: Object.freeze({}),
  launchedScope: Object.freeze({ block: '1' }),
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 1 })]),
}), [Object.freeze({
  attemptId: 'attempt-cached-media-review',
  questionId: 'media-q1',
  blockNumber: 1,
  itemIndex: 1,
  renderedHtml: '<div id="item1"><div class="NBMediaPlayer"><div class="media-player" data-media-id="synthetic"></div></div><img src="api/Resource?name=synthetic.png"><video src="api/Resource?name=synthetic.webm"></video><ol class="options"></ol></div>',
  resourceUrls: Object.freeze(['api/Resource?name=synthetic.png', 'api/Resource?name=synthetic.webm']),
  resourceDataByUrl: Object.freeze({
    'api/Resource?name=synthetic.png': 'data:image/png;base64,AAAA',
    'https://orientation.nbme.org/webfred/api/Resource?name=synthetic.webm': 'data:video/webm;base64,BBBB',
  }),
})]);
assert.equal(cachedMediaReviewModel.questions[0].snapshot.resourceDataByUrl['https://orientation.nbme.org/webfred/api/Resource?name=synthetic.png'], 'data:image/png;base64,AAAA');
const cachedMediaHtml = buildReviewHtml(Object.freeze({
  id: 'attempt-cached-media-review',
  status: ATTEMPT_STATUS.COMPLETED,
  questionIds: Object.freeze(['media-q1']),
  questionCount: 1,
  responses: Object.freeze({}),
  correctAnswers: Object.freeze({}),
  launchedScope: Object.freeze({ block: '1' }),
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 1 })]),
}), [Object.freeze({
  attemptId: 'attempt-cached-media-review',
  questionId: 'media-q1',
  blockNumber: 1,
  itemIndex: 1,
  renderedHtml: '<div id="item1"><div class="NBMediaPlayer"><div class="media-player" data-media-id="synthetic"></div></div><img src="api/Resource?name=synthetic.png"><video src="api/Resource?name=synthetic.webm"></video><ol class="options"></ol></div>',
  resourceUrls: Object.freeze(['api/Resource?name=synthetic.png', 'api/Resource?name=synthetic.webm']),
  resourceDataByUrl: Object.freeze({
    'api/Resource?name=synthetic.png': 'data:image/png;base64,AAAA',
    'https://orientation.nbme.org/webfred/api/Resource?name=synthetic.webm': 'data:video/webm;base64,BBBB',
  }),
})]);
assert.match(cachedMediaHtml, /data:image\/png;base64,AAAA/, 'review embeds cached image data');
assert.match(cachedMediaHtml, /data:video\/webm;base64,BBBB/, 'review embeds cached video data');
assert.match(cachedMediaHtml, /f120-review-native-media-fallback/, 'review runtime can render native media fallback');
assert.match(cachedMediaHtml, /function createInteractiveMediaFallback/, 'review runtime can render interactive media hotspot fallback');
assert.match(cachedMediaHtml, /function removeEmptyMediaPlayerPlaceholders/, 'review runtime removes empty WebFRED media-player placeholders before rendering auscultation fallback');
assert.match(cachedMediaHtml, /removeEmptyMediaPlayerPlaceholders\(container\)/, 'interactive media fallback clears blank media-player placeholders');
assert.match(cachedMediaHtml, /function setMediaSource/, 'review runtime switches cached media sources');
assert.match(cachedMediaHtml, /function playDataUrlAudio/, 'review runtime plays cached media through Web Audio without CSP media loads');
assert.match(cachedMediaHtml, /f120-review-audio-player/, 'review runtime includes CSP-safe audio player');
assert.match(cachedMediaHtml, /f120-review-hotspot-button/, 'review runtime includes media hotspot controls');
assert.match(cachedMediaHtml, /f120-review-hotspot-marker/, 'review runtime includes diagram hotspot markers');

const historyAttempt = Object.freeze({
  ...attempt,
  reviewReady: true,
  examIdentity: Object.freeze({ program: 'Step 1', examName: 'Free 120', section: 'Block 1' }),
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 3 })]),
  scoreSummary: Object.freeze({
    overallScore: Object.freeze({ correct: 2, total: 3, percent: 66.7, label: '2/3' }),
  }),
});
const historyRow = formatHistoryAttemptRow(historyAttempt);
assert.equal(historyRow.exam, 'Step 1 · Free 120 · Block 1');
assert.equal(historyRow.launchedScope, 'test · Block 1');
assert.equal(historyRow.blockCount, '1');
const genericDriverHistoryRow = formatHistoryAttemptRow({
  ...historyAttempt,
  examIdentity: Object.freeze({ program: 'USMLE', examName: 'NBME Exam Driver', section: 'Step 1 Block 2' }),
  launchedScope: Object.freeze({ mode: 'test', block: '2', section: 'Step 1 Block 2' }),
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 2, itemCount: 3, label: 'Step 1 Block 2' })]),
});
assert.equal(genericDriverHistoryRow.exam, 'Step 1 · Block 2');
assert.equal(genericDriverHistoryRow.launchedScope, 'test · Step 1 Block 2');
const allBlocksHistoryRow = formatHistoryAttemptRow({
  ...historyAttempt,
  id: 'attempt-step1-all-blocks',
  questionIds: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
  questionCount: 6,
  examIdentity: Object.freeze({ program: 'USMLE', examName: 'NBME Exam Driver', section: 'Step 1 Block 1' }),
  launchedScope: Object.freeze({ mode: 'all', blockCount: 2, testDefinitionDisplayName: 'Step 1 All Blocks' }),
  blockMetadata: Object.freeze([
    Object.freeze({ blockNumber: 1, itemCount: 3, label: 'Step 1 Block 1' }),
    Object.freeze({ blockNumber: 2, itemCount: 3, label: 'Step 1 Block 2' }),
  ]),
});
assert.equal(allBlocksHistoryRow.exam, 'Step 1 · All Blocks');
const noisyStep2HistoryRow = formatHistoryAttemptRow({
  ...historyAttempt,
  id: 'attempt-noisy-step2-block2',
  examIdentity: Object.freeze({ program: 'Step 2 CK', examName: 'Step NST PF 2 Block 2', section: 'Step 2 Block 2' }),
  launchedScope: Object.freeze({ mode: 'test', block: '2', testDefinitionDisplayName: 'Step 2 CK Step NST PF 2 Block 2', section: 'Step 2 Block 2' }),
  source: Object.freeze({ launchDefinition: Object.freeze({ testDefinitionDisplayName: 'Step 2 Block 2' }) }),
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 2, itemCount: 3, label: 'Step 2 Block 2' })]),
});
assert.equal(noisyStep2HistoryRow.exam, 'Step 2 CK · Block 2');
assert.equal(historyRow.score, '2/3 (66.7%)');
assert.equal(historyRow.status, 'Completed');
assert.equal(historyRow.reviewReady, true);
assert.equal(canOpenReviewFromHistory(historyAttempt), true);
assert.equal(canOpenReviewFromHistory({ ...historyAttempt, status: ATTEMPT_STATUS.IN_PROGRESS, reviewReady: false }), false);
assert.equal(canOpenReviewFromHistory({ id: 'empty-completed', status: ATTEMPT_STATUS.COMPLETED, questionIds: [], questionCount: 0 }), false);
assert.match(IMPORT_REPLACE_WARNING, /overwrites local attempts/);

assert.equal(isQBankCacheAttempt({ id: 'qbank-cache:USMLE:STPF1:STPF1C0137' }), true);
assert.equal(isQBankCacheAttempt({ id: 'attempt-normal' }), false);
const fallbackAttempt = Object.freeze({
  id: 'attempt-with-missing-snapshot',
  questionIds: Object.freeze(['real-q1']),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze({
      'real-q1': Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }),
    }),
  }),
});
const fallbackSnapshots = await loadQBankFallbackSnapshots({
  async listAttempts() {
    return [Object.freeze({ id: 'qbank-cache:USMLE:STPF1:STPF1C0137' })];
  },
  async listQuestionSnapshots() {
    return [Object.freeze({
      id: 'qbank-snapshot-1',
      attemptId: 'qbank-cache:USMLE:STPF1:STPF1C0137',
      questionId: 'qbank-q1',
      renderedHtml: '<div id="item1"><ol class="options"></ol></div>',
      blockNumber: 1,
      itemIndex: 1,
      metadata: Object.freeze({ componentId: 'COMP1', medleyId: 'MED1', blockNumber: 1, itemIndex: 1 }),
    })];
  },
}, fallbackAttempt, []);
assert.equal(fallbackSnapshots.length, 1);
assert.equal(fallbackSnapshots[0].questionId, 'real-q1');
assert.equal(fallbackSnapshots[0].metadata.qbankFallbackOriginalQuestionId, 'qbank-q1');
const fallbackKeyModel = buildReviewModel({
  id: 'attempt-fallback-key',
  questionIds: ['q-fallback'],
  responses: { 'q-fallback': 'A' },
  scoreSummary: {
    questionResults: [Object.freeze({ questionId: 'q-fallback', selectedAnswerId: 'A', status: 'unknown' })],
  },
}, [Object.freeze({ questionId: 'q-fallback', correctAnswerId: 'A' })]);
assert.equal(fallbackKeyModel.questions[0].status, 'correct');

const explicitEmptyResponseModel = buildReviewModel(Object.freeze({
  id: 'attempt-explicit-empty-response',
  questionIds: Object.freeze(['empty-response-q1']),
  questionCount: 1,
  responses: Object.freeze({ 'empty-response-q1': '' }),
  correctAnswers: Object.freeze({ 'empty-response-q1': 'B' }),
  source: Object.freeze({
    responseAliases: Object.freeze({
      byPosition: Object.freeze({ '1\u00001': 'A' }),
      byComponent: Object.freeze({ '1\u0000empty-medley\u0000empty-component': 'A' }),
    }),
    itemMetadataByQuestionId: Object.freeze({
      'empty-response-q1': Object.freeze({ questionId: 'empty-response-q1', blockNumber: 1, itemIndex: 1, componentId: 'empty-component', medleyId: 'empty-medley' }),
    }),
  }),
}), [Object.freeze({
  questionId: 'empty-response-q1',
  blockNumber: 1,
  itemIndex: 1,
  selectedAnswerId: 'A',
  choices: Object.freeze([
    Object.freeze({ id: 'A', label: 'Option A', index: 1, selected: true }),
    Object.freeze({ id: 'B', label: 'Option B', index: 2, selected: false }),
  ]),
  correctAnswerId: 'B',
})]);
assert.equal(explicitEmptyResponseModel.questions[0].selectedAnswerId, '', 'explicit empty response blocks stale snapshot and alias selection in review');
assert.equal(explicitEmptyResponseModel.questions[0].status, 'omitted');

const snapshotFallbackModel = buildReviewModel(Object.freeze({
  id: 'attempt-snapshot-fallback-selection',
  questionIds: Object.freeze(['snapshot-only-q1']),
  questionCount: 1,
  responses: Object.freeze({}),
}), [Object.freeze({
  questionId: 'snapshot-only-q1',
  blockNumber: 1,
  itemIndex: 1,
  selectedAnswerId: 'A',
  choices: Object.freeze([
    Object.freeze({ id: 'A', label: 'Option A', index: 1, selected: true }),
    Object.freeze({ id: 'B', label: 'Option B', index: 2, selected: false }),
  ]),
})]);
assert.equal(snapshotFallbackModel.questions[0].selectedAnswerId, 'A', 'non-tracking legacy review can still use snapshot-only selections');

const staleSnapshotSelectionModel = buildReviewModel(Object.freeze({
  id: 'attempt-tracking-stale-snapshot-selection',
  status: ATTEMPT_STATUS.COMPLETED,
  questionIds: Object.freeze(['tracking-q1', 'tracking-q2', 'tracking-q3', 'tracking-q4', 'tracking-q5', 'tracking-q6']),
  questionCount: 6,
  responses: Object.freeze({ 'tracking-q1': 'A', 'tracking-q2': 'B', 'tracking-q3': 'C', 'tracking-q4': 'D', 'tracking-q5': 'A' }),
  correctAnswers: Object.freeze({ 'tracking-q1': 'A', 'tracking-q2': 'B', 'tracking-q3': 'C', 'tracking-q4': 'D', 'tracking-q5': 'A', 'tracking-q6': 'C' }),
  source: Object.freeze({
    createdBy: 'tracking-engine',
    progress: Object.freeze({
      byBlock: Object.freeze({
        1: Object.freeze({ blockNumber: 1, total: 6, questionIds: Object.freeze(['tracking-q1', 'tracking-q2', 'tracking-q3', 'tracking-q4', 'tracking-q5', 'tracking-q6']), answeredQuestionIds: Object.freeze(['tracking-q1', 'tracking-q2', 'tracking-q3', 'tracking-q4', 'tracking-q5']) }),
      }),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(Array.from({ length: 6 }, (_item, index) => [`tracking-q${index + 1}`, Object.freeze({ questionId: `tracking-q${index + 1}`, blockNumber: 1, itemIndex: index + 1 })]))),
  }),
}), [Object.freeze({
  questionId: 'tracking-q6',
  blockNumber: 1,
  itemIndex: 6,
  selectedAnswerId: 'C',
  choices: Object.freeze([
    Object.freeze({ id: 'A', label: 'Option A', index: 1, selected: false }),
    Object.freeze({ id: 'B', label: 'Option B', index: 2, selected: false }),
    Object.freeze({ id: 'C', label: 'Option C', index: 3, selected: true }),
    Object.freeze({ id: 'D', label: 'Option D', index: 4, selected: false }),
  ]),
  correctAnswerId: 'C',
})]);
const staleSnapshotById = new Map(staleSnapshotSelectionModel.questions.map((question) => [question.questionId, question]));
assert.equal(staleSnapshotSelectionModel.scoreSummary.answered, 5, 'tracking review does not count stale snapshot-only selections as answers');
assert.equal(staleSnapshotById.get('tracking-q6').selectedAnswerId, '', 'tracking review ignores stale selectedAnswerId from snapshots without a recorded response or alias');
assert.equal(staleSnapshotById.get('tracking-q6').status, 'omitted');

const staleAliasSelectionModel = buildReviewModel(Object.freeze({
  id: 'attempt-tracking-stale-alias-selection',
  status: ATTEMPT_STATUS.COMPLETED,
  questionIds: Object.freeze(['alias-q1', 'alias-q2', 'alias-q3', 'alias-q4', 'alias-q5', 'alias-q6', 'alias-q40']),
  questionCount: 7,
  responses: Object.freeze({ 'alias-q1': 'A', 'alias-q2': 'A', 'alias-q3': 'A', 'alias-q4': 'A', 'alias-q5': 'B' }),
  correctAnswers: Object.freeze({ 'alias-q1': 'A', 'alias-q2': 'A', 'alias-q3': 'A', 'alias-q4': 'A', 'alias-q5': 'B', 'alias-q6': 'B', 'alias-q40': 'A' }),
  source: Object.freeze({
    createdBy: 'tracking-engine',
    progress: Object.freeze({
      byBlock: Object.freeze({
        1: Object.freeze({ blockNumber: 1, total: 40, questionIds: Object.freeze(['alias-q1', 'alias-q2', 'alias-q3', 'alias-q4', 'alias-q5', 'alias-q6', 'alias-q40']), answeredQuestionIds: Object.freeze(['alias-q1', 'alias-q2', 'alias-q3', 'alias-q4', 'alias-q5']) }),
      }),
    }),
    responseAliases: Object.freeze({
      byPosition: Object.freeze({ '1\u00006': 'B', '1\u000040': 'A' }),
      byComponent: Object.freeze({}),
    }),
    itemMetadataByQuestionId: Object.freeze({
      'alias-q1': Object.freeze({ questionId: 'alias-q1', blockNumber: 1, itemIndex: 1 }),
      'alias-q2': Object.freeze({ questionId: 'alias-q2', blockNumber: 1, itemIndex: 2 }),
      'alias-q3': Object.freeze({ questionId: 'alias-q3', blockNumber: 1, itemIndex: 3 }),
      'alias-q4': Object.freeze({ questionId: 'alias-q4', blockNumber: 1, itemIndex: 4 }),
      'alias-q5': Object.freeze({ questionId: 'alias-q5', blockNumber: 1, itemIndex: 5 }),
      'alias-q6': Object.freeze({ questionId: 'alias-q6', blockNumber: 1, itemIndex: 6 }),
      'alias-q40': Object.freeze({ questionId: 'alias-q40', blockNumber: 1, itemIndex: 40 }),
    }),
  }),
}), [
  Object.freeze({ questionId: 'alias-q6', blockNumber: 1, itemIndex: 6, selectedAnswerId: 'B', choices: Object.freeze([Object.freeze({ id: 'A', index: 1 }), Object.freeze({ id: 'B', index: 2, selected: true })]), correctAnswerId: 'B' }),
  Object.freeze({ questionId: 'alias-q40', blockNumber: 1, itemIndex: 40, selectedAnswerId: 'A', choices: Object.freeze([Object.freeze({ id: 'A', index: 1, selected: true }), Object.freeze({ id: 'B', index: 2 })]), correctAnswerId: 'A' }),
]);
const staleAliasById = new Map(staleAliasSelectionModel.questions.map((question) => [question.questionId, question]));
assert.equal(staleAliasSelectionModel.scoreSummary.answered, 5, 'tracking review does not count stale aliases outside answered progress');
assert.equal(staleAliasById.get('alias-q6').selectedAnswerId, '', 'review ignores stale alias for unanswered Q6');
assert.equal(staleAliasById.get('alias-q40').selectedAnswerId, '', 'review ignores stale alias for unanswered Q40');

const validReviewQuestionIds = Array.from({ length: 40 }, (_item, index) => `valid-q${index + 1}`);
const noisyAttempt = Object.freeze({
  id: 'attempt-noisy-review',
  status: ATTEMPT_STATUS.COMPLETED,
  questionIds: Object.freeze(validReviewQuestionIds),
  questionCount: 40,
  responses: Object.freeze(Object.fromEntries(validReviewQuestionIds.slice(0, 10).map((questionId) => [questionId, 'A']))),
  correctAnswers: Object.freeze(Object.fromEntries(validReviewQuestionIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(validReviewQuestionIds.map((questionId, index) => [questionId, Object.freeze({
      questionId,
      blockNumber: 1,
      itemIndex: index + 1,
      componentId: `valid-component-${index + 1}`,
      medleyId: `valid-medley-${index + 1}`,
    })]))),
  }),
  scoreSummary: Object.freeze({
    questionResults: Object.freeze([
      ...validReviewQuestionIds.map((questionId, index) => Object.freeze({
        questionId,
        blockNumber: 1,
        itemIndex: index + 1,
        componentId: `valid-component-${index + 1}`,
        medleyId: `valid-medley-${index + 1}`,
        selectedAnswerId: index < 10 ? 'A' : '',
        correctAnswerId: 'A',
        status: index < 10 ? 'correct' : 'omitted',
      })),
      ...Array.from({ length: 5 }, (_item, index) => Object.freeze({
        questionId: `invalid-score-only-${index + 1}`,
        blockNumber: 1,
        itemIndex: 41 + index,
        selectedAnswerId: '',
        correctAnswerId: 'A',
        status: 'omitted',
      })),
    ]),
  }),
});
const noisySnapshots = Object.freeze([
  ...validReviewQuestionIds.slice(0, 3).map((questionId, index) => Object.freeze({
    attemptId: noisyAttempt.id,
    questionId,
    blockNumber: 1,
    itemIndex: index + 1,
    renderedHtml: `<div id="valid-${index + 1}"><ol class="options"></ol></div>`,
    metadata: Object.freeze({ componentId: `valid-component-${index + 1}`, medleyId: `valid-medley-${index + 1}` }),
  })),
  Object.freeze({
    attemptId: noisyAttempt.id,
    questionId: 'duplicate-position-ghost',
    blockNumber: 1,
    itemIndex: 1,
    renderedHtml: '<div id="ghost"><ol class="options"></ol></div>',
    metadata: Object.freeze({ componentId: 'ghost-component', medleyId: 'ghost-medley' }),
  }),
]);
const noisyModel = buildReviewModel(noisyAttempt, noisySnapshots);
assert.equal(noisyModel.questions.length, 40, 'review ignores score-only ghosts and duplicate-position snapshots');
assert.equal(new Set(noisyModel.questions.map((question) => question.questionId)).size, 40, 'review question ids remain unique');
assert.deepEqual(noisyModel.questions.map((question) => question.questionId), validReviewQuestionIds);
assert.equal(noisyModel.scoreSummary.total, 40, 'review score summary is rebuilt from filtered questions');
assert.equal(noisyModel.scoreSummary.correct, 10);
assert.equal(noisyModel.scoreSummary.omitted, 30);
assert.equal(noisyModel.questions.some((question) => question.questionId === 'duplicate-position-ghost'), false);
assert.equal(noisyModel.questions.some((question) => question.questionId.startsWith('invalid-score-only-')), false);

const reportedBlockCounts = [
  [1, 3],
  [4, 38],
  [5, 1],
  [7, 1],
  [9, 40],
];
const reportedQuestionIds = reportedBlockCounts.flatMap(([blockNumber, count]) => Array.from({ length: count }, (_item, index) => `reported-b${blockNumber}-q${index + 1}`));
const reportedNoisyAttempt = Object.freeze({
  id: 'attempt-reported-block-noise',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze(reportedQuestionIds),
  questionCount: reportedQuestionIds.length,
  responses: Object.freeze({
    'reported-b4-q1': 'A',
    'reported-b9-q1': 'A',
    'reported-b9-q2': 'A',
    'reported-b9-q3': 'A',
  }),
  correctAnswers: Object.freeze(Object.fromEntries(reportedQuestionIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(reportedBlockCounts.flatMap(([blockNumber, count]) => (
      Array.from({ length: count }, (_item, index) => [`reported-b${blockNumber}-q${index + 1}`, Object.freeze({
        questionId: `reported-b${blockNumber}-q${index + 1}`,
        blockNumber,
        itemIndex: index + 1,
        componentId: `reported-component-${blockNumber}-${index + 1}`,
        medleyId: `reported-medley-${blockNumber}`,
      })])
    )))),
  }),
});
const reportedModel = buildReviewModel(reportedNoisyAttempt, []);
assert.equal(reportedModel.questions.length, 40, 'single-block review caps leaked multi-block metadata to one block');
assert.deepEqual(reportedModel.scoreSummary.perBlock.map((block) => block.blockNumber), [1]);
assert.equal(reportedModel.scoreSummary.total, 40);
assert.equal(reportedModel.questions.some((question) => question.blockNumber !== 1), false);

const reviewBlockOneIds = Array.from({ length: 40 }, (_item, index) => `review-b1-q${index + 1}`);
const reviewBlockTwoIds = Array.from({ length: 40 }, (_item, index) => `review-b2-q${index + 1}`);
const scopedReviewModel = buildReviewModel(Object.freeze({
  id: 'attempt-review-progress-scoped-block-two',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'test', block: '2' }),
  questionIds: Object.freeze([...reviewBlockOneIds, ...reviewBlockTwoIds]),
  questionCount: 80,
  responses: Object.freeze(Object.fromEntries(reviewBlockOneIds.slice(0, 3).map((questionId) => [questionId, 'A']))),
  correctAnswers: Object.freeze(Object.fromEntries([...reviewBlockOneIds, ...reviewBlockTwoIds].map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    progress: Object.freeze({
      byBlock: Object.freeze({
        2: Object.freeze({ blockNumber: 2, answered: 0, total: 40, questionIds: Object.freeze(reviewBlockTwoIds), answeredQuestionIds: Object.freeze([]) }),
      }),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries([
      ...reviewBlockOneIds.map((questionId, index) => [questionId, Object.freeze({ questionId, blockNumber: 1, itemIndex: index + 1 })]),
      ...reviewBlockTwoIds.map((questionId, index) => [questionId, Object.freeze({ questionId, blockNumber: 2, itemIndex: index + 1 })]),
    ])),
  }),
}), []);
assert.equal(scopedReviewModel.questions.length, 40, 'review mode uses active block progress question ids');
assert.deepEqual(scopedReviewModel.questions.map((question) => question.questionId), reviewBlockTwoIds);
assert.deepEqual(scopedReviewModel.scoreSummary.perBlock.map((block) => block.blockNumber), [2]);
assert.equal(scopedReviewModel.scoreSummary.answered, 0);

const staleLaunchedScopeBlockIds = Array.from({ length: 3 }, (_item, index) => `stale-scope-b3-q${index + 1}`);
const staleLaunchedScopeModel = buildReviewModel(Object.freeze({
  id: 'attempt-review-stale-launched-scope-block-three',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'test', block: '1', testDefinitionDisplayName: 'Step 1 Block 1' }),
  questionIds: Object.freeze(staleLaunchedScopeBlockIds),
  questionCount: 3,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 3, itemCount: 3, label: 'Block 3' })]),
  correctAnswers: Object.freeze(Object.fromEntries(staleLaunchedScopeBlockIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    progress: Object.freeze({
      byBlock: Object.freeze({
        3: Object.freeze({ blockNumber: 3, answered: 0, total: 3, questionIds: Object.freeze(staleLaunchedScopeBlockIds), answeredQuestionIds: Object.freeze([]) }),
      }),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(staleLaunchedScopeBlockIds.map((questionId, index) => [questionId, Object.freeze({ questionId, blockNumber: 3, itemIndex: index + 1 })]))),
  }),
}), []);
assert.deepEqual(staleLaunchedScopeModel.scoreSummary.perBlock.map((block) => block.blockNumber), [3], 'review trusts recorded current block over stale launched-scope block');
assert.deepEqual(staleLaunchedScopeModel.questions.map((question) => question.blockNumber), [3, 3, 3]);

const incompleteProgressIds = Array.from({ length: 40 }, (_item, index) => `incomplete-progress-q${index + 1}`);
const incompleteProgressModel = buildReviewModel(Object.freeze({
  id: 'attempt-incomplete-progress-review',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze(incompleteProgressIds),
  questionCount: 40,
  correctAnswers: Object.freeze(Object.fromEntries(incompleteProgressIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    progress: Object.freeze({
      byBlock: Object.freeze({
        1: Object.freeze({ blockNumber: 1, answered: 0, total: 40, questionIds: Object.freeze(incompleteProgressIds.slice(0, 38)), answeredQuestionIds: Object.freeze([]) }),
      }),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(incompleteProgressIds.map((questionId, index) => [questionId, Object.freeze({ questionId, blockNumber: 1, itemIndex: index + 1 })]))),
  }),
}), []);
assert.equal(incompleteProgressModel.questions.length, 40, 'review ignores incomplete progress question-id scope');
assert.deepEqual(incompleteProgressModel.questions.map((question) => question.itemIndex), Array.from({ length: 40 }, (_item, index) => index + 1));

const allBlockReviewIds = [1, 2, 3].flatMap((blockNumber) => Array.from({ length: 40 }, (_item, index) => `all-block-b${blockNumber}-q${index + 1}`));
const allBlockReviewModel = buildReviewModel(Object.freeze({
  id: 'attempt-step1-all-blocks-review',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'all', blockCount: 3, testDefinitionDisplayName: 'Step 1 All Blocks' }),
  questionIds: Object.freeze(allBlockReviewIds),
  questionCount: 120,
  responses: Object.freeze(Object.fromEntries(allBlockReviewIds.map((questionId) => [questionId, 'A']))),
  correctAnswers: Object.freeze(Object.fromEntries(allBlockReviewIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    progress: Object.freeze({
      byBlock: Object.freeze({
        3: Object.freeze({ blockNumber: 3, answered: 40, total: 40, questionIds: Object.freeze(allBlockReviewIds.slice(80)), answeredQuestionIds: Object.freeze(allBlockReviewIds.slice(80)) }),
      }),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries([1, 2, 3].flatMap((blockNumber) => Array.from({ length: 40 }, (_item, index) => {
      const questionId = `all-block-b${blockNumber}-q${index + 1}`;
      return [questionId, Object.freeze({ questionId, blockNumber, itemIndex: index + 1 })];
    })))),
  }),
}), []);
assert.equal(allBlockReviewModel.questions.length, 120, 'all-block review does not get scoped to one progress block');
assert.deepEqual(allBlockReviewModel.scoreSummary.perBlock.map((block) => [block.blockNumber, block.total]), [[1, 40], [2, 40], [3, 40]]);

const step3AllBlockCounts = [[1, 38], [2, 39], [3, 30], [4, 30]];
const step3DuplicateDropByBlock = Object.freeze({ 1: 1, 2: 3, 3: 1, 4: 2 });
const getStep3RawItemIndex = (blockNumber, displayIndex) => {
  const duplicateDropCount = step3DuplicateDropByBlock[blockNumber] || 0;
  if (displayIndex >= 6 && displayIndex <= 5 + duplicateDropCount) {
    return 5;
  }
  return displayIndex;
};
const step3DuplicatePositionIds = step3AllBlockCounts.flatMap(([blockNumber, count]) => (
  Array.from({ length: count }, (_item, index) => `step3-all-b${blockNumber}-q${index + 1}`)
));
const step3DuplicatePositionModel = buildReviewModel(Object.freeze({
  id: 'attempt-step3-all-blocks-duplicate-positions',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'all', blockCount: 4, testDefinitionDisplayName: 'Step 3 All Blocks' }),
  questionIds: Object.freeze(step3DuplicatePositionIds),
  questionCount: step3DuplicatePositionIds.length,
  responses: Object.freeze(Object.fromEntries(step3DuplicatePositionIds.map((questionId) => [questionId, 'A']))),
  correctAnswers: Object.freeze(Object.fromEntries(step3DuplicatePositionIds.map((questionId) => [questionId, 'A']))),
  blockMetadata: Object.freeze(step3AllBlockCounts.map(([blockNumber, count]) => Object.freeze({ blockNumber, itemCount: count, label: `Block ${blockNumber}` }))),
  source: Object.freeze({
    progress: Object.freeze({
      byBlock: Object.freeze(Object.fromEntries(step3AllBlockCounts.map(([blockNumber, count]) => {
        const ids = Array.from({ length: count }, (_item, index) => `step3-all-b${blockNumber}-q${index + 1}`);
        return [blockNumber, Object.freeze({ blockNumber, answered: count, total: count, questionIds: Object.freeze(ids), answeredQuestionIds: Object.freeze(ids) })];
      }))),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(step3AllBlockCounts.flatMap(([blockNumber, count]) => (
      Array.from({ length: count }, (_item, index) => {
        const displayIndex = index + 1;
        const questionId = `step3-all-b${blockNumber}-q${displayIndex}`;
        return [questionId, Object.freeze({
          questionId,
          blockNumber,
          itemIndex: getStep3RawItemIndex(blockNumber, displayIndex),
          componentId: `step3-component-${blockNumber}-${displayIndex}`,
          medleyId: `step3-medley-${blockNumber}`,
        })];
      })
    )))),
  }),
}), []);
assert.equal(step3DuplicatePositionModel.questions.length, 137, 'all-block review keeps Step 3 multipage-set items with duplicate raw itemIndex values');
assert.deepEqual(step3DuplicatePositionModel.scoreSummary.perBlock.map((block) => [block.blockNumber, block.total]), [[1, 38], [2, 39], [3, 30], [4, 30]]);
step3AllBlockCounts.forEach(([blockNumber, count]) => {
  assert.deepEqual(
    step3DuplicatePositionModel.questions.filter((question) => question.blockNumber === blockNumber).map((question) => question.itemIndex),
    Array.from({ length: count }, (_item, index) => index + 1),
    `review repairs Step 3 Block ${blockNumber} duplicate raw item positions to displayed order`
  );
});
const allBlockReviewHtml = buildReviewHtml(Object.freeze({
  id: 'attempt-step1-all-blocks-review-html',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'all', blockCount: 3, testDefinitionDisplayName: 'Step 1 All Blocks' }),
  questionIds: Object.freeze(allBlockReviewIds),
  questionCount: 120,
  responses: Object.freeze(Object.fromEntries(allBlockReviewIds.map((questionId) => [questionId, 'A']))),
  correctAnswers: Object.freeze(Object.fromEntries(allBlockReviewIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries([1, 2, 3].flatMap((blockNumber) => Array.from({ length: 40 }, (_item, index) => {
      const questionId = `all-block-b${blockNumber}-q${index + 1}`;
      return [questionId, Object.freeze({ questionId, blockNumber, itemIndex: index + 1 })];
    })))),
  }),
}), []);
assert.match(allBlockReviewHtml, /f120-review-block-separator/, 'all-block review nav marks block boundaries with separator rows');
assert.match(allBlockReviewHtml, /border-top-color: #cbd5e1/, 'review page styles block boundary separator lines');

const endExamBlockIds = Array.from({ length: 40 }, (_item, index) => `webfred:USMLE:Block-1:endexam-q${index + 1}`);
let openedReviewHtml = '';
const endExamReviewResult = await openReviewTab({
  attemptId: 'attempt-endexam-stale-block-one-metadata',
  window: Object.freeze({
    Blob,
    URL: Object.freeze({ createObjectURL(blob) { return `blob:test-review/${blob.size}`; } }),
    open() { return { location: { href: '' }, document: { body: {}, title: '' } }; },
    console: Object.freeze({ info() {} }),
  }),
  storage: Object.freeze({
    async getAttempt() {
      return Object.freeze({
        id: 'attempt-endexam-stale-block-one-metadata',
        status: ATTEMPT_STATUS.COMPLETED,
        launchedScope: Object.freeze({ mode: '', block: '', testDefinitionDisplayName: 'Key' }),
        questionIds: Object.freeze(endExamBlockIds),
        questionCount: 40,
        blockMetadata: Object.freeze([
          Object.freeze({ blockNumber: 1, itemCount: 40, label: 'Block 1' }),
          Object.freeze({ blockNumber: 40, itemCount: 40, label: 'Block 40' }),
        ]),
        correctAnswers: Object.freeze(Object.fromEntries(endExamBlockIds.map((questionId) => [questionId, 'A']))),
        source: Object.freeze({
          itemMetadataByQuestionId: Object.freeze(Object.fromEntries(endExamBlockIds.map((questionId, index) => [questionId, Object.freeze({
            questionId,
            blockNumber: 1,
            itemIndex: index + 1,
            componentId: `endexam-component-${index + 1}`,
            medleyId: 'endexam-medley',
          })]))),
        }),
      });
    },
    async listQuestionSnapshots(attemptId) {
      if (String(attemptId).startsWith('qbank-cache:')) {
        return endExamBlockIds.map((questionId, index) => Object.freeze({
          id: `qbank-endexam-block40-${index + 1}`,
          attemptId,
          questionId: `qbank-block40-q${index + 1}`,
          blockNumber: 40,
          itemIndex: index + 1,
          correctAnswerId: 'A',
          renderedHtml: `<div id="qbank-endexam-${index + 1}"><ol class="options"></ol></div>`,
          metadata: Object.freeze({ componentId: `endexam-component-${index + 1}`, medleyId: 'endexam-medley', blockNumber: 40, itemIndex: index + 1 }),
        }));
      }
      return [Object.freeze({
        id: 'own-endexam-block40-current',
        attemptId,
        questionId: endExamBlockIds[0],
        blockNumber: 40,
        itemIndex: 1,
        selectedAnswerId: 'A',
        renderedHtml: '<div id="own-current-block40"><ol class="options"></ol></div>',
        metadata: Object.freeze({ blockNumber: 40, itemIndex: 1, questionContentSource: 'dom-current-item', capturedFromDom: true }),
      })];
    },
    async listAttempts() {
      return [Object.freeze({ id: 'qbank-cache:USMLE:Block40', source: Object.freeze({ cacheKind: 'qbank' }) })];
    },
  }),
  debugDiagnostics: true,
});
openedReviewHtml = await endExamReviewResult.blob.text();
assert.match(openedReviewHtml, /reviewBlockRepair/, 'end-exam review records block repair diagnostics');
assert.match(openedReviewHtml, /"blockNumber":40/, 'end-exam review rebases stale Block 1 metadata to real completed block');
assert.doesNotMatch(openedReviewHtml, /"modelBlocks":\[1\]/, 'end-exam review model no longer fixed to Block 1');
assert.match(openedReviewHtml, /qbank-endexam-block40-1/, 'end-exam review uses qbank snapshots from repaired block');

const staleLiveBlockOneQBankOriginalBlockResult = await openReviewTab({
  attemptId: 'attempt-live-step1-block3-recorded-as-block1',
  window: Object.freeze({
    Blob,
    URL: Object.freeze({ createObjectURL(blob) { return `blob:test-review/${blob.size}`; } }),
    open() { return { location: { href: '' }, document: { body: {}, title: '' } }; },
    console: Object.freeze({ info() {} }),
  }),
  storage: Object.freeze({
    async getAttempt() {
      return Object.freeze({
        id: 'attempt-live-step1-block3-recorded-as-block1',
        status: ATTEMPT_STATUS.COMPLETED,
        launchedScope: Object.freeze({ mode: '', block: '', testDefinitionDisplayName: 'Key' }),
        questionIds: Object.freeze(['webfred:USMLE:Block-1:MED-B3:COMP-B3']),
        questionCount: 1,
        blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 1, label: 'Block 1' })]),
        correctAnswers: Object.freeze({ 'webfred:USMLE:Block-1:MED-B3:COMP-B3': 'A' }),
        source: Object.freeze({
          itemMetadataByQuestionId: Object.freeze({
            'webfred:USMLE:Block-1:MED-B3:COMP-B3': Object.freeze({ questionId: 'webfred:USMLE:Block-1:MED-B3:COMP-B3', blockNumber: 1, itemIndex: 1, componentId: 'COMP-B3', medleyId: 'MED-B3' }),
          }),
        }),
      });
    },
    async listQuestionSnapshots(attemptId) {
      if (String(attemptId).startsWith('qbank-cache:')) {
        return [Object.freeze({
          id: 'qbank-step1-block3-snapshot',
          attemptId,
          questionId: 'webfred:USMLE:Block-3:MED-B3:COMP-B3',
          blockNumber: 3,
          itemIndex: 1,
          correctAnswerId: 'A',
          renderedHtml: '<div id="qbank-step1-block3"><ol class="options"></ol></div>',
          metadata: Object.freeze({ componentId: 'COMP-B3', medleyId: 'MED-B3', blockNumber: 3, itemIndex: 1 }),
        })];
      }
      return [];
    },
    async listAttempts() {
      return [Object.freeze({ id: 'qbank-cache:USMLE:STPF1:STPF1C0139', source: Object.freeze({ cacheKind: 'qbank' }) })];
    },
  }),
  debugDiagnostics: true,
});
const staleLiveBlockOneQBankOriginalBlockHtml = await staleLiveBlockOneQBankOriginalBlockResult.blob.text();
assert.match(staleLiveBlockOneQBankOriginalBlockHtml, /"reviewBlockRepair":\{"blockNumber":3/, 'review repairs Block 1 live attempt from qbank original Block 3 evidence');
assert.match(staleLiveBlockOneQBankOriginalBlockHtml, /"blockCounts":\{"3":1\}/, 'review model displays repaired Block 3');
assert.doesNotMatch(staleLiveBlockOneQBankOriginalBlockHtml, /"modelBlocks":\[1\]/, 'stale Block 1 does not survive qbank-original repair');

const blockMetadataRepairHtml = buildReviewHtml(Object.freeze({
  id: 'attempt-endexam-block-metadata-only-repair',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: '', block: '', testDefinitionDisplayName: 'Key' }),
  questionIds: Object.freeze(endExamBlockIds),
  questionCount: 40,
  blockMetadata: Object.freeze([
    Object.freeze({ blockNumber: 1, itemCount: 40, label: 'Block 1' }),
    Object.freeze({ blockNumber: 40, itemCount: 40, label: 'Block 40' }),
  ]),
  correctAnswers: Object.freeze(Object.fromEntries(endExamBlockIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(endExamBlockIds.map((questionId, index) => [questionId, Object.freeze({ questionId, blockNumber: 40, itemIndex: index + 1 })]))),
    reviewBlockRepair: Object.freeze({ blockNumber: 40 }),
  }),
}), [], { debugDiagnostics: true });
assert.match(blockMetadataRepairHtml, /"blockCounts":\{"40":40\}/, 'review page exposes repaired block filter option');

const legacyShortIds = Array.from({ length: 38 }, (_item, index) => `legacy-short-q${index + 1}`);
const legacyShortModel = buildReviewModel(Object.freeze({
  id: 'attempt-legacy-short-question-list',
  status: ATTEMPT_STATUS.COMPLETED,
  launchedScope: Object.freeze({ mode: 'test', block: '1' }),
  questionIds: Object.freeze(legacyShortIds),
  questionCount: 40,
  blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 40, label: 'Block 1' })]),
  correctAnswers: Object.freeze(Object.fromEntries(legacyShortIds.map((questionId) => [questionId, 'A']))),
  source: Object.freeze({
    progress: Object.freeze({
      byBlock: Object.freeze({
        1: Object.freeze({ blockNumber: 1, answered: 0, total: 40, questionIds: Object.freeze(legacyShortIds), answeredQuestionIds: Object.freeze([]) }),
      }),
    }),
    itemMetadataByQuestionId: Object.freeze(Object.fromEntries(legacyShortIds.map((questionId, index) => [questionId, Object.freeze({ questionId, blockNumber: 1, itemIndex: index + 1 })]))),
  }),
}), []);
assert.equal(legacyShortModel.questions.length, 40, 'review pads legacy single-block attempts to recorded item count');
assert.equal(legacyShortModel.questions[38].itemIndex, 39);
assert.match(legacyShortModel.questions[38].questionId, /^webfred:review-missing:/);
assert.equal(legacyShortModel.scoreSummary.total, 40);

console.log('review and history tests passed');
