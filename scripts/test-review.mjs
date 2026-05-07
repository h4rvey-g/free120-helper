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
    renderedHtml: '<div id="item1"><div class="NBExposition">Synthetic stem</div><div id="q1_div" class="NBOptionListComp answerbox"><form><ol class="options"><li class="stContext"><input class="NBOptionInput" type="radio" value="A"><span>Option A</span></li><li class="stContext"><input class="NBOptionInput" type="radio" value="B"><span>Option B</span></li></ol></form></div></div>',
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
assert.doesNotMatch(html, /fetch\s*\(/);
assert.doesNotMatch(html, /XMLHttpRequest/);

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

const qbankSelectionOnlyModel = buildReviewModel(Object.freeze({
  id: 'attempt-qbank-selection-only',
  questionIds: Object.freeze(['selection-q1']),
  questionCount: 1,
  correctAnswers: Object.freeze({ 'selection-q1': 'B' }),
  source: Object.freeze({
    itemMetadataByQuestionId: Object.freeze({
      'selection-q1': Object.freeze({ questionId: 'selection-q1', blockNumber: 1, itemIndex: 1 }),
    }),
  }),
}), [Object.freeze({
  questionId: 'selection-q1',
  blockNumber: 1,
  itemIndex: 1,
  choices: Object.freeze([
    Object.freeze({ id: 'A', label: 'Option A', index: 1, selected: true }),
    Object.freeze({ id: 'B', label: 'Option B', index: 2, selected: false }),
  ]),
  selectedAnswerId: '',
  correctAnswerId: 'B',
})]);
assert.equal(qbankSelectionOnlyModel.questions[0].selectedAnswerId, 'A', 'review keeps selected choice from merged snapshot when response id is absent');
assert.equal(qbankSelectionOnlyModel.questions[0].status, 'incorrect');

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
