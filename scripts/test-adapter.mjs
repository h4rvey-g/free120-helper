import assert from 'node:assert/strict';
import { ANSWER_KEY_CAPTURE_STATUS, ANSWER_KEY_CAPTURE_SOURCE } from '../src/core/constants.js';
import { createAnswerKeyCaptureController, createAnswerKeyCaptureResult, createFailedAnswerKeyCaptureResult } from '../src/answer-keys/controller.js';
import { createTrackingQuestionSnapshot, getTrackingItemList, buildTrackingAttemptPatch } from '../src/tracking/engine.js';
import {
  buildQuestionIdentity,
  coercePositiveInteger,
  createEmptyWebfredState,
  createWebfredSiteAdapter,
  extractChoicesFromDom,
  extractCurrentContentFromDom,
  extractNavigationStateFromDom,
  extractQuestionIdentityFromDom,
  extractResourceUrls,
  extractSelectedAnswerIdFromDom,
  findCurrentDomItemRoot,
  findKeyNavigationItem,
  firstNonEmpty,
  normalizeChoiceFromAngular,
  normalizeChoicesFromAngular,
  normalizeIdentifierPart,
  normalizeMaybeBoolean,
  safeAttribute,
  safeDatasetValue,
  safeElementText,
  isNavigationKeyItem,
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
  el('li', { class: 'keyitem' }, [el('span', { class: 'index' }, ['Key'])]),
])]);
const body = el('main', {}, [nav, el('section', { id: 'item' }, [el('article', { id: 'content' }, [medley])]), el('div', {}, ['Block 1 of 1'])]);
const fakeDocument = createFakeDocument(body, { title: 'Synthetic Step 1 Free 120' });
const fakeWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201');
const genericDriverDocument = createFakeDocument(body, { title: 'NBME Exam Driver' });
const genericDriverWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=USMLE&exam=NBME%20Exam%20Driver&section=Step%201%20Block%202&block=2&mode=test');

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
assert.equal(identity.questionId, 'webfred:Step-1:Free-120:Block-1:m1:c1');
assert.equal(identity.identitySource, 'component-medley');
const crossBlockIdentity = buildQuestionIdentity({ examProgram: 'Step 1', examName: 'Free 120', medleyId: 'm1', componentId: 'c1', blockNumber: 2, itemIndex: 2 });
assert.notEqual(crossBlockIdentity.questionId, identity.questionId, 'question identity includes block scope');

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
assert.equal(isNavigationKeyItem(nav.querySelector('li.keyitem')), true);
assert.equal(findKeyNavigationItem(fakeDocument), nav.querySelector('li.keyitem'));
const genericDriverState = createWebfredSiteAdapter({ window: genericDriverWindow, document: genericDriverDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(genericDriverState.examIdentity.program, 'Step 1', 'generic USMLE program label upgrades to concrete Step label');
assert.equal(genericDriverState.examIdentity.examName, '', 'generic NBME Exam Driver title does not become history exam name');
assert.equal(genericDriverState.examIdentity.section, 'Step 1 Block 2');
assert.equal(genericDriverState.launchedScope.block, '2');
assert.equal(genericDriverState.launchedScope.section, 'Step 1 Block 2');
assert.equal(genericDriverState.currentBlock, 2, 'hash/query launched block overrides missing DOM block text');
assert.equal(genericDriverState.currentItem.blockNumber, 2);
assert.match(genericDriverState.currentItem.questionId, /Block-2/);

const staleScopeAngularItems = Array.from({ length: 200 }, (_entry, index) => ({
  componentId: `scope-component-${index + 1}`,
  medleyId: `scope-medley-${Math.floor(index / 40) + 1}`,
}));
const staleScopeNav = el('nav', {}, [el('ol', { id: 'leftnav' }, Array.from({ length: 40 }, (_entry, index) => (
  el('li', index === 0 ? { class: 'currentitem', 'aria-current': 'true' } : {}, [el('span', { class: 'index' }, [String(index + 1)])])
)))]);
const staleScopeBody = el('main', {}, [
  staleScopeNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley-5', 'data-medley-id': 'scope-medley-5' }, [
    el('div', { id: 'item-scope-161', 'data-component-id': 'scope-component-161', 'data-item-index': '1' }, [
      el('div', { class: 'NBExposition' }, ['Stale launched scope stem']),
      el('div', { id: 'item-scope-161_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
    ]),
  ])])]),
  el('div', {}, ['Block 5 of 5']),
]);
const staleScopeDocument = createFakeDocument(staleScopeBody, { title: 'Synthetic Step 1 Free 120' });
const staleScopeWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201&block=1&mode=test');
staleScopeWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          launchedScope: { block: '1', testDefinitionDisplayName: 'Step 1 Block 1', mode: 'test' },
          currentBlock: 1,
          blockCount: 5,
          totalQuestions: 200,
          itemList: staleScopeAngularItems,
          currentItem: staleScopeAngularItems[160],
        },
      }),
    }),
  }),
};
const staleScopeState = createWebfredSiteAdapter({ window: staleScopeWindow, document: staleScopeDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(staleScopeState.currentBlock, 5, 'reliable multi-block DOM current block overrides stale launched scope block');
assert.equal(staleScopeState.source, 'mixed');
assert.equal(staleScopeState.itemList.length, 40);
assert.equal(staleScopeState.itemList[0].componentId, 'scope-component-161');
assert.equal(staleScopeState.itemList[0].blockNumber, 5);
assert.equal(staleScopeState.currentItem.componentId, 'scope-component-161');
assert.equal(staleScopeState.currentItem.blockNumber, 5);

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

const allBlockAngularItems = Array.from({ length: 80 }, (_item, index) => ({
  componentId: `component-q${index + 1}`,
  medleyId: `medley-${Math.floor(index / 40) + 1}`,
}));
const blockTwoItem = el('div', { id: 'item-q41', 'data-component-id': 'component-q41', 'data-item-index': '1' }, [
  el('div', { class: 'NBExposition' }, ['Synthetic block 2 stem']),
  el('div', { id: 'q41_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
]);
const allBlockNav = el('nav', {}, [el('ol', { id: 'leftnav' }, Array.from({ length: 40 }, (_entry, index) => (
  el('li', index === 0 ? { class: 'currentitem', 'aria-current': 'true' } : {}, [el('span', { class: 'index' }, [String(index + 1)])])
)))]);
const allBlockBody = el('main', {}, [
  allBlockNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley-2', 'data-medley-id': 'medley-2' }, [blockTwoItem])])]),
  el('div', {}, ['Block 2 of 2']),
]);
const allBlockDocument = createFakeDocument(allBlockBody, { title: 'Synthetic Step 1 Free 120' });
const allBlockWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%202&mode=all');
allBlockWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 2,
          blockCount: 2,
          totalQuestions: 80,
          itemList: allBlockAngularItems,
          currentItem: allBlockAngularItems[40],
        },
      }),
    }),
  }),
};
const allBlockAdapter = createWebfredSiteAdapter({ window: allBlockWindow, document: allBlockDocument, logger: { debug() {}, warn() {} } });
const allBlockState = allBlockAdapter.readState();
assert.equal(allBlockState.currentBlock, 2);
assert.equal(allBlockState.itemCount, 40, 'current block question count ignores other launched blocks');
assert.equal(allBlockState.itemList.length, 40);
assert.equal(allBlockState.itemList[0].componentId, 'component-q41');
assert.equal(allBlockState.itemList[0].itemIndex, 1);
assert.equal(allBlockState.itemList[39].componentId, 'component-q80');
assert.equal(allBlockState.currentItem.itemIndex, 1);

const oneBasedGlobalAngularItems = Array.from({ length: 80 }, (_item, index) => ({
  componentId: `global-onebased-component-${index + 1}`,
  medleyId: `global-onebased-medley-${Math.floor(index / 40) + 1}`,
  itemIndex: index + 1,
}));
const oneBasedGlobalBlockTwoItem = el('div', { id: 'item-onebased-41', 'data-component-id': 'global-onebased-component-41' }, [
  el('div', { class: 'NBExposition' }, ['Synthetic one-based block 2 stem']),
  el('div', { id: 'global-onebased-component-41_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
]);
const oneBasedGlobalBody = el('main', {}, [
  allBlockNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'global-onebased-medley-2', 'data-medley-id': 'global-onebased-medley-2' }, [oneBasedGlobalBlockTwoItem])])]),
  el('div', {}, ['Block 2 of 2']),
]);
const oneBasedGlobalDocument = createFakeDocument(oneBasedGlobalBody, { title: 'Synthetic Step 1 Free 120' });
const oneBasedGlobalWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%202&mode=all');
oneBasedGlobalWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 2,
          blockCount: 2,
          totalQuestions: 80,
          itemList: oneBasedGlobalAngularItems,
          currentItem: oneBasedGlobalAngularItems[40],
        },
      }),
    }),
  }),
};
const oneBasedGlobalState = createWebfredSiteAdapter({ window: oneBasedGlobalWindow, document: oneBasedGlobalDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(oneBasedGlobalState.itemList[0].componentId, 'global-onebased-component-41');
assert.equal(oneBasedGlobalState.itemList[0].itemIndex, 1, 'global one-based Angular indexes rebase to current block without dropping first item');
assert.equal(oneBasedGlobalState.itemList[39].itemIndex, 40);
assert.equal(oneBasedGlobalState.currentItem.questionId, oneBasedGlobalState.itemList[0].questionId, 'DOM current item does not replace first item with stale global-index identity');
assert.equal(oneBasedGlobalState.currentItem.itemIndex, 1);

const answerArrayItems = [
  Object.freeze({ questionId: 'array-b2-q1', componentId: 'array-component-1', medleyId: 'array-medley', blockNumber: 2, itemIndex: 1 }),
  Object.freeze({ questionId: 'array-b2-q2', componentId: 'array-component-2', medleyId: 'array-medley', blockNumber: 2, itemIndex: 2 }),
  Object.freeze({ questionId: 'array-b2-q3', componentId: 'array-component-3', medleyId: 'array-medley', blockNumber: 2, itemIndex: 3 }),
];
const answerArrayNavItems = answerArrayItems.map((_entry, index) => el(
  'li',
  index === 0 ? { class: 'currentitem', 'aria-current': 'true' } : {},
  [el('span', { class: 'index' }, [String(index + 1)])]
));
const answerArrayBody = el('main', {}, [
  el('nav', {}, [el('ol', { id: 'leftnav' }, answerArrayNavItems)]),
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley-answer-array', 'data-medley-id': 'array-medley' }, [
    el('div', { id: 'answer-array-q1', 'data-component-id': 'array-component-1', 'data-item-index': '1' }, [
      el('div', { class: 'NBExposition' }, ['Array answer stem']),
      el('div', { id: 'answer-array-q1_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
    ]),
  ])])]),
  el('div', {}, ['Block 2 of 2']),
]);
const answerArrayDocument = createFakeDocument(answerArrayBody, { title: 'Synthetic Step 1 Free 120' });
const answerArrayWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%202');
answerArrayWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 2,
          blockCount: 2,
          itemCount: 3,
          itemList: answerArrayItems,
          currentItem: answerArrayItems[0],
          answers: ['A', '', 'C'],
          marks: [false, true, false],
        },
      }),
    }),
  }),
};
const answerArrayState = createWebfredSiteAdapter({ window: answerArrayWindow, document: answerArrayDocument, logger: { debug() {}, warn() {} } }).readState();
assert.deepEqual(answerArrayState.answers, {
  [answerArrayState.itemList[0].questionId]: 'A',
  [answerArrayState.itemList[2].questionId]: 'C',
}, 'same-length current-block answer arrays map by item index');
assert.deepEqual(answerArrayState.marks, { [answerArrayState.itemList[1].questionId]: true }, 'same-length current-block mark arrays map by item index');

const answerObjectWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%202');
answerObjectWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 2,
          blockCount: 2,
          itemCount: 3,
          itemList: answerArrayItems,
          currentItem: answerArrayItems[0],
          answers: { 1: 'A', 2: '', 3: 'C' },
          marks: { 1: false, 2: true, 3: false },
        },
      }),
    }),
  }),
};
const answerObjectState = createWebfredSiteAdapter({ window: answerObjectWindow, document: answerArrayDocument, logger: { debug() {}, warn() {} } }).readState();
assert.deepEqual(answerObjectState.answers, {
  [answerObjectState.itemList[0].questionId]: 'A',
  [answerObjectState.itemList[2].questionId]: 'C',
}, 'dense numeric current-block answer maps map by item index');
assert.deepEqual(answerObjectState.marks, { [answerObjectState.itemList[1].questionId]: true }, 'dense numeric current-block mark maps map by item index');

const staleAnswerObjectWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%202');
staleAnswerObjectWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 2,
          blockCount: 2,
          itemCount: 3,
          itemList: answerArrayItems,
          currentItem: answerArrayItems[0],
          answers: { 41: 'A', 42: 'B', 43: 'C' },
          marks: { 41: true },
        },
      }),
    }),
  }),
};
const staleAnswerObjectState = createWebfredSiteAdapter({ window: staleAnswerObjectWindow, document: answerArrayDocument, logger: { debug() {}, warn() {} } }).readState();
assert.deepEqual(staleAnswerObjectState.answers, {}, 'non-current numeric answer maps do not import stale cross-block answers');
assert.deepEqual(staleAnswerObjectState.marks, {}, 'non-current numeric mark maps do not import stale cross-block marks');

const sparseAnswerObjectWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%202');
sparseAnswerObjectWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 2,
          blockCount: 2,
          itemCount: 3,
          itemList: answerArrayItems,
          currentItem: { ...answerArrayItems[2], selectedAnswerId: 'C' },
          answers: { 1: 'A', 3: 'C' },
        },
      }),
    }),
  }),
};
const sparseAnswerObjectState = createWebfredSiteAdapter({ window: sparseAnswerObjectWindow, document: answerArrayDocument, logger: { debug() {}, warn() {} } }).readState();
assert.deepEqual(sparseAnswerObjectState.answers, {
  [sparseAnswerObjectState.itemList[0].questionId]: 'A',
  [sparseAnswerObjectState.itemList[2].questionId]: 'C',
}, 'sparse numeric current-block answer maps map by verified current item index');

const valueOnlyAngularItems = Array.from({ length: 40 }, (_entry, index) => ({
  questionId: `value-only-q${index + 1}`,
  componentId: `value-only-component-${index + 1}`,
  medleyId: 'value-only-medley',
  itemIndex: index + 1,
  value: `template-value-${index + 1}`,
  answered: false,
}));
const valueOnlyChoiceRows = el('ol', { class: 'options' }, [
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'value-only-q40', value: 'A' }), el('span', {}, ['Synthetic A'])]),
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'value-only-q40', value: 'B' }), el('span', {}, ['Synthetic B'])]),
]);
const valueOnlyNavItems = Array.from({ length: 40 }, (_entry, index) => el(
  'li',
  index === 39 ? { class: 'currentitem', 'aria-current': 'true' } : {},
  [el('span', { class: 'index' }, [String(index + 1)])]
));
const valueOnlyBody = el('main', {}, [
  el('nav', {}, [el('ol', { id: 'leftnav' }, valueOnlyNavItems)]),
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'value-only-medley', 'data-medley-id': 'value-only-medley' }, [
    el('div', { id: 'value-only-q40', 'data-component-id': 'value-only-component-40', 'data-item-index': '40' }, [
      el('div', { class: 'NBExposition' }, ['Value-only current stem']),
      el('div', { id: 'value-only-q40_div', class: 'NBOptionListComp answerbox' }, [valueOnlyChoiceRows]),
    ]),
  ])])]),
  el('div', {}, ['Block 1 of 1']),
]);
const valueOnlyDocument = createFakeDocument(valueOnlyBody, { title: 'Synthetic Step 1 Free 120' });
const valueOnlyWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201');
valueOnlyWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 1,
          blockCount: 1,
          itemCount: 40,
          itemList: valueOnlyAngularItems,
          currentItem: valueOnlyAngularItems[39],
        },
      }),
    }),
  }),
};
const valueOnlyState = createWebfredSiteAdapter({ window: valueOnlyWindow, document: valueOnlyDocument, logger: { debug() {}, warn() {} } }).readState();
assert.deepEqual(valueOnlyState.answers, {}, 'Angular item value fields are metadata, not selected answers');
assert.equal(valueOnlyState.currentItem.selectedAnswerId, '', 'current item without selected response stays unanswered');
assert.equal(valueOnlyState.itemList.some((entry) => entry.selectedAnswerId), false, 'value-only item list does not mark review items answered');

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
const qbankKeyResult = Object.freeze({
  correctAnswers: Object.freeze({ q1: 'A', q2: 'C' }),
  snapshotsByQuestionId: Object.freeze({
    q1: Object.freeze({
      questionId: 'q1',
      renderedHtml: item.outerHTML,
      promptHtml: '<div class="NBExposition">Synthetic stem</div>',
      choices,
      resourceUrls: Object.freeze(['https://example.test/synthetic.png']),
      metadata: Object.freeze({ qbankCacheAttemptId: 'qbank-cache:synthetic', qbankCacheOriginalQuestionId: 'qbank-q1', qbankCacheMatchSource: 'component-medley' }),
      snapshot: Object.freeze({ qbankCache: Object.freeze({ sessionId: 'synthetic-session' }) }),
    }),
  }),
  summary: Object.freeze({ status: ANSWER_KEY_CAPTURE_STATUS.COMPLETE, source: 'qbank-cache', expectedCount: 2, knownCount: 2, unknownCount: 0 }),
  source: Object.freeze({ status: ANSWER_KEY_CAPTURE_STATUS.COMPLETE, source: 'qbank-cache', matchedQuestionIds: Object.freeze(['q1', 'q2']), unmatchedQuestionIds: Object.freeze([]) }),
});

const partialKeyResult = createAnswerKeyCaptureResult(createSyntheticAnswerKeyRecords().slice(0, 1), createIncompleteAnswerKeyState(), { expectedCount: 3 });
assert.equal(partialKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.PARTIAL);
assert.equal(partialKeyResult.summary.unknownCount, 2);
const failedKeyResult = createFailedAnswerKeyCaptureResult(adapterState, { attemptId: 'attempt-adapter', expectedCount: 3 }, new Error('synthetic failure'));
assert.equal(failedKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.FAILED);
assert.equal(failedKeyResult.summary.failureReason, 'capture-error');
assert.match(failedKeyResult.lastError, /synthetic failure/);
const noMetadataKeyResult = createAnswerKeyCaptureResult([], adapterState, { attemptId: 'attempt-adapter', expectedCount: 3 });
assert.equal(noMetadataKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.FAILED);
assert.equal(noMetadataKeyResult.summary.failureReason, 'no-correct-answer-metadata');
const identityMismatchKeyResult = createAnswerKeyCaptureResult([
  { questionId: 'unknown-q', correctAnswerId: 'A', confidence: 'high', captureSource: ANSWER_KEY_CAPTURE_SOURCE.ANGULAR_BULK },
], adapterState, { attemptId: 'attempt-adapter', expectedCount: 3 });
assert.equal(identityMismatchKeyResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.FAILED);
assert.equal(identityMismatchKeyResult.summary.failureReason, 'answer-key-identity-mismatch');

const staleCaptureState = createSyntheticAdapterState({
  answers: Object.freeze({ q1: 'A' }),
});
const freshCaptureState = createSyntheticAdapterState({
  answers: Object.freeze({ q1: 'B' }),
  currentItem: Object.freeze({ ...adapterState.currentItem, selectedAnswerId: 'B' }),
  itemList: Object.freeze([
    Object.freeze({ ...adapterState.itemList[0], selectedAnswerId: 'B' }),
    ...adapterState.itemList.slice(1),
  ]),
});
const refreshingCaptureController = createAnswerKeyCaptureController({
  window: fakeWindow,
  document: fakeDocument,
  logger: { debug() {}, warn() {} },
  webfredAdapter: {
    waitForInitialization: async () => freshCaptureState,
    getAngularServices: () => null,
    getLastState: () => freshCaptureState,
    readState: () => freshCaptureState,
  },
});
const refreshedCaptureResult = await refreshingCaptureController.captureOnce({ adapterState: staleCaptureState, expectedCount: 1 });
assert.equal(refreshedCaptureResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.COMPLETE);
assert.equal(refreshingCaptureController.getLastError(), null);

const dedupedTrackingItems = getTrackingItemList(createSyntheticAdapterState({
  currentBlock: 1,
  itemCount: 1,
  currentItem: Object.freeze({ questionId: 'trusted-q1', componentId: 'component-q1', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: 'B', current: true }),
  itemList: Object.freeze([
    Object.freeze({ questionId: 'webfred:untrusted:legacy', blockNumber: 1, itemIndex: 1, current: true }),
  ]),
  answers: Object.freeze({ 'trusted-q1': 'B' }),
}));
assert.equal(dedupedTrackingItems.length, 1, 'trusted current item replaces same-position untrusted fallback item');
assert.equal(dedupedTrackingItems[0].questionId, 'trusted-q1');
assert.equal(dedupedTrackingItems[0].selectedAnswerId, 'B');

const keyPageNav = el('nav', {}, [el('ol', { id: 'leftnav' }, [
  el('li', {}, [el('span', { class: 'index' }, ['1'])]),
  el('li', {}, [el('span', { class: 'index' }, ['2'])]),
  el('li', {}, [el('span', { class: 'index' }, ['3'])]),
  el('li', { class: 'currentitem keyitem', 'aria-current': 'true' }, [el('span', { class: 'index' }, ['Key'])]),
])]);
const keyPageBody = el('main', {}, [
  keyPageNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [
    el('div', { id: 'answer-key' }, ['Answer Key 1. A 2. C 3. B']),
  ])]),
  el('div', {}, ['Block 1 of 1']),
]);
const keyPageDocument = createFakeDocument(keyPageBody, { title: 'Synthetic Key Page' });
const keyPageWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201');
const keyPageState = createSyntheticAdapterState({
  currentItem: null,
  answers: Object.freeze({}),
  capabilities: Object.freeze({ ...adapterState.capabilities, hasAnswers: false }),
});
const keyPageCaptureController = createAnswerKeyCaptureController({
  window: keyPageWindow,
  document: keyPageDocument,
  logger: { debug() {}, warn() {} },
  webfredAdapter: {
    waitForInitialization: async () => keyPageState,
    getAngularServices: () => null,
    getLastState: () => keyPageState,
    readState: () => keyPageState,
  },
});
const keyPageCaptureResult = await keyPageCaptureController.captureOnce({ adapterState: keyPageState, expectedCount: 3 });
assert.equal(keyPageCaptureResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.COMPLETE);
assert.equal(keyPageCaptureResult.summary.source, ANSWER_KEY_CAPTURE_SOURCE.DOM_KEY_PAGE);
assert.deepEqual(keyPageCaptureResult.correctAnswers, { q1: 'A', q2: 'C', q3: 'B' });

let bulkKeyCalls = 0;
const bulkKeyHrefBefore = fakeWindow.location.href;
const bulkKeyCaptureController = createAnswerKeyCaptureController({
  window: fakeWindow,
  document: fakeDocument,
  logger: { debug() {}, warn() {} },
  webfredAdapter: {
    waitForInitialization: async () => adapterState,
    getAngularServices: () => ({
      services: {
        dataService: {
          getContentBulk: async () => {
            bulkKeyCalls += 1;
            return {
              q1: '<div class="NBSinglePage"><div class="NBExposition">Question only</div></div>',
              '1Blk1Key_F_E': '<div class="NBMultiDistinctPage"><p>Answer Key for Block 1</p><table><tr><td>1. A</td><td>2. C</td><td>3. B</td></tr></table></div>',
            };
          },
        },
      },
      resolvedNames: ['dataService'],
    }),
    getLastState: () => adapterState,
    readState: () => adapterState,
  },
});
const bulkKeyCaptureResult = await bulkKeyCaptureController.captureOnce({ adapterState, expectedCount: 3 });
assert.equal(bulkKeyCalls, 1);
assert.equal(fakeWindow.location.href, bulkKeyHrefBefore);
assert.equal(bulkKeyCaptureResult.summary.status, ANSWER_KEY_CAPTURE_STATUS.COMPLETE);
assert.equal(bulkKeyCaptureResult.summary.source, ANSWER_KEY_CAPTURE_SOURCE.ANGULAR_BULK);
assert.deepEqual(bulkKeyCaptureResult.correctAnswers, { q1: 'A', q2: 'C', q3: 'B' });

const attempt = createSyntheticAttempt({ id: 'attempt-adapter' });
const trackingSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState,
  item: adapterState.currentItem,
  itemList: adapterState.itemList,
  timingByQuestionId: { q1: { totalMs: 1234 } },
  qbankCaptureResult: qbankKeyResult,
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

const liveFallbackTrackingSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState,
  item: adapterState.currentItem,
  itemList: adapterState.itemList,
  timingByQuestionId: { q1: { totalMs: 1234 } },
  qbankCaptureResult: null,
  root: item,
  document: fakeDocument,
});
assert.match(liveFallbackTrackingSnapshot.renderedHtml, /Synthetic stem/, 'live DOM snapshot keeps question content when qbank cache is unavailable');
assert.equal(liveFallbackTrackingSnapshot.choices.length, 3, 'live snapshot choices keep review option rows without qbank cache');
assert.equal(liveFallbackTrackingSnapshot.selectedAnswerId, 'A', 'live snapshot records selected answer without qbank cache');
assert.equal(liveFallbackTrackingSnapshot.metadata.questionContentSource, 'dom-current-item');

const patch = buildTrackingAttemptPatch(
  attempt,
  adapterState,
  adapterState.itemList,
  adapterState.currentItem,
  { responses: { q1: 'A', q2: 'B' }, changes: [{ questionId: 'q1', fromAnswerId: '', toAnswerId: 'A', item: adapterState.currentItem }] },
  { q1: { totalMs: 1234, blockNumber: 1, itemIndex: 1 } },
  ['q2'],
  qbankKeyResult,
  'synthetic-update'
);
assert.equal(patch.questionCount, 3);
assert.equal(patch.responses.q2, 'B');
assert.equal(patch.correctAnswers.q2, 'C');
assert.equal(patch.answerKeyCapture.source, 'qbank-cache');
assert.equal(patch.markedQuestionIds[0], 'q2');
assert.equal(patch.source.progress.overall.answered, 2);
assert.equal(patch.source.itemMetadataByQuestionId.q1.componentId, 'component-q1');
assert.equal(patch.answerTimeline.length, 1);

const scopedBlockOneItems = Array.from({ length: 40 }, (_item, index) => {
  const itemIdentity = buildQuestionIdentity({ examProgram: 'Step 1', examName: 'Free 120', medleyId: 'shared-medley', componentId: `component-${index + 1}`, blockNumber: 1, itemIndex: index + 1 });
  return Object.freeze({ questionId: itemIdentity.questionId, componentId: itemIdentity.componentId, medleyId: itemIdentity.medleyId, blockNumber: 1, itemIndex: index + 1 });
});
const scopedBlockTwoItems = Array.from({ length: 40 }, (_item, index) => {
  const itemIdentity = buildQuestionIdentity({ examProgram: 'Step 1', examName: 'Free 120', medleyId: 'shared-medley', componentId: `component-${index + 1}`, blockNumber: 2, itemIndex: index + 1 });
  return Object.freeze({ questionId: itemIdentity.questionId, componentId: itemIdentity.componentId, medleyId: itemIdentity.medleyId, blockNumber: 2, itemIndex: index + 1 });
});
const scopedPatch = buildTrackingAttemptPatch(
  createSyntheticAttempt({
    id: 'attempt-scoped-blocks',
    questionIds: scopedBlockOneItems.map((entry) => entry.questionId),
    questionCount: 40,
    responses: Object.fromEntries(scopedBlockOneItems.slice(0, 3).map((entry) => [entry.questionId, 'A'])),
    launchedScope: Object.freeze({ mode: 'test', block: '2' }),
  }),
  createSyntheticAdapterState({
    currentBlock: 2,
    itemCount: 40,
    currentItem: Object.freeze({ ...scopedBlockTwoItems[0], current: true }),
    itemList: Object.freeze(scopedBlockTwoItems),
    answers: Object.freeze({}),
    marks: Object.freeze({}),
  }),
  scopedBlockTwoItems,
  scopedBlockTwoItems[0],
  { responses: Object.fromEntries(scopedBlockOneItems.slice(0, 3).map((entry) => [entry.questionId, 'A'])), changes: [] },
  {},
  [],
  null,
  'scoped-block-start'
);
assert.equal(scopedPatch.questionCount, 40, 'new scoped block starts with current block count only');
assert.equal(scopedPatch.source.progress.byBlock[2].answered, 0, 'new scoped block does not count previous block answers');
assert.equal(scopedPatch.source.progress.byBlock[2].total, 40);
assert.deepEqual(scopedPatch.questionIds, scopedBlockTwoItems.map((entry) => entry.questionId));
assert.equal(Object.keys(scopedPatch.responses).length, 0);

const rekeyedCurrentBlockItems = Array.from({ length: 3 }, (_item, index) => Object.freeze({
  questionId: `new-b2-q${index + 1}`,
  componentId: `shared-component-${index + 1}`,
  medleyId: 'shared-medley',
  blockNumber: 2,
  itemIndex: index + 1,
}));
const rekeyedPatch = buildTrackingAttemptPatch(
  createSyntheticAttempt({
    id: 'attempt-rekeyed-current-block',
    launchedScope: Object.freeze({ mode: 'test', block: '2' }),
    questionIds: ['legacy-b2-q1', 'legacy-b2-q2', 'legacy-b2-q3'],
    questionCount: 3,
    responses: { 'legacy-b2-q1': 'A', 'legacy-b2-q2': 'B' },
    source: Object.freeze({
      itemMetadataByQuestionId: Object.freeze({
        'legacy-b2-q1': Object.freeze({ questionId: 'legacy-b2-q1', blockNumber: 2, itemIndex: 1, componentId: 'shared-component-1', medleyId: 'shared-medley' }),
        'legacy-b2-q2': Object.freeze({ questionId: 'legacy-b2-q2', blockNumber: 2, itemIndex: 2, componentId: 'shared-component-2', medleyId: 'shared-medley' }),
        'legacy-b2-q3': Object.freeze({ questionId: 'legacy-b2-q3', blockNumber: 2, itemIndex: 3, componentId: 'shared-component-3', medleyId: 'shared-medley' }),
      }),
    }),
  }),
  createSyntheticAdapterState({
    currentBlock: 2,
    itemCount: 3,
    currentItem: Object.freeze({ ...rekeyedCurrentBlockItems[2], selectedAnswerId: 'C', current: true }),
    itemList: Object.freeze(rekeyedCurrentBlockItems),
    answers: Object.freeze({ 'new-b2-q3': 'C' }),
    marks: Object.freeze({}),
  }),
  rekeyedCurrentBlockItems,
  rekeyedCurrentBlockItems[2],
  { responses: { 'legacy-b2-q1': 'A', 'legacy-b2-q2': 'B', 'new-b2-q3': 'C' }, changes: [] },
  {},
  [],
  null,
  'rekeyed-current-block'
);
assert.deepEqual(rekeyedPatch.responses, {
  'new-b2-q1': 'A',
  'new-b2-q2': 'B',
  'new-b2-q3': 'C',
}, 'current-block answers survive question-id rekeying');
assert.equal(rekeyedPatch.source.progress.byBlock[2].answered, 3);
assert.equal(rekeyedPatch.source.responseAliases.byPosition['2\u00001'], 'A');
assert.equal(rekeyedPatch.source.responseAliases.byComponent['2\u0000shared-medley\u0000shared-component-2'], 'B');

const aliasRecoveredPatch = buildTrackingAttemptPatch(
  createSyntheticAttempt({
    id: 'attempt-response-alias-recovery',
    launchedScope: Object.freeze({ mode: 'test', block: '2' }),
    questionIds: rekeyedCurrentBlockItems.map((entry) => entry.questionId),
    questionCount: 3,
    responses: { 'new-b2-q3': 'C' },
    source: Object.freeze({
      responseAliases: Object.freeze({
        byPosition: Object.freeze({ '2\u00001': 'A', '2\u00002': 'B' }),
        byComponent: Object.freeze({}),
      }),
      itemMetadataByQuestionId: Object.freeze(Object.fromEntries(rekeyedCurrentBlockItems.map((entry) => [entry.questionId, entry]))),
    }),
  }),
  createSyntheticAdapterState({
    currentBlock: 2,
    itemCount: 3,
    currentItem: Object.freeze({ ...rekeyedCurrentBlockItems[2], selectedAnswerId: 'C', current: true }),
    itemList: Object.freeze(rekeyedCurrentBlockItems),
    answers: Object.freeze({ 'new-b2-q3': 'C' }),
    marks: Object.freeze({}),
  }),
  rekeyedCurrentBlockItems,
  rekeyedCurrentBlockItems[2],
  { responses: { 'new-b2-q3': 'C' }, changes: [] },
  {},
  [],
  null,
  'alias-recovered-current-block'
);
assert.deepEqual(aliasRecoveredPatch.responses, {
  'new-b2-q1': 'A',
  'new-b2-q2': 'B',
  'new-b2-q3': 'C',
}, 'stored response aliases recover non-current answers when adapter only reports current answer');

const staleQuestionIdItemList = [
  Object.freeze({ questionId: 'webfred:Step-1:Free-120:Block-1:shared-medley:component-1', componentId: 'component-1', medleyId: 'shared-medley', blockNumber: 2, itemIndex: 1 }),
  Object.freeze({ questionId: 'webfred:Step-1:Free-120:Block-1:shared-medley:component-2', componentId: 'component-2', medleyId: 'shared-medley', blockNumber: 2, itemIndex: 2 }),
];
const repairedTrackingItems = getTrackingItemList(createSyntheticAdapterState({
  examIdentity: Object.freeze({ program: 'Step 1', examName: 'Free 120', section: '' }),
  currentBlock: 2,
  itemCount: 2,
  currentItem: Object.freeze({ ...staleQuestionIdItemList[0], current: true }),
  itemList: Object.freeze(staleQuestionIdItemList),
  answers: Object.freeze({}),
  marks: Object.freeze({}),
}));
assert.deepEqual(repairedTrackingItems.map((entry) => entry.questionId), [
  'webfred:Step-1:Free-120:Block-2:shared-medley:component-1',
  'webfred:Step-1:Free-120:Block-2:shared-medley:component-2',
], 'tracking repairs stale question ids after block/index rebasing');

console.log('adapter, key capture, and tracking tests passed');
