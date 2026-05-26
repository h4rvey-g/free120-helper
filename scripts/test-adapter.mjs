import assert from 'node:assert/strict';
import { ANSWER_KEY_CAPTURE_STATUS, ATTEMPT_STATUS } from '../src/core/constants.js';
import { createTrackingEngine, createTrackingQuestionSnapshot, getTrackingItemList, buildTrackingAttemptPatch } from '../src/tracking/engine.js';
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
  createSyntheticAdapterState,
  createSyntheticAttempt,
} from './test-utils/fixtures.mjs';
import { createFakeDocument, createFakeWindow, el } from './test-utils/fake-dom.mjs';

const choiceRows = el('ol', { class: 'options' }, [
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'q1', value: 'A', checked: true }), el('span', {}, ['Synthetic A'])]),
  el('li', { class: 'stContext correct' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'q1', value: 'B' }), el('span', { style: 'text-decoration: line-through' }, ['Synthetic B'])]),
]);
const item = el('div', { id: 'item-q1', 'data-component-id': 'component-q1', 'data-item-index': '1' }, [
  el('div', { class: 'NBExposition' }, ['Synthetic stem']),
  el('div', { id: 'q1_div', class: 'NBOptionListComp answerbox', 'data-correct-answer': 'B' }, [choiceRows]),
  el('textarea', {}, ['Synthetic note']),
  el('mark', {}, ['Synthetic highlight']),
  el('img', { src: 'https://example.test/synthetic.png' }),
  el('video', { 'data-src': 'api/Resource?name=synthetic.webm' }),
  el('div', { style: 'background-image: url(api/Resource?name=background.gif)' }, []),
]);
const medley = el('div', { id: 'medley-1', 'data-medley-id': 'medley-1' }, [item]);
const nav = el('nav', {}, [el('ol', { id: 'leftnav' }, [
  el('li', { class: 'currentitem', 'aria-current': 'true' }, [el('span', { class: 'index' }, ['1'])]),
  el('li', {}, [el('span', { class: 'index' }, ['2'])]),
  el('li', { class: 'keyitem' }, [el('span', { class: 'index' }, ['Key'])]),
])]);
const body = el('main', {}, [nav, el('section', { id: 'item' }, [el('article', { id: 'content' }, [medley])]), el('div', {}, ['Block 1 of 1'])]);
const fakeWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201');
const fakeDocument = createFakeDocument(body, { title: 'Synthetic Step 1 Free 120', defaultView: fakeWindow });
fakeWindow.document = fakeDocument;
const genericDriverWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=USMLE&exam=NBME%20Exam%20Driver&section=Step%201%20Block%202&block=2&mode=test');
const genericDriverDocument = createFakeDocument(body, { title: 'NBME Exam Driver', defaultView: genericDriverWindow });
genericDriverWindow.document = genericDriverDocument;

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
assert.deepEqual(extractResourceUrls(item), ['https://example.test/synthetic.png', 'api/Resource?name=synthetic.webm', 'api/Resource?name=background.gif']);

const content = extractCurrentContentFromDom(item);
assert.match(content.renderedHtml, /NBExposition/);
assert.match(content.answerBoxHtml, /Synthetic A/);
assert.equal(content.choices.length, 2);
assert.match(content.renderedHtml, /synthetic\.webm/, 'DOM content snapshot keeps media resources');

const mediaSiblingItem = el('div', { id: 'item-media-sibling', 'data-component-id': 'component-media', 'data-item-index': '1' }, [
  el('div', { class: 'NBExposition' }, ['Media sibling stem']),
  el('div', { id: 'media_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
]);
const mediaSiblingPage = el('div', { id: 'page1' }, [
  mediaSiblingItem,
  el('div', { id: 'media1' }, [el('div', { class: 'NBMediaPlayer' }, [el('div', { class: 'media-player', 'data-media-id': '097247' }, []), el('video', { src: 'api/Resource?name=sibling.webm' })])]),
]);
const mediaSiblingContent = extractCurrentContentFromDom(mediaSiblingItem);
assert.match(mediaSiblingContent.renderedHtml, /NBMediaPlayer/, 'DOM content snapshot expands to sibling WebFRED media player');
assert.deepEqual(mediaSiblingContent.resourceUrls, ['api/Resource?name=sibling.webm']);
const mediaSiblingDocument = createFakeDocument(el('main', {}, [
  el('nav', {}, [el('ol', { id: 'leftnav' }, [el('li', { class: 'currentitem', 'aria-current': 'true' }, [el('span', { class: 'index' }, ['40'])])])]),
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley' }, [mediaSiblingPage])])]),
  el('div', {}, ['Block 3 of 3']),
]), { title: 'NBME Exam Driver' });
const mediaSiblingWindow = createFakeWindow('https://orientation.nbme.org/webfred/#!/main');
mediaSiblingWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          exam: {
            config: { programName: 'USMLE' },
            blockInfo: { currentBlock: 0, blockCount: 1, blockMap: [{ name: 'STPF1C0139D1A1', numberOfItems: 40, caption: 'Exam Section' }] },
            items: Array.from({ length: 40 }, (_entry, index) => ({ componentId: `ANG${index + 1}`, medleyId: `AMED${index + 1}` })),
            currItem: { componentId: 'ANG1', medleyId: 'AMED1' },
          },
        },
      }),
    }),
  }),
};
const mediaSiblingState = createWebfredSiteAdapter({ window: mediaSiblingWindow, document: mediaSiblingDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(mediaSiblingState.currentContent.resourceUrls[0], 'api/Resource?name=sibling.webm');
assert.equal(mediaSiblingState.currentItem.componentId, 'component-media', 'merged state prefers DOM identity when DOM content carries associated media');

const realNbmeZeroBasedItems = Array.from({ length: 40 }, (_entry, index) => ({
  componentId: `real-component-${index + 1}`,
  medleyId: `real-medley-${index + 1}`,
  itemIndex: index,
  displayableName: String(index + 1),
  complete: index === 0,
  currentResponse: index === 0 ? 'B' : '',
}));
const realNbmeZeroBasedNav = el('nav', {}, [el('ol', { id: 'leftnav' }, Array.from({ length: 41 }, (_entry, index) => (
  el('li', index === 40 ? { class: 'keyitem' } : (index === 0 ? { class: 'currentitem', 'aria-current': 'true' } : {}), [
    el('span', { class: `ans_status ${index === 0 ? 'complete' : ''}` }),
    el('span', { class: 'index' }, [index === 40 ? 'Key' : String(index + 1)]),
  ])
)))]);
const realNbmeZeroBasedBody = el('main', {}, [
  realNbmeZeroBasedNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley', 'data-medley-id': 'real-medley-1' }, [
    el('div', { id: 'real-item-1', 'data-component-id': 'real-component-1', 'data-item-index': '1' }, [
      el('div', { class: 'NBExposition' }, ['Real NBME zero-based stem']),
      el('div', { id: 'real-component-1_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
    ]),
  ])])]),
  el('div', {}, ['Block 1 of 1']),
]);
const realNbmeZeroBasedDocument = createFakeDocument(realNbmeZeroBasedBody, { title: 'NBME Exam Driver' });
const realNbmeZeroBasedWindow = createFakeWindow('https://orientation.nbme.org/webfred/#!/main');
realNbmeZeroBasedWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'itemService',
      get: () => ({
        items: realNbmeZeroBasedItems,
        answers: {
          'real-component-1': { answer: 'B', locked: false, hidden: false },
          'real-component-2': { answer: '', locked: false, hidden: false },
        },
        currItem: { compID: 'real-component-1', medleyId: 'real-medley-1', itemIndex: 0, index: 0, answer: 'B', complete: true },
        blockInfo: { currentBlock: 1, blockCount: 1, blockMap: [{ name: 'STPF1C0139D1A1', numberOfItems: 40, caption: 'Exam Section' }] },
        config: { programName: 'USMLE' },
      }),
    }),
  }),
};
const realNbmeZeroBasedState = createWebfredSiteAdapter({ window: realNbmeZeroBasedWindow, document: realNbmeZeroBasedDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(realNbmeZeroBasedState.itemList[0].itemIndex, 1, 'real NBME zero-based itemIndex 0 normalizes to review item 1');
assert.equal(realNbmeZeroBasedState.itemList[1].itemIndex, 2, 'real NBME zero-based itemIndex 1 normalizes to review item 2');
assert.equal(realNbmeZeroBasedState.currentItem.questionId, realNbmeZeroBasedState.itemList[0].questionId, 'real NBME current item keeps trusted Angular identity');
assert.equal(realNbmeZeroBasedState.currentItem.selectedAnswerId, 'B', 'real NBME currentResponse is captured as selected answer');
assert.equal(realNbmeZeroBasedState.answers[realNbmeZeroBasedState.itemList[0].questionId], 'B', 'real NBME answer maps component-key answer object to trusted question id');

const step3MultipageSetItems = [
  { componentId: 'step3-component-1', medleyId: 'step3-medley-1', itemIndex: 0, displayableName: '\u00a01', answerable: true },
  { componentId: 'step3-component-2', medleyId: 'step3-medley-2', itemIndex: 1, displayableName: '\u00a02', answerable: true },
  { componentId: 'step3-set-component-1', medleyId: 'step3-set-medley', itemIndex: 1, subItemIndex: 0, displayableName: '\u00a03', setType: 'first-in-set', answerable: true },
  { componentId: 'step3-set-component-2', medleyId: 'step3-set-medley', itemIndex: 1, subItemIndex: 1, displayableName: '\u00a04', setType: 'last-in-set', hidden: true, answerable: true },
  { componentId: 'step3-component-5', medleyId: 'step3-medley-5', itemIndex: 2, displayableName: '\u00a05', answerable: true },
  { componentId: '', medleyId: 'step3-key-medley', itemIndex: 3, displayableName: 'Key', answerable: false },
];
const step3MultipageSetNav = el('nav', {}, [el('ol', { id: 'leftnav' }, Array.from({ length: 5 }, (_entry, index) => (
  el('li', index === 0 ? { class: 'currentitem', 'aria-current': 'true' } : {}, [el('span', { class: 'index' }, [String(index + 1)])])
)))]);
const step3MultipageSetBody = el('main', {}, [
  step3MultipageSetNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'step3-medley-1', 'data-medley-id': 'step3-medley-1' }, [
    el('div', { id: 'step3-item-1', 'data-component-id': 'step3-component-1' }, [
      el('div', { class: 'NBExposition' }, ['Step 3 multipage set stem']),
      el('div', { id: 'step3-component-1_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
    ]),
  ])])]),
  el('div', {}, ['Block 1 of 1']),
]);
const step3MultipageSetDocument = createFakeDocument(step3MultipageSetBody, { title: 'NBME Exam Driver' });
const step3MultipageSetWindow = createFakeWindow('https://orientation.nbme.org/webfred/#!/main');
step3MultipageSetWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'itemService',
      get: () => ({
        items: step3MultipageSetItems,
        currItem: step3MultipageSetItems[0],
        blockInfo: { currentBlock: 0, blockCount: 1, blockMap: [{ name: 'STPF3C0332D1A1', numberOfItems: 5, caption: 'FIP' }] },
        config: { programName: 'USMLE' },
      }),
    }),
  }),
};
const step3MultipageSetState = createWebfredSiteAdapter({ window: step3MultipageSetWindow, document: step3MultipageSetDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(step3MultipageSetState.itemList.length, 5, 'Step 3 multipage set keeps every answerable displayed item and excludes answer key');
assert.deepEqual(step3MultipageSetState.itemList.map((entry) => entry.itemIndex), [1, 2, 3, 4, 5], 'Step 3 multipage set display numbers override repeated raw itemIndex values');
assert.deepEqual(step3MultipageSetState.itemList.map((entry) => entry.componentId), ['step3-component-1', 'step3-component-2', 'step3-set-component-1', 'step3-set-component-2', 'step3-component-5']);
assert.equal(new Set(step3MultipageSetState.itemList.map((entry) => `${entry.blockNumber}:${entry.itemIndex}`)).size, 5, 'Step 3 multipage set positions are unique for review mode');

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

const blockCodeItems = Array.from({ length: 40 }, (_entry, index) => ({
  componentId: `block-code-component-${index + 1}`,
  medleyId: `block-code-medley-${index + 1}`,
}));
const blockCodeNav = el('nav', {}, [el('ol', { id: 'leftnav' }, Array.from({ length: 40 }, (_entry, index) => (
  el('li', index === 0 ? { class: 'currentitem', 'aria-current': 'true' } : {}, [el('span', { class: 'index' }, [String(index + 1)])])
)))]);
const blockCodeBody = el('main', {}, [
  blockCodeNav,
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley' }, [
    el('div', { id: 'item1' }, [
      el('div', { class: 'NBExposition' }, ['Block-code stem']),
      el('div', { id: 'block-code-component-1_div', class: 'NBOptionListComp answerbox' }, [choiceRows]),
    ]),
  ])])]),
]);
const blockCodeDocument = createFakeDocument(blockCodeBody, { title: 'NBME Exam Driver' });
const blockCodeWindow = createFakeWindow('https://orientation.nbme.org/webfred/#!/main');
blockCodeWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          exam: {
            config: { programName: 'USMLE' },
            blockInfo: { currentBlock: 0, blockCount: 1, blockMap: [{ name: 'STPF1C0139D1A1', numberOfItems: 40, caption: 'Exam Section' }] },
            items: blockCodeItems,
            currItem: blockCodeItems[0],
          },
        },
      }),
    }),
  }),
};
const blockCodeState = createWebfredSiteAdapter({ window: blockCodeWindow, document: blockCodeDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(blockCodeState.currentBlock, 3, 'single-block WebFRED infers launched Step 1 Block 3 from test definition code');
assert.equal(blockCodeState.blockMetadata[0].blockNumber, 3);
assert.equal(blockCodeState.currentItem.blockNumber, 3);
assert.match(blockCodeState.currentItem.questionId, /Block-3/);

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

const falseAnsweredAngularItems = Array.from({ length: 40 }, (_entry, index) => ({
  questionId: `false-answered-q${index + 1}`,
  componentId: `false-answered-component-${index + 1}`,
  medleyId: 'false-answered-medley',
  itemIndex: index + 1,
  selectedAnswerId: index === 5 ? 'B' : (index === 39 ? 'A' : ''),
  answered: index < 5,
}));
falseAnsweredAngularItems[0].selectedAnswerId = 'A';
falseAnsweredAngularItems[1].selectedAnswerId = 'A';
falseAnsweredAngularItems[2].selectedAnswerId = 'A';
falseAnsweredAngularItems[3].selectedAnswerId = 'A';
falseAnsweredAngularItems[4].selectedAnswerId = 'B';
const falseAnsweredRows = el('ol', { class: 'options' }, [
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'false-answered-q5', value: 'A' }), el('span', {}, ['Synthetic A'])]),
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'false-answered-q5', value: 'B', checked: true }), el('span', {}, ['Synthetic B'])]),
]);
const falseAnsweredBody = el('main', {}, [
  el('nav', {}, [el('ol', { id: 'leftnav' }, Array.from({ length: 40 }, (_entry, index) => el(
    'li',
    index === 4 ? { class: 'currentitem answered', 'aria-current': 'true' } : (index < 4 ? { class: 'answered' } : {}),
    [el('span', { class: `ans_status ${index < 5 ? 'answered' : ''}` }), el('span', { class: 'index' }, [String(index + 1)])]
  )))]),
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'false-answered-medley', 'data-medley-id': 'false-answered-medley' }, [
    el('div', { id: 'false-answered-q5', 'data-component-id': 'false-answered-component-5', 'data-item-index': '5' }, [
      el('div', { class: 'NBExposition' }, ['False answered current stem']),
      el('div', { id: 'false-answered-q5_div', class: 'NBOptionListComp answerbox' }, [falseAnsweredRows]),
    ]),
  ])])]),
  el('div', {}, ['Block 1 of 1']),
]);
const falseAnsweredDocument = createFakeDocument(falseAnsweredBody, { title: 'Synthetic Step 1 Free 120' });
const falseAnsweredWindow = createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201');
falseAnsweredWindow.angular = {
  element: () => ({
    injector: () => ({
      has: (name) => name === 'ExamService',
      get: () => ({
        state: {
          currentBlock: 1,
          blockCount: 1,
          itemCount: 40,
          itemList: falseAnsweredAngularItems,
          currentItem: falseAnsweredAngularItems[4],
        },
      }),
    }),
  }),
};
const falseAnsweredState = createWebfredSiteAdapter({ window: falseAnsweredWindow, document: falseAnsweredDocument, logger: { debug() {}, warn() {} } }).readState();
assert.equal(falseAnsweredState.answers[falseAnsweredState.itemList[4].questionId], 'B', 'answered Angular item keeps selected response');
assert.equal(falseAnsweredState.answers[falseAnsweredState.itemList[5].questionId], undefined, 'answered=false blocks stale selected response for Q6');
assert.equal(falseAnsweredState.answers[falseAnsweredState.itemList[39].questionId], undefined, 'answered=false blocks stale selected response for Q40');
assert.equal(falseAnsweredState.itemList[5].selectedAnswerId, '', 'Q6 stale selectedAnswerId is cleared when Angular says unanswered');
assert.equal(falseAnsweredState.itemList[39].selectedAnswerId, '', 'Q40 stale selectedAnswerId is cleared when Angular says unanswered');

const adapterState = createSyntheticAdapterState();
assert.deepEqual(snapshotForAttemptPosition(adapterState), {
  questionId: 'q1',
  blockNumber: 1,
  itemIndex: 1,
  componentId: 'component-q1',
  medleyId: 'medley-1',
  identitySource: 'component-medley',
});

const qbankKeyResult = Object.freeze({
  correctAnswers: Object.freeze({ q1: 'A', q2: 'C' }),
  snapshotsByQuestionId: Object.freeze({
    q1: Object.freeze({
      questionId: 'q1',
      renderedHtml: item.outerHTML,
      promptHtml: '<div class="NBExposition">Synthetic stem</div>',
      choices,
      resourceUrls: Object.freeze(['https://example.test/synthetic.png']),
      resourceDataByUrl: Object.freeze({ 'api/Resource?name=synthetic.webm': 'data:video/webm;base64,AAAA' }),
      metadata: Object.freeze({ qbankCacheAttemptId: 'qbank-cache:synthetic', qbankCacheOriginalQuestionId: 'qbank-q1', qbankCacheMatchSource: 'component-medley' }),
      snapshot: Object.freeze({ qbankCache: Object.freeze({ sessionId: 'synthetic-session' }) }),
    }),
  }),
  summary: Object.freeze({ status: ANSWER_KEY_CAPTURE_STATUS.COMPLETE, source: 'qbank-cache', expectedCount: 2, knownCount: 2, unknownCount: 0 }),
  source: Object.freeze({ status: ANSWER_KEY_CAPTURE_STATUS.COMPLETE, source: 'qbank-cache', matchedQuestionIds: Object.freeze(['q1', 'q2']), unmatchedQuestionIds: Object.freeze([]) }),
});

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
assert.equal(trackingSnapshot.annotations.highlights[0].occurrence, 1);
assert.equal(trackingSnapshot.annotations.strikeouts.length, 1);
assert.equal(trackingSnapshot.annotations.strikeouts[0].optionIndex, 2);
assert.equal(trackingSnapshot.annotations.strikeouts[0].optionAnswerId, 'B');
assert.equal(trackingSnapshot.annotations.strikeouts[0].optionText, 'Synthetic B');
assert.equal(trackingSnapshot.timingMs, 1234);
assert.deepEqual(trackingSnapshot.resourceUrls, ['https://example.test/synthetic.png', 'api/Resource?name=synthetic.webm', 'api/Resource?name=background.gif']);
assert.equal(trackingSnapshot.resourceDataByUrl['api/Resource?name=synthetic.webm'], 'data:video/webm;base64,AAAA');

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
assert.equal(liveFallbackTrackingSnapshot.metadata.questionContentSource, 'adapter-current-content');

const cssOnlyStrikeoutRows = el('ol', { class: 'options' }, [
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'css-strikeout', value: 'A' }), el('span', {}, ['Visible A'])]),
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'css-strikeout', value: 'B' }), el('span', { class: 'NBStrikeoutOnly' }, ['Visible B'])]),
]);
const cssOnlyStrikeoutItem = el('div', { id: 'item-css-strikeout', 'data-component-id': 'component-css-strikeout', 'data-item-index': '1' }, [
  el('div', { class: 'NBExposition' }, ['CSS-only strikeout stem']),
  el('div', { id: 'css_strikeout_div', class: 'NBOptionListComp answerbox' }, [cssOnlyStrikeoutRows]),
]);
const cssOnlyStrikeoutWindow = createFakeWindow();
cssOnlyStrikeoutWindow.getComputedStyle = (element) => ({
  display: 'block',
  visibility: 'visible',
  textDecorationLine: element && element.className === 'NBStrikeoutOnly' ? 'line-through' : 'none',
  textDecoration: element && element.className === 'NBStrikeoutOnly' ? 'line-through' : 'none',
});
const cssOnlyStrikeoutDocument = createFakeDocument(cssOnlyStrikeoutItem, { defaultView: cssOnlyStrikeoutWindow });
cssOnlyStrikeoutWindow.document = cssOnlyStrikeoutDocument;
const cssOnlyStrikeoutState = createSyntheticAdapterState({
  currentItem: Object.freeze({ questionId: 'q-css-strikeout', componentId: 'component-css-strikeout', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: '', marked: false, current: true, identitySource: 'component-medley' }),
  itemList: Object.freeze([Object.freeze({ questionId: 'q-css-strikeout', componentId: 'component-css-strikeout', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: '', current: true, identitySource: 'component-medley' })]),
  currentContent: Object.freeze({
    renderedHtml: cssOnlyStrikeoutItem.outerHTML,
    promptHtml: 'CSS-only strikeout stem',
    choices: Object.freeze([{ id: 'A', label: 'Visible A', index: 1 }, { id: 'B', label: 'Visible B', index: 2 }]),
    resourceUrls: Object.freeze([]),
  }),
});
const cssOnlyStrikeoutSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState: cssOnlyStrikeoutState,
  item: cssOnlyStrikeoutState.currentItem,
  itemList: cssOnlyStrikeoutState.itemList,
  timingByQuestionId: {},
  qbankCaptureResult: null,
  root: cssOnlyStrikeoutItem,
  document: cssOnlyStrikeoutDocument,
});
assert.equal(cssOnlyStrikeoutSnapshot.annotations.strikeouts.length, 1, 'computed-style line-through strikeouts are captured');
assert.equal(cssOnlyStrikeoutSnapshot.annotations.strikeouts[0].optionIndex, 2);
assert.equal(cssOnlyStrikeoutSnapshot.annotations.strikeouts[0].optionAnswerId, 'B');

const preservedStrikeoutSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState: cssOnlyStrikeoutState,
  item: cssOnlyStrikeoutState.currentItem,
  itemList: cssOnlyStrikeoutState.itemList,
  timingByQuestionId: {},
  qbankCaptureResult: null,
  root: el('div', { id: 'item-css-strikeout-empty' }, [el('div', { class: 'NBExposition' }, ['CSS-only strikeout stem'])]),
  document: cssOnlyStrikeoutDocument,
  existingAnnotations: cssOnlyStrikeoutSnapshot.annotations,
});
assert.equal(preservedStrikeoutSnapshot.annotations.strikeouts.length, 1, 'later DOM captures without visible strikeout preserve existing strikeout annotations');

const repeatedHighlightItem = el('div', { id: 'item-repeated', 'data-component-id': 'component-repeated', 'data-item-index': '1' }, [
  el('div', { class: 'NBExposition' }, ['Blood before ', el('mark', {}, ['blood']), ' after blood.']),
  el('div', { id: 'repeated_div', class: 'NBOptionListComp answerbox', 'data-correct-answer': 'A' }, [
    el('ol', { class: 'options' }, [
      el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'repeated', value: 'A', checked: true }), el('span', {}, ['Answer A'])]),
    ]),
  ]),
]);
const repeatedHighlightState = createSyntheticAdapterState({
  currentItem: Object.freeze({ questionId: 'q-repeated', componentId: 'component-repeated', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: 'A', marked: false, current: true, identitySource: 'component-medley' }),
  itemList: Object.freeze([Object.freeze({ questionId: 'q-repeated', componentId: 'component-repeated', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: 'A', current: true, identitySource: 'component-medley' })]),
  currentContent: Object.freeze({
    renderedHtml: '<div id="item-repeated"><div class="NBExposition">Blood before blood after blood.</div></div>',
    promptHtml: 'Blood before blood after blood.',
    choices: Object.freeze([{ id: 'A', label: 'Answer A', index: 1, selected: true }]),
    resourceUrls: Object.freeze([]),
  }),
});
const repeatedHighlightSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState: repeatedHighlightState,
  item: repeatedHighlightState.currentItem,
  itemList: repeatedHighlightState.itemList,
  timingByQuestionId: {},
  qbankCaptureResult: null,
  root: repeatedHighlightItem,
  document: fakeDocument,
});
assert.equal(repeatedHighlightSnapshot.annotations.highlights.length, 1);
assert.equal(repeatedHighlightSnapshot.annotations.highlights[0].text, 'blood');
assert.equal(repeatedHighlightSnapshot.annotations.highlights[0].occurrence, 2, 'highlight capture records which repeated text occurrence was highlighted');

const staleQ5Id = buildQuestionIdentity({ examProgram: 'Step 1', examName: 'Free 120', examSection: 'Block 1', medleyId: 'medley-1', componentId: 'component-q5', blockNumber: 1, itemIndex: 5 }).questionId;
const staleQ6Id = buildQuestionIdentity({ examProgram: 'Step 1', examName: 'Free 120', examSection: 'Block 1', medleyId: 'medley-1', componentId: 'component-q6', blockNumber: 1, itemIndex: 6 }).questionId;
const staleSelectionRows = el('ol', { class: 'options' }, ['A', 'B', 'C', 'D', 'E'].map((answerId) => (
  el('li', { class: 'stContext' }, [el('input', { class: 'NBOptionInput', type: 'radio', name: 'q6', value: answerId }), el('span', {}, [`Synthetic ${answerId}`])])
)));
const staleSelectionItem = el('div', { id: 'item-q6', 'data-component-id': 'component-q6', 'data-item-index': '6' }, [
  el('div', { class: 'NBExposition' }, ['Unanswered q6 stem']),
  el('div', { id: 'q6_div', class: 'NBOptionListComp answerbox' }, [staleSelectionRows]),
]);
const staleSelectionState = createSyntheticAdapterState({
  examIdentity: Object.freeze({ program: 'Step 1', examName: 'Free 120', section: 'Block 1' }),
  launchedScope: Object.freeze({ mode: 'test', block: '1', section: 'Block 1' }),
  currentItem: Object.freeze({ questionId: staleQ6Id, componentId: 'component-q6', medleyId: 'medley-1', blockNumber: 1, itemIndex: 6, selectedAnswerId: 'E', current: true, identitySource: 'component-medley' }),
  itemList: Object.freeze([
    Object.freeze({ questionId: staleQ5Id, componentId: 'component-q5', medleyId: 'medley-1', blockNumber: 1, itemIndex: 5, selectedAnswerId: 'E', current: false, identitySource: 'component-medley' }),
    Object.freeze({ questionId: staleQ6Id, componentId: 'component-q6', medleyId: 'medley-1', blockNumber: 1, itemIndex: 6, selectedAnswerId: 'E', current: true, identitySource: 'component-medley' }),
  ]),
  answers: Object.freeze({ [staleQ5Id]: 'E', [staleQ6Id]: 'E' }),
  currentContent: Object.freeze({
    renderedHtml: staleSelectionItem.outerHTML,
    promptHtml: 'Unanswered q6 stem',
    choices: Object.freeze(['A', 'B', 'C', 'D', 'E'].map((answerId, index) => Object.freeze({ id: answerId, label: `Synthetic ${answerId}`, index: index + 1, selected: answerId === 'E' }))),
    resourceUrls: Object.freeze([]),
  }),
});
const staleSelectionSnapshot = createTrackingQuestionSnapshot({
  attemptId: attempt.id,
  attempt,
  adapterState: staleSelectionState,
  item: staleSelectionState.currentItem,
  itemList: staleSelectionState.itemList,
  timingByQuestionId: {},
  qbankCaptureResult: null,
  root: staleSelectionItem,
  document: fakeDocument,
});
assert.equal(staleSelectionSnapshot.selectedAnswerId, '', 'unchecked live DOM clears stale adapter answer on newly visited unanswered item');
assert.equal(staleSelectionSnapshot.choices.some((choice) => choice.selected), false, 'unchecked live DOM clears stale selected choice marker');

let staleEngineAttempt = null;
const staleEngineStorage = {
  snapshots: [],
  async ready() { return {}; },
  async listInProgressStates() { return []; },
  async createAttempt(candidate) {
    staleEngineAttempt = Object.freeze({
      id: 'attempt-stale-dom-clear',
      status: ATTEMPT_STATUS.IN_PROGRESS,
      questionIds: Object.freeze([]),
      questionCount: 0,
      responses: Object.freeze({}),
      correctAnswers: Object.freeze({}),
      markedQuestionIds: Object.freeze([]),
      timingByQuestionId: Object.freeze({}),
      source: Object.freeze({}),
      ...candidate,
      responses: Object.freeze({ [staleQ5Id]: 'E', [staleQ6Id]: 'E' }),
      source: Object.freeze({
        ...((candidate && candidate.source) || {}),
        responseAliases: Object.freeze({
          byPosition: Object.freeze({ '1\u00005': 'E', '1\u00006': 'E' }),
          byComponent: Object.freeze({ '1\u0000medley-1\u0000component-q6': 'E' }),
        }),
      }),
    });
    return staleEngineAttempt;
  },
  async getAttempt() { return staleEngineAttempt; },
  async updateAttempt(_attemptId, patchCandidate) {
    staleEngineAttempt = Object.freeze({ ...staleEngineAttempt, ...patchCandidate });
    return staleEngineAttempt;
  },
  async saveInProgressState() { return {}; },
  async listAttempts() { return staleEngineAttempt ? [staleEngineAttempt] : []; },
  async saveQuestionSnapshot(snapshotCandidate) {
    this.snapshots.push(snapshotCandidate);
    return snapshotCandidate;
  },
};
const staleEngineDocument = Object.assign(createFakeDocument(el('main', {}, [
  el('nav', {}, [el('ol', { id: 'leftnav' }, [
    el('li', {}, [el('span', { class: 'index' }, ['5'])]),
    el('li', { class: 'currentitem', 'aria-current': 'true' }, [el('span', { class: 'index' }, ['6'])]),
  ])]),
  el('section', { id: 'item' }, [el('article', { id: 'content' }, [el('div', { id: 'medley-1', 'data-medley-id': 'medley-1' }, [staleSelectionItem])])]),
  el('div', {}, ['Block 1 of 1']),
]), { title: 'Synthetic Step 1 Free 120' }), {
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
});
const staleEngineWindow = Object.assign(createFakeWindow('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201'), {
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  addEventListener() {},
  removeEventListener() {},
});
const staleEngine = createTrackingEngine({
  window: staleEngineWindow,
  document: staleEngineDocument,
  runtimeContext: Object.freeze({ origin: 'https://orientation.nbme.org', pathname: '/webfred/', search: '', href: staleEngineWindow.location.href }),
  storage: staleEngineStorage,
  webfredAdapter: {
    waitForInitialization: async () => staleSelectionState,
    readState: () => staleSelectionState,
  },
  logger: { debug() {}, warn() {} },
});
await staleEngine.start({ adapterState: staleSelectionState });
assert.equal(staleEngineAttempt.responses[staleQ5Id], 'E', 'previous answered item keeps selected answer');
assert.equal(staleEngineAttempt.responses[staleQ6Id], '', 'visible unanswered item clears stale carried-over adapter answer');
assert.equal(staleEngineStorage.snapshots.at(-1).selectedAnswerId, '', 'saved snapshot for visible unanswered item has no selected answer');
await staleEngine.stop('synthetic-stop');

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

const allBlockTrackingPreviousItems = [1, 2].flatMap((blockNumber) => Array.from({ length: 2 }, (_item, index) => Object.freeze({
  questionId: `all-track-b${blockNumber}-q${index + 1}`,
  componentId: `all-track-b${blockNumber}-component-${index + 1}`,
  medleyId: `all-track-medley-${blockNumber}`,
  blockNumber,
  itemIndex: index + 1,
})));
const allBlockTrackingCurrentItems = Array.from({ length: 2 }, (_item, index) => Object.freeze({
  questionId: `all-track-b3-q${index + 1}`,
  componentId: `all-track-b3-component-${index + 1}`,
  medleyId: 'all-track-medley-3',
  blockNumber: 3,
  itemIndex: index + 1,
}));
const allBlockTrackingPatch = buildTrackingAttemptPatch(
  createSyntheticAttempt({
    id: 'attempt-all-blocks-tracking-progress',
    launchedScope: Object.freeze({ mode: 'all', blockCount: 3 }),
    source: Object.freeze({ itemMetadataByQuestionId: Object.freeze(Object.fromEntries(allBlockTrackingPreviousItems.map((item) => [item.questionId, item]))) }),
    questionIds: allBlockTrackingPreviousItems.map((item) => item.questionId),
    questionCount: 4,
    responses: Object.fromEntries(allBlockTrackingPreviousItems.map((item) => [item.questionId, 'A'])),
  }),
  createSyntheticAdapterState({
    launchedScope: Object.freeze({ mode: 'all', blockCount: 3 }),
    currentBlock: 3,
    blockCount: 3,
    itemCount: 2,
    currentItem: Object.freeze({ ...allBlockTrackingCurrentItems[1], selectedAnswerId: 'B', current: true }),
    itemList: Object.freeze(allBlockTrackingCurrentItems),
    answers: Object.freeze({ 'all-track-b3-q1': 'B', 'all-track-b3-q2': 'B' }),
    marks: Object.freeze({}),
  }),
  allBlockTrackingCurrentItems,
  allBlockTrackingCurrentItems[1],
  { responses: { ...Object.fromEntries(allBlockTrackingPreviousItems.map((item) => [item.questionId, 'A'])), 'all-track-b3-q1': 'B', 'all-track-b3-q2': 'B' }, changes: [] },
  {},
  [],
  null,
  'all-block-progress',
  { metadataItemList: [...allBlockTrackingPreviousItems, ...allBlockTrackingCurrentItems] }
);
assert.equal(allBlockTrackingPatch.questionCount, 6, 'all-block tracking keeps previous and current block question ids');
assert.deepEqual(Object.fromEntries(Object.entries(allBlockTrackingPatch.source.progress.byBlock).map(([key, block]) => [key, block.total])), { 1: 2, 2: 2, 3: 2 });
assert.deepEqual(allBlockTrackingPatch.blockMetadata.map((block) => [block.blockNumber, block.itemCount, block.answeredCount]), [[1, 3, 2], [2, 2, 2], [3, 2, 2]]);

const allBlockTrackingPatchWithStaleResponses = buildTrackingAttemptPatch(
  createSyntheticAttempt({
    id: 'attempt-all-blocks-tracking-stale-responses',
    launchedScope: Object.freeze({ mode: 'all', blockCount: 3 }),
    source: Object.freeze({ itemMetadataByQuestionId: Object.freeze(Object.fromEntries(allBlockTrackingPreviousItems.map((item) => [item.questionId, item]))) }),
    questionIds: allBlockTrackingPreviousItems.map((item) => item.questionId),
    questionCount: 4,
    responses: {
      ...Object.fromEntries(allBlockTrackingPreviousItems.map((item) => [item.questionId, 'A'])),
      'stale-dom-fallback-response': 'D',
    },
  }),
  createSyntheticAdapterState({
    launchedScope: Object.freeze({ mode: 'all', blockCount: 3 }),
    currentBlock: 3,
    blockCount: 3,
    itemCount: 2,
    currentItem: Object.freeze({ ...allBlockTrackingCurrentItems[1], selectedAnswerId: 'B', current: true }),
    itemList: Object.freeze(allBlockTrackingCurrentItems),
    answers: Object.freeze({ 'all-track-b3-q1': 'B', 'all-track-b3-q2': 'B' }),
    marks: Object.freeze({}),
  }),
  allBlockTrackingCurrentItems,
  allBlockTrackingCurrentItems[1],
  { responses: { ...Object.fromEntries(allBlockTrackingPreviousItems.map((item) => [item.questionId, 'A'])), 'all-track-b3-q1': 'B', 'all-track-b3-q2': 'B', 'stale-dom-fallback-response': 'D' }, changes: [] },
  {},
  [],
  null,
  'all-block-progress-stale-response',
  { metadataItemList: [...allBlockTrackingPreviousItems, ...allBlockTrackingCurrentItems] }
);
assert.equal(Object.keys(allBlockTrackingPatchWithStaleResponses.responses).length, 6, 'all-block tracking filters stale responses that are outside tracked question ids');
assert.equal(allBlockTrackingPatchWithStaleResponses.responses['stale-dom-fallback-response'], undefined, 'stale all-block response key is removed');
assert.equal(allBlockTrackingPatchWithStaleResponses.source.progress.overall.answered, 6, 'all-block progress only counts tracked question responses');

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
      progress: Object.freeze({
        byBlock: Object.freeze({
          2: Object.freeze({ blockNumber: 2, total: 3, questionIds: rekeyedCurrentBlockItems.map((entry) => entry.questionId), answeredQuestionIds: Object.freeze(['new-b2-q1', 'new-b2-q2', 'new-b2-q3']) }),
        }),
      }),
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

const staleAliasNotRecoveredPatch = buildTrackingAttemptPatch(
  createSyntheticAttempt({
    id: 'attempt-stale-alias-not-recovered',
    launchedScope: Object.freeze({ mode: 'test', block: '1' }),
    questionIds: rekeyedCurrentBlockItems.map((entry) => entry.questionId),
    questionCount: 3,
    responses: { 'new-b2-q1': 'A' },
    source: Object.freeze({
      progress: Object.freeze({
        byBlock: Object.freeze({
          1: Object.freeze({ blockNumber: 1, total: 3, questionIds: rekeyedCurrentBlockItems.map((entry) => entry.questionId), answeredQuestionIds: Object.freeze(['new-b2-q1']) }),
        }),
      }),
      responseAliases: Object.freeze({
        byPosition: Object.freeze({ '2\u00002': 'B', '2\u00003': 'A' }),
        byComponent: Object.freeze({}),
      }),
      itemMetadataByQuestionId: Object.freeze(Object.fromEntries(rekeyedCurrentBlockItems.map((entry) => [entry.questionId, entry]))),
    }),
  }),
  createSyntheticAdapterState({
    currentBlock: 2,
    itemCount: 3,
    currentItem: Object.freeze({ ...rekeyedCurrentBlockItems[0], selectedAnswerId: 'A', current: true }),
    itemList: Object.freeze(rekeyedCurrentBlockItems),
    answers: Object.freeze({ 'new-b2-q1': 'A' }),
    marks: Object.freeze({}),
  }),
  rekeyedCurrentBlockItems,
  rekeyedCurrentBlockItems[0],
  { responses: { 'new-b2-q1': 'A' }, changes: [] },
  {},
  [],
  null,
  'stale-alias-not-recovered'
);
assert.deepEqual(staleAliasNotRecoveredPatch.responses, {
  'new-b2-q1': 'A',
}, 'stored aliases do not resurrect answers for questions absent from answered progress');

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

console.log('adapter and tracking tests passed');
