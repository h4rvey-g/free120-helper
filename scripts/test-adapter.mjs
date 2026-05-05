import assert from 'node:assert/strict';
import { ANSWER_KEY_CAPTURE_STATUS, ANSWER_KEY_CAPTURE_SOURCE } from '../src/core/constants.js';
import { createAnswerKeyCaptureResult, createFailedAnswerKeyCaptureResult } from '../src/answer-keys/controller.js';
import { createTrackingQuestionSnapshot, buildTrackingAttemptPatch } from '../src/tracking/engine.js';
import {
  buildQuestionIdentity,
  coercePositiveInteger,
  createEmptyWebfredState,
  extractChoicesFromDom,
  extractCurrentContentFromDom,
  extractNavigationStateFromDom,
  extractQuestionIdentityFromDom,
  extractResourceUrls,
  extractSelectedAnswerIdFromDom,
  findCurrentDomItemRoot,
  firstNonEmpty,
  normalizeChoiceFromAngular,
  normalizeChoicesFromAngular,
  normalizeIdentifierPart,
  normalizeMaybeBoolean,
  safeAttribute,
  safeDatasetValue,
  safeElementText,
  snapshotForAttemptPosition,
  uniqueNormalizedStrings,
} from '../src/webfred/adapter.js';
import {
  createIncompleteAnswerKeyState,
  createSyntheticAdapterState,
  createSyntheticAnswerKeyRecords,
  createSyntheticAttempt,
} from './test-utils/fixtures.mjs';
import { createFakeDocument, createFakeWindow, el } from './test-utils/fake-dom.mjs';

const choiceRows = el('ol', { class: 'options' }, [
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'q1', value: 'A', checked: true }), el('span', {}, ['Synthetic A'])]),
  el('li', { class: 'stContext correct' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'q1', value: 'B' }), el('span', {}, ['Synthetic B'])]),
]);
const item = el('div', { id: 'item-q1', 'data-component-id': 'component-q1', 'data-item-index': '1' }, [
  el('div', { class: 'NBExposition' }, ['Synthetic stem']),
  el('div', { id: 'q1_div', class: 'NBOptionListComp answerbox', 'data-correct-answer': 'B' }, [choiceRows]),
  el('textarea', {}, ['Synthetic note']),
  el('mark', {}, ['Synthetic highlight']),
  el('span', { style: 'text-decoration: line-through' }, ['Synthetic strikeout']),
  el('img', { src: 'https://example.test/synthetic.png' }),
]);
const medley = el('div', { id: 'medley-1', 'data-medley-id': 'medley-1' }, [item]);
const nav = el('nav', {}, [el('ol', { id: 'leftnav' }, [
  el('li', { class: 'currentitem', 'aria-current': 'true' }, [el('span', { class: 'index' }, ['1'])]),
  el('li', {}, [el('span', { class: 'index' }, ['2'])]),
])]);
const body = el('main', {}, [nav, el('section', { id: 'item' }, [el('article', { id: 'content' }, [medley])]), el('div', {}, ['Block 1 of 1'])]);
const fakeDocument = createFakeDocument(body, { title: 'Synthetic Step 1 Free 120' });
const fakeWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201');

assert.equal(firstNonEmpty(['', 'A', 'B']), 'A');
assert.equal(coercePositiveInteger('3', 1), 3);
assert.equal(normalizeMaybeBoolean('marked'), true);
assert.equal(normalizeMaybeBoolean('unchecked'), false);
assert.equal(normalizeIdentifierPart(' Step 1 / Free 120! '), 'Step-1--Free-120');
assert.deepEqual(uniqueNormalizedStrings([' A ', 'A', '', 'B']), ['A', 'B']);
assert.equal(safeElementText(item).includes('Synthetic stem'), true);
assert.equal(safeAttribute(item, 'id'), 'item-q1');
assert.equal(safeDatasetValue(item, 'componentId'), 'component-q1');

const identity = buildQuestionIdentity({ examProgram: 'Step 1', examName: 'Free 120', medleyId: 'm1', componentId: 'c1', blockNumber: 1, itemIndex: 2 });
assert.equal(identity.questionId, 'webfred:Step-1:Free-120:m1:c1');
assert.equal(identity.identitySource, 'component-medley');

const choices = extractChoicesFromDom(item);
assert.equal(choices.length, 2);
assert.equal(choices[0].id, 'A');
assert.equal(choices[0].selected, true);
assert.equal(extractSelectedAnswerIdFromDom(item), 'A');
assert.deepEqual(extractResourceUrls(item), ['https://example.test/synthetic.png']);

const content = extractCurrentContentFromDom(item);
assert.match(content.renderedHtml, /NBExposition/);
assert.match(content.answerBoxHtml, /Synthetic A/);
assert.equal(content.choices.length, 2);

const navState = extractNavigationStateFromDom(fakeDocument, fakeWindow);
assert.equal(navState.currentBlock, 1);
assert.equal(navState.blockCount, 1);
assert.equal(navState.currentItemIndex, 1);
assert.equal(navState.itemCount, 2);

assert.equal(findCurrentDomItemRoot(fakeDocument, fakeWindow), item);
const domIdentity = extractQuestionIdentityFromDom(item, fakeDocument, fakeWindow);
assert.equal(domIdentity.componentId, 'component-q1');
assert.equal(domIdentity.medleyId, 'medley-1');
assert.equal(domIdentity.itemIndex, 1);

const emptyState = createEmptyWebfredState('synthetic-empty');
assert.equal(emptyState.degradedReasons[0], 'synthetic-empty');
assert.equal(emptyState.status, 'pending');

assert.deepEqual(normalizeChoiceFromAngular({ optionId: 'A', text: 'Alpha', selected: 'true' }, 0), {
  id: 'A',
  label: 'Alpha',
  index: 1,
  selected: true,
  disabled: false,
});
assert.equal(normalizeChoicesFromAngular([{ value: 'B', label: 'Beta' }])[0].id, 'B');

const adapterState = createSyntheticAdapterState();
assert.deepEqual(snapshotForAttemptPosition(adapterState), {
  questionId: 'q1',
  blockNumber: 1,
  itemIndex: 1,
  componentId: 'component-q1',
  medleyId: 'medley-1',
  identitySource: 'component-medley',
});

const completeKeyResult = createAnswerKeyCaptureResult(createSyntheticAnswerKeyRecords(), adapterState, { attemptId: 'attempt-adapter', expectedCount: 2 });
assert.equal(completeKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.COMPLETE);
assert.equal(completeKeyResult.summary.source, ANSWER_KEY_CAPTURE_SOURCE.ANGULAR_BULK);
assert.deepEqual(completeKeyResult.correctAnswers, { q1: 'A', q2: 'C' });

const partialKeyResult = createAnswerKeyCaptureResult(createSyntheticAnswerKeyRecords().slice(0, 1), createIncompleteAnswerKeyState(), { expectedCount: 3 });
assert.equal(partialKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.PARTIAL);
assert.equal(partialKeyResult.summary.unknownCount, 2);
const failedKeyResult = createFailedAnswerKeyCaptureResult(adapterState, { attemptId: 'attempt-adapter', expectedCount: 3 }, new Error('synthetic failure'));
assert.equal(failedKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.FAILED);
assert.match(failedKeyResult.lastError, /synthetic failure/);

const attempt = createSyntheticAttempt({ id: 'attempt-adapter' });
const trackingSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState,
  item: adapterState.currentItem,
  itemList: adapterState.itemList,
  timingByQuestionId: { q1: { totalMs: 1234 } },
  answerKeyCaptureResult: completeKeyResult,
  root: item,
  document: fakeDocument,
});
assert.equal(trackingSnapshot.questionId, 'q1');
assert.equal(trackingSnapshot.selectedAnswerId, 'A');
assert.equal(trackingSnapshot.correctAnswerId, 'A');
assert.equal(trackingSnapshot.notes, 'Synthetic note');
assert.equal(trackingSnapshot.annotations.highlights.length, 1);
assert.equal(trackingSnapshot.annotations.strikeouts.length, 1);
assert.equal(trackingSnapshot.timingMs, 1234);
assert.deepEqual(trackingSnapshot.resourceUrls, ['https://example.test/synthetic.png']);

const patch = buildTrackingAttemptPatch(
  attempt,
  adapterState,
  adapterState.itemList,
  adapterState.currentItem,
  { responses: { q1: 'A', q2: 'B' }, changes: [{ questionId: 'q1', fromAnswerId: '', toAnswerId: 'A', item: adapterState.currentItem }] },
  { q1: { totalMs: 1234, blockNumber: 1, itemIndex: 1 } },
  ['q2'],
  completeKeyResult,
  'synthetic-update'
);
assert.equal(patch.questionCount, 3);
assert.equal(patch.responses.q2, 'B');
assert.equal(patch.correctAnswers.q2, 'C');
assert.equal(patch.markedQuestionIds[0], 'q2');
assert.equal(patch.source.progress.overall.answered, 2);
assert.equal(patch.source.itemMetadataByQuestionId.q1.componentId, 'component-q1');
assert.equal(patch.answerTimeline.length, 1);

console.log('adapter, key capture, and tracking tests passed');
