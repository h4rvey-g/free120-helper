import { ATTEMPT_STATUS, WEBFRED_ADAPTER_STATUS, WEBFRED_STATE_SOURCE } from '../../src/core/constants.js';

const syntheticChoices = Object.freeze([
  Object.freeze({ id: 'A', label: 'Synthetic choice A', index: 1, selected: true, disabled: false }),
  Object.freeze({ id: 'B', label: 'Synthetic choice B', index: 2, selected: false, disabled: false }),
  Object.freeze({ id: 'C', label: 'Synthetic choice C', index: 3, selected: false, disabled: false }),
]);

function syntheticQuestionHtml(questionId = 'q1', selected = 'A', correct = 'B') {
  return `<div id="item-${questionId}" data-component-id="component-${questionId}" data-item-index="1">
    <div class="NBExposition">Synthetic stem for ${questionId}</div>
    <div id="${questionId}_div" class="NBOptionListComp answerbox" data-correct-answer="${correct}">
      <form><ol class="options">
        <li class="stContext"><input class="NBOptionInput" type="radio" name="${questionId}" value="A"${selected === 'A' ? ' checked' : ''}><span>Synthetic choice A</span></li>
        <li class="stContext correct"><input class="NBOptionInput" type="radio" name="${questionId}" value="B"${selected === 'B' ? ' checked' : ''}><span>Synthetic choice B</span></li>
        <li class="stContext"><input class="NBOptionInput" type="radio" name="${questionId}" value="C"${selected === 'C' ? ' checked' : ''}><span>Synthetic choice C</span></li>
      </ol></form>
    </div>
    <textarea>Synthetic note</textarea>
    <mark>Synthetic highlight</mark>
    <span style="text-decoration: line-through">Synthetic strikeout</span>
    <img src="https://example.test/synthetic.png" alt="synthetic">
  </div>`;
}

function createSyntheticAttempt(overrides = {}) {
  return Object.freeze({
    id: 'attempt-synthetic',
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAt: '2026-05-05T00:00:00.000Z',
    questionIds: Object.freeze(['q1', 'q2', 'q3']),
    questionCount: 3,
    examIdentity: Object.freeze({ program: 'Synthetic Step 1', examName: 'Synthetic Free 120', section: 'Block 1' }),
    launchedScope: Object.freeze({ mode: 'test', block: '1' }),
    blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 3, label: 'Block 1' })]),
    responses: Object.freeze({ q1: 'A', q2: 'B' }),
    correctAnswers: Object.freeze({ q1: 'A', q2: 'C' }),
    markedQuestionIds: Object.freeze(['q2']),
    timingByQuestionId: Object.freeze({
      q1: Object.freeze({ totalMs: 1000, blockNumber: 1, itemIndex: 1 }),
      q2: Object.freeze({ totalMs: 2000, blockNumber: 1, itemIndex: 2 }),
    }),
    source: Object.freeze({
      itemMetadataByQuestionId: Object.freeze({
        q1: Object.freeze({ questionId: 'q1', blockNumber: 1, itemIndex: 1, componentId: 'component-q1', medleyId: 'medley-1' }),
        q2: Object.freeze({ questionId: 'q2', blockNumber: 1, itemIndex: 2, componentId: 'component-q2', medleyId: 'medley-1' }),
        q3: Object.freeze({ questionId: 'q3', blockNumber: 1, itemIndex: 3, componentId: 'component-q3', medleyId: 'medley-1' }),
      }),
    }),
    ...overrides,
  });
}

function createSyntheticSnapshots(attemptId = 'attempt-synthetic') {
  return Object.freeze([
    Object.freeze({
      id: `${attemptId}:q1`,
      attemptId,
      questionId: 'q1',
      blockNumber: 1,
      itemIndex: 1,
      promptHtml: 'Synthetic stem q1',
      renderedHtml: syntheticQuestionHtml('q1', 'A', 'A'),
      choices: Object.freeze(syntheticChoices),
      selectedAnswerId: 'A',
      correctAnswerId: 'A',
      notes: 'Synthetic note',
      annotations: Object.freeze({ highlights: [Object.freeze({ text: 'Synthetic highlight' })], strikeouts: [] }),
      resourceUrls: Object.freeze(['https://example.test/synthetic.png']),
      snapshot: Object.freeze({
        webfredShell: Object.freeze({
          title: 'Synthetic WebFRED',
          navHtml: '<nav><ol id="leftnav"><li><span class="index">1</span></li></ol></nav>',
          itemShellHtml: '<section id="item"><article id="content"><div id="medley"></div></article></section>',
        }),
      }),
    }),
    Object.freeze({
      id: `${attemptId}:q2`,
      attemptId,
      questionId: 'q2',
      blockNumber: 1,
      itemIndex: 2,
      promptHtml: 'Synthetic stem q2',
      renderedHtml: syntheticQuestionHtml('q2', 'B', 'C'),
      choices: Object.freeze([
        Object.freeze({ id: 'B', label: 'Synthetic choice B', index: 1 }),
        Object.freeze({ id: 'C', label: 'Synthetic choice C', index: 2 }),
      ]),
      selectedAnswerId: 'B',
      correctAnswerId: 'C',
    }),
  ]);
}

function createSyntheticAdapterState(overrides = {}) {
  return Object.freeze({
    status: WEBFRED_ADAPTER_STATUS.READY,
    source: WEBFRED_STATE_SOURCE.MIXED,
    examIdentity: Object.freeze({ program: 'Synthetic Step 1', examName: 'Synthetic Free 120', section: 'Block 1' }),
    launchedScope: Object.freeze({ mode: 'test', block: '1' }),
    currentBlock: 1,
    blockCount: 1,
    itemCount: 3,
    currentItem: Object.freeze({ questionId: 'q1', componentId: 'component-q1', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: 'A', marked: false, current: true, identitySource: 'component-medley' }),
    itemList: Object.freeze([
      Object.freeze({ questionId: 'q1', componentId: 'component-q1', medleyId: 'medley-1', blockNumber: 1, itemIndex: 1, selectedAnswerId: 'A', current: true, identitySource: 'component-medley' }),
      Object.freeze({ questionId: 'q2', componentId: 'component-q2', medleyId: 'medley-1', blockNumber: 1, itemIndex: 2, selectedAnswerId: 'B', current: false, identitySource: 'component-medley' }),
      Object.freeze({ questionId: 'q3', componentId: 'component-q3', medleyId: 'medley-1', blockNumber: 1, itemIndex: 3, selectedAnswerId: '', current: false, identitySource: 'component-medley' }),
    ]),
    answers: Object.freeze({ q1: 'A', q2: 'B' }),
    marks: Object.freeze({ q2: true }),
    currentContent: Object.freeze({
      renderedHtml: syntheticQuestionHtml('q1', 'A', 'A'),
      promptHtml: 'Synthetic stem q1',
      answerBoxHtml: '<ol class="options"><li class="stContext">Synthetic choice A</li></ol>',
      choices: Object.freeze(syntheticChoices),
      resourceUrls: Object.freeze(['https://example.test/synthetic.png']),
    }),
    blockMetadata: Object.freeze([Object.freeze({ blockNumber: 1, itemCount: 3, label: 'Block 1' })]),
    terminalState: Object.freeze({ isTerminal: false, blockComplete: false, examComplete: false, allBlocksComplete: false, currentBlock: 1, completedBlockNumbers: Object.freeze([]) }),
    capabilities: Object.freeze({ hasAngularServices: true, hasDomFallback: true, hasTrustedIdentity: true, hasItemList: true, hasAnswers: true, hasMarks: true, hasCurrentContent: true }),
    degradedReasons: Object.freeze([]),
    raw: Object.freeze({}),
    ...overrides,
  });
}

export {
  syntheticChoices,
  syntheticQuestionHtml,
  createSyntheticAttempt,
  createSyntheticSnapshots,
  createSyntheticAdapterState,
};
