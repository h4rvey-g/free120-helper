import assert from 'node:assert/strict';
import { buildReviewHtml } from '../src/review/blob-builder.js';
import { buildReviewModel } from '../src/review/model.js';
import { ATTEMPT_STATUS } from '../src/core/constants.js';

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

console.log('review tests passed');
