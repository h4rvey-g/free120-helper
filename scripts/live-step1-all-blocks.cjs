async page => {
  const ORIGIN = 'https://orientation.nbme.org';
  const LAUNCH_URL = `${ORIGIN}/Launch/USMLE`;
  const WEBFRED_URL = `${ORIGIN}/webfred/#/main?program=USMLE&exam=STPF1&section=STPF1ALL&testDefinitionName=STPF1ALL&testDefinitionDisplayName=Step%201%20All%20Blocks&publicationName=LIVE120&blockCount=3&mode=all`;
  const QBANK_ATTEMPT_PREFIX = 'qbank-cache:USMLE:STPF1:';
  const CHOICES = ['A', 'B', 'C', 'D'];
  const BLOCKS = [
    Object.freeze({ blockNumber: 1, testDefinitionName: 'STPF1C0137', displayName: 'Step 1 Block 1', medleyId: 'MED-B1' }),
    Object.freeze({ blockNumber: 2, testDefinitionName: 'STPF1C0138', displayName: 'Step 1 Block 2', medleyId: 'MED-B2' }),
    Object.freeze({ blockNumber: 3, testDefinitionName: 'STPF1C0139', displayName: 'Step 1 Block 3', medleyId: 'MED-B3' }),
  ];
  const QUESTION_COUNT_PER_BLOCK = 40;
  const TOTAL_QUESTION_COUNT = BLOCKS.length * QUESTION_COUNT_PER_BLOCK;
  const ANSWER_RANDOM_SEED = 0xf120ab;

  const fail = (message, details) => {
    const suffix = details ? `\n${JSON.stringify(details, null, 2).slice(0, 4000)}` : '';
    const error = new Error(`${message}${suffix}`);
    error.details = details || null;
    throw error;
  };
  const assert = (condition, message, details) => {
    if (!condition) fail(message, details);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const waitFor = async (predicate, message, timeoutMs = 20000) => {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      try {
        last = await predicate();
        if (last) return last;
      } catch (error) {
        last = error && (error.message || String(error));
      }
      await wait(100);
    }
    fail(message, { last });
  };

  const makeSeededRandom = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };
  const pad = (index) => String(index).padStart(2, '0');
  const componentId = (blockNumber, itemIndex) => `COMP-B${blockNumber}-Q${pad(itemIndex)}`;
  const answerKey = (blockNumber, itemIndex) => `${blockNumber}:${itemIndex}`;
  const globalIndex = (blockNumber, itemIndex) => ((blockNumber - 1) * QUESTION_COUNT_PER_BLOCK) + itemIndex;
  const correctAnswer = (blockNumber, itemIndex) => CHOICES[(blockNumber + itemIndex) % CHOICES.length];
  const buildRandomAnswers = () => {
    const random = makeSeededRandom(ANSWER_RANDOM_SEED);
    const answers = {};
    BLOCKS.forEach(({ blockNumber }) => {
      for (let itemIndex = 1; itemIndex <= QUESTION_COUNT_PER_BLOCK; itemIndex += 1) {
        answers[answerKey(blockNumber, itemIndex)] = CHOICES[Math.floor(random() * CHOICES.length)];
      }
    });
    return Object.freeze(answers);
  };
  const USER_ANSWERS = buildRandomAnswers();

  const itemHtml = (blockNumber, itemIndex, selected = '') => {
    const component = componentId(blockNumber, itemIndex);
    const options = CHOICES.map((choice) => {
      const checked = selected === choice ? ' checked' : '';
      const klass = choice === correctAnswer(blockNumber, itemIndex) ? 'stContext correct' : 'stContext';
      return `<li class="${klass}"><input class="NBOptionInput" type="radio" name="${component}" value="${choice}"${checked}><span>${choice}. Synthetic Step 1 Block ${blockNumber} Q${itemIndex} option ${choice}</span></li>`;
    }).join('');
    return `<div id="page-b${blockNumber}-${pad(itemIndex)}" class="NBSinglePage"><div id="item-b${blockNumber}-${pad(itemIndex)}" data-component-id="${component}" data-item-index="${itemIndex}" data-block="${blockNumber}"><div class="NBExposition">Synthetic Step 1 Block ${blockNumber} Q${itemIndex} stem</div><div id="${component}_div" class="NBOptionListComp answerbox"><form><ol class="options">${options}</ol></form></div><fred-show-answer ans="${correctAnswer(blockNumber, itemIndex)}"></fred-show-answer></div></div>`;
  };
  const qbankBulkHtml = (blockNumber) => Array.from({ length: QUESTION_COUNT_PER_BLOCK }, (_unused, index) => itemHtml(blockNumber, index + 1)).join('\n');
  const launchHtml = () => `<!doctype html><html><head><title>USMLE Launch</title></head><body><main ng-controller="launch"><h1>USMLE</h1>${BLOCKS.map((block) => `<label><input type="radio" name="block" data-test-definition-name="${block.testDefinitionName}" data-display-name="${block.displayName}"> ${block.displayName}</label>`).join('')}<label><input type="radio" name="block" data-test-definition-name="STPF1ALL" data-display-name="Step 1 All Blocks"> Step 1 All Blocks</label><button type="button">Start</button></main></body></html>`;
  const webfredApp = (fixture) => {
    const choices = fixture.choices;
    const blocks = fixture.blocks;
    const questionCountPerBlock = fixture.questionCountPerBlock;
    const answers = {};
    let currentBlock = 1;
    let currentItem = 1;
    const pad = (index) => String(index).padStart(2, '0');
    const componentId = (blockNumber, itemIndex) => `COMP-B${blockNumber}-Q${pad(itemIndex)}`;
    const answerKey = (blockNumber, itemIndex) => `${blockNumber}:${itemIndex}`;
    const correctAnswer = (blockNumber, itemIndex) => choices[(blockNumber + itemIndex) % choices.length];
    const renderItem = (blockNumber, itemIndex) => {
      const component = componentId(blockNumber, itemIndex);
      const selected = answers[answerKey(blockNumber, itemIndex)] || '';
      const rows = choices.map((choice) => `<li class="${choice === correctAnswer(blockNumber, itemIndex) ? 'stContext correct' : 'stContext'}"><input class="NBOptionInput" type="radio" name="${component}" value="${choice}"${selected === choice ? ' checked' : ''}><span>${choice}. Synthetic Step 1 Block ${blockNumber} Q${itemIndex} option ${choice}</span></li>`).join('');
      return `<section id="item"><article id="content"><div id="medley" data-medley-id="MED-B${blockNumber}"><div id="item-b${blockNumber}-${pad(itemIndex)}" data-component-id="${component}" data-item-index="${itemIndex}" data-block="${blockNumber}"><div class="NBExposition">Synthetic Step 1 Block ${blockNumber} Q${itemIndex} stem</div><div id="${component}_div" class="NBOptionListComp answerbox"><form><ol class="options">${rows}</ol></form></div></div></div></article></section>`;
    };
    const moveNext = () => {
      if (currentItem < questionCountPerBlock) {
        currentItem += 1;
      } else if (currentBlock < blocks.length) {
        currentBlock += 1;
        currentItem = 1;
      }
      renderExam();
    };
    const movePrevious = () => {
      if (currentItem > 1) {
        currentItem -= 1;
      } else if (currentBlock > 1) {
        currentBlock -= 1;
        currentItem = questionCountPerBlock;
      }
      renderExam();
    };
    const finishExam = () => {
      window.__syntheticWebfredAnswers = { ...answers };
      history.replaceState(null, '', location.pathname + location.search + '#!/endExam?program=USMLE&exam=STPF1&section=STPF1ALL&block=3&mode=all');
      document.body.innerHTML = `<main><h1>Exam complete</h1><p>You have completed the exam.</p><p>Block ${blocks.length} of ${blocks.length}</p></main>`;
    };
    const renderExam = () => {
      document.body.innerHTML = `<main><h1>Step 1 All Blocks</h1><div>Block ${currentBlock} of ${blocks.length}</div><nav><ol id="leftnav">${Array.from({ length: questionCountPerBlock }, (_unused, index) => {
        const item = index + 1;
        const selected = answers[answerKey(currentBlock, item)] || '';
        return `<li id="nav-b${currentBlock}-q${item}" data-medley-id="MED-B${currentBlock}" data-component-id="${componentId(currentBlock, item)}" class="${item === currentItem ? 'currentitem ' : ''}${selected ? 'answered' : ''}" ${item === currentItem ? 'aria-current="true"' : ''}><span class="ans_status ${selected ? 'answered' : ''}"></span><span class="index">${item}</span></li>`;
      }).join('')}</ol></nav>${renderItem(currentBlock, currentItem)}<button id="native-prev" type="button">Previous</button><button id="native-next" type="button">Next</button><button id="native-end" type="button">${currentBlock === blocks.length ? 'End Exam' : 'End Block'}</button></main>`;
      document.querySelectorAll('#leftnav li').forEach((node) => node.addEventListener('click', () => { currentItem = Number(node.querySelector('.index').textContent); renderExam(); }));
      document.querySelectorAll('input.NBOptionInput').forEach((input) => input.addEventListener('change', (event) => { answers[answerKey(currentBlock, currentItem)] = event.target.value; renderExam(); }));
      document.querySelector('#native-prev').addEventListener('click', movePrevious);
      document.querySelector('#native-next').addEventListener('click', moveNext);
      document.querySelector('#native-end').addEventListener('click', () => {
        if (currentBlock < blocks.length) {
          currentBlock += 1;
          currentItem = 1;
          renderExam();
          return;
        }
        finishExam();
      });
    };
    renderExam();
  };
  const webfredHtml = () => {
    const script = `(${webfredApp.toString()})(${JSON.stringify({ choices: CHOICES, blocks: BLOCKS, questionCountPerBlock: QUESTION_COUNT_PER_BLOCK })});`;
    return `<!doctype html><html><head><title>Synthetic Step 1 All Blocks WebFRED</title><style>body{font-family:sans-serif}#leftnav{display:flex;flex-wrap:wrap;gap:4px;list-style:none;padding:0}#leftnav li{border:1px solid #999;padding:4px;cursor:pointer}.currentitem{background:#dbeafe}.answered .ans_status{background:#94a3b8}</style></head><body><script>${script}</script></body></html>`;
  };
  const blockByTestDefinition = Object.freeze(Object.fromEntries(BLOCKS.map((block) => [block.testDefinitionName, block])));
  const blockFromSessionId = (sessionId) => {
    const text = String(sessionId || '');
    const byDefinition = BLOCKS.find((block) => text.includes(block.testDefinitionName));
    if (byDefinition) return byDefinition;
    const blockMatch = text.match(/B([1-3])\b/i);
    if (blockMatch) return BLOCKS[Number(blockMatch[1]) - 1];
    return BLOCKS[0];
  };
  const readPostJson = (route) => {
    try {
      return JSON.parse(route.request().postData() || '{}');
    } catch (_error) {
      return {};
    }
  };

  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes('/Launch/USMLE') || requestUrl.endsWith('/Launch')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: launchHtml() });
    }
    if (requestUrl.includes('/webfred/api/services/WebFred/examStatus/GetExamStatus')) {
      const body = readPostJson(route);
      const block = blockFromSessionId(body.sessionId);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { examBlock: { medleys: [{ medleyId: block.medleyId, items: Array.from({ length: QUESTION_COUNT_PER_BLOCK }, (_unused, index) => ({ componentId: componentId(block.blockNumber, index + 1), answerable: true })) }] } } }) });
    }
    if (requestUrl.includes('/webfred/api/Content/GetBulk')) {
      const body = readPostJson(route);
      const block = blockFromSessionId(body.sessionId);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ [block.medleyId]: qbankBulkHtml(block.blockNumber) }) });
    }
    if (requestUrl.includes('/webfred/api/Resource')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: 'iVBORw0KGgo=' });
    }
    if (requestUrl.includes('/webfred')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: webfredHtml() });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });

  const installLaunchAngular = async () => page.evaluate(({ webfredUrl, blocks }) => {
    let selectedDefinitionName = 'STPF1ALL';
    const testDefinitions = blocks.map((block) => ({ name: block.testDefinitionName, displayName: block.displayName }))
      .concat([{ name: 'STPF1ALL', displayName: 'Step 1 All Blocks' }]);
    const scope = {
      program: 'USMLE',
      ipa: 'LIVE',
      programs: { name: 'USMLE', exams: [{ name: 'STPF1', description: 'Step 1 Free 120', examPublications: [{ publicationName: 'LIVE120', testDefinitions }] }] },
      launchExam() {
        const checked = document.querySelector('input[name="block"]:checked');
        selectedDefinitionName = checked && checked.getAttribute('data-test-definition-name') || selectedDefinitionName;
        const displayName = checked && checked.getAttribute('data-display-name') || 'Step 1 All Blocks';
        const launchService = injector.get('launchService');
        return Promise.resolve(launchService.createSession({
          examineeId: 'live-guidIPLIVE',
          authorizationCode: 'live-guidIPLIVE',
          programName: 'USMLE',
          examName: 'STPF1',
          examPublicationName: 'LIVE120',
          testDefinition: selectedDefinitionName,
          testDefinitionDisplayName: displayName,
          showAnswers: false,
          disableTimer: true,
          EndOfSessionUrl: window.location.href,
        })).then(() => {
          if (selectedDefinitionName === 'STPF1ALL') {
            window.location.href = webfredUrl;
          }
        });
      },
    };
    const injector = {
      get(name) {
        if (name === 'launchService') {
          return {
            createSession: (params) => {
              window.__free120CreatedSessions = [...(window.__free120CreatedSessions || []), params];
              const sessionId = params && params.testDefinition === 'STPF1ALL'
                ? 'live-step1-all-blocks-session'
                : `qbank-${params && params.testDefinition || 'unknown'}`;
              return Promise.resolve({ data: { result: { examSession: { id: sessionId } } } });
            },
          };
        }
        if (name === 'uuid2') return { newguid: () => 'live-guid' };
        return {};
      },
    };
    window.angular = { element(node) { return { scope: () => (node && node.hasAttribute && node.hasAttribute('ng-controller') ? scope : {}), injector: () => injector }; } };
  }, { webfredUrl: WEBFRED_URL, blocks: BLOCKS });

  const injectUserscript = async () => {
    await page.addScriptTag({ path: 'dist/free120-helper.user.js' });
    await waitFor(() => page.evaluate(() => Boolean(window.Free120Helper)), 'Free120Helper API not published');
  };

  await page.goto(LAUNCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await installLaunchAngular();
  await injectUserscript();
  await waitFor(() => page.locator('#f120-launch-history').count(), 'launch history missing');
  await page.evaluate(async () => window.Free120Helper.storage.clearAllHistory());
  await page.evaluate(async () => window.Free120Helper.qbankCache.captureAllAvailable({ stepKeys: ['step1'] }));
  await waitFor(() => page.evaluate(() => window.Free120Helper.qbankCache.getLastResult()?.status === 'complete'), 'Step 1 QBank capture incomplete', 30000);

  const qbank = await page.evaluate(async (prefix) => {
    const helper = window.Free120Helper;
    const result = helper.qbankCache.getLastResult();
    const attempts = (await helper.storage.listAttempts({ includeInProgress: true })).filter((attempt) => String(attempt.id || '').startsWith(prefix));
    const blocks = [];
    for (const attempt of attempts) {
      const snapshots = await helper.storage.listQuestionSnapshots(attempt.id);
      blocks.push({
        attemptId: attempt.id,
        questionCount: attempt.questionCount,
        knownAnswers: Object.keys(attempt.correctAnswers || {}).length,
        snapshotCount: snapshots.length,
        firstItemIndex: snapshots[0] && snapshots[0].itemIndex,
        lastItemIndex: snapshots[snapshots.length - 1] && snapshots[snapshots.length - 1].itemIndex,
      });
    }
    return { result, attempts: attempts.length, blocks };
  }, QBANK_ATTEMPT_PREFIX);
  assert(qbank.result && qbank.result.status === 'complete', 'QBank capture status failed', qbank);
  assert(qbank.result.capturedDefinitions === BLOCKS.length, 'QBank captured Step 1 block count mismatch', qbank);
  assert(qbank.result.questionCount === TOTAL_QUESTION_COUNT && qbank.result.knownAnswerCount === TOTAL_QUESTION_COUNT, 'QBank capture total counts mismatch', qbank);
  assert(qbank.attempts === BLOCKS.length, 'stored QBank block attempt count mismatch', qbank);
  assert(qbank.blocks.every((block) => block.questionCount === QUESTION_COUNT_PER_BLOCK && block.knownAnswers === QUESTION_COUNT_PER_BLOCK && block.snapshotCount === QUESTION_COUNT_PER_BLOCK), 'stored QBank block attempts incomplete', qbank.blocks);

  await page.getByLabel('Step 1 All Blocks').check();
  await page.evaluate(async () => {
    const controller = document.querySelector('[ng-controller]');
    const scope = window.angular.element(controller).scope();
    await scope.launchExam();
  });
  await waitFor(() => page.evaluate(() => /\/webfred\//.test(window.location.href)), 'synthetic all-block launch did not navigate to WebFRED');
  await waitFor(() => page.locator('ol#leftnav li').count().then((count) => count === QUESTION_COUNT_PER_BLOCK), 'all-block WebFRED nav did not render Block 1');
  await injectUserscript();
  await waitFor(() => page.locator('#f120-active-exam-pill').count(), 'active exam pill missing');
  await waitFor(() => page.evaluate((count) => window.Free120Helper.tracking.getAttempt()?.questionCount >= count, QUESTION_COUNT_PER_BLOCK), 'tracking attempt not initialized for all-block launch');

  for (const { blockNumber } of BLOCKS) {
    for (let itemIndex = 1; itemIndex <= QUESTION_COUNT_PER_BLOCK; itemIndex += 1) {
      const selectedAnswer = USER_ANSWERS[answerKey(blockNumber, itemIndex)];
      const selector = `input[name="${componentId(blockNumber, itemIndex)}"][value="${selectedAnswer}"]`;
      await waitFor(() => page.locator(selector).count(), `answer option missing for block ${blockNumber} item ${itemIndex}`);
      await page.locator(selector).check();
      const expectedAnswered = globalIndex(blockNumber, itemIndex);
      await page.evaluate(() => window.Free120Helper.tracking.flush('live-all-blocks-answer'));
      await waitFor(() => page.evaluate((expected) => {
        const helper = window.Free120Helper;
        const attempt = helper.tracking.getAttempt();
        const state = helper.webfred.readState();
        const responseCount = Object.values((attempt && attempt.responses) || {}).filter(Boolean).length;
        if (responseCount >= expected) return true;
        throw new Error(JSON.stringify({
          expected,
          responseCount,
          trackingStatus: helper.tracking.getStatus(),
          lastError: helper.tracking.getLastError() && (helper.tracking.getLastError().message || String(helper.tracking.getLastError())),
          lastErrorStack: helper.tracking.getLastError() && helper.tracking.getLastError().stack,
          lastErrorDetails: helper.tracking.getLastError() && helper.tracking.getLastError().details,
          attemptQuestionCount: attempt && attempt.questionCount,
          attemptQuestionIdsCount: attempt && attempt.questionIds && attempt.questionIds.length,
          responses: attempt && attempt.responses,
          stateBlockCount: state && state.blockCount,
          stateCurrentBlock: state && state.currentBlock,
          launchedScope: state && state.launchedScope,
          currentItem: state && state.currentItem,
          answers: state && state.answers,
          itemListCount: state && state.itemList && state.itemList.length,
          currentContentChoices: state && state.currentContent && state.currentContent.choices,
        }));
      }, expectedAnswered), `answer not tracked for block ${blockNumber} item ${itemIndex}`);
      if (expectedAnswered < TOTAL_QUESTION_COUNT) {
        await page.locator('#native-next').click();
      }
    }
  }

  await page.locator('#native-end').click();
  await waitFor(() => page.evaluate(() => document.body.innerText.includes('You have completed the exam')), 'all-block end-exam screen missing');
  await page.evaluate(() => window.Free120Helper.tracking.flush('live-all-blocks-end-exam'));
  await waitFor(() => page.evaluate(() => window.Free120Helper.tracking.getAttempt()?.status === 'completed'), 'all-block attempt did not complete', 20000);

  const completion = await page.evaluate(() => {
    const attempt = window.Free120Helper.tracking.getAttempt();
    const progress = attempt && attempt.source && attempt.source.progress && attempt.source.progress.byBlock || {};
    const metadata = attempt && attempt.source && attempt.source.itemMetadataByQuestionId || {};
    const metadataBlockCounts = Object.values(metadata).reduce((counts, item) => {
      const block = String(item && item.blockNumber || '');
      if (block) counts[block] = (counts[block] || 0) + 1;
      return counts;
    }, {});
    return {
      id: attempt && attempt.id,
      status: attempt && attempt.status,
      reviewReady: attempt && attempt.reviewReady,
      launchedScope: attempt && attempt.launchedScope,
      questionCount: attempt && attempt.questionCount,
      questionIdsCount: attempt && attempt.questionIds && attempt.questionIds.length,
      answered: Object.values((attempt && attempt.responses) || {}).filter(Boolean).length,
      keyStatus: attempt && attempt.answerKeyCapture && attempt.answerKeyCapture.status,
      keyKnown: attempt && attempt.answerKeyCapture && attempt.answerKeyCapture.knownCount,
      blockMetadata: attempt && attempt.blockMetadata,
      metadataBlockCounts,
      progressBlockCounts: Object.fromEntries(Object.entries(progress).map(([key, value]) => [key, { total: value.total, answered: (value.answeredQuestionIds || []).length }])),
    };
  });
  assert(completion.status === 'completed' && completion.reviewReady === true, 'completed all-block attempt not review-ready', completion);
  assert(completion.questionCount === TOTAL_QUESTION_COUNT && completion.questionIdsCount === TOTAL_QUESTION_COUNT && completion.answered === TOTAL_QUESTION_COUNT, 'completed all-block attempt count mismatch', completion);
  assert(completion.keyStatus === 'complete' && completion.keyKnown === TOTAL_QUESTION_COUNT, 'completed all-block answer-key capture mismatch', completion);
  assert(JSON.stringify(completion.metadataBlockCounts) === JSON.stringify({ 1: 40, 2: 40, 3: 40 }), 'completed all-block metadata block counts mismatch', completion.metadataBlockCounts);

  await page.evaluate(() => {
    window.__free120ReviewUrls = [];
    window.open = (url) => {
      window.__free120ReviewUrls.push(String(url || ''));
      window.__free120ReviewUrl = String(url || '');
      return {
        closed: false,
        focus() {},
        location: {
          set href(value) {
            window.__free120ReviewUrls.push(String(value || ''));
            window.__free120ReviewUrl = String(value || '');
          },
          get href() {
            return window.__free120ReviewUrl || 'about:blank';
          },
        },
      };
    };
  });
  await page.evaluate(async () => window.Free120Helper.review.openAttempt(window.Free120Helper.tracking.getAttempt().id));
  const reviewHtml = await waitFor(async () => page.evaluate(async () => {
    const url = window.__free120ReviewUrl || '';
    if (!url || url === 'about:blank') return '';
    const response = await fetch(url);
    const html = await response.text();
    if (!html.includes('id="f120-review-root"')) return '';
    return html;
  }), 'all-block review HTML not opened', 10000);
  assert(reviewHtml.includes('id="f120-review-root"'), 'review root missing from all-block generated review HTML');

  await page.setContent(reviewHtml, { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.locator('#f120-review-root').count(), 'all-block review root not rendered');
  await waitFor(() => page.locator('ol#leftnav li').count().then((count) => count === TOTAL_QUESTION_COUNT), 'all-block review nav did not render 120 questions');

  const reviewState = await page.evaluate(async ({ expectedAnswers, choices, totalQuestionCount, questionCountPerBlock }) => {
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const parseLabel = () => {
      const label = document.querySelector('#f120-review-current-label')?.textContent || '';
      const match = label.match(/Block\s+(\d+)\s+·\s+Item\s+(\d+)/i) || label.match(/Block\s+(\d+).*Item\s+(\d+)/i);
      return { label, blockNumber: Number(match && match[1] || 0), itemIndex: Number(match && match[2] || 0) };
    };
    const navItems = [...document.querySelectorAll('ol#leftnav li')];
    const summaries = [];
    for (const nav of navItems) {
      nav.click();
      await waitFrame();
      await waitFrame();
      const position = parseLabel();
      const key = `${position.blockNumber}:${position.itemIndex}`;
      const rows = [...document.querySelectorAll('#medley ol.options > li.stContext')];
      const inputs = rows.map((row) => row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]')).filter(Boolean);
      const optionValues = inputs.map((input) => input.getAttribute('value') || '');
      const optionTexts = rows.map((row) => (row.textContent || '').replace(/\s+/g, ' ').trim());
      const selectedRow = document.querySelector('#medley ol.options [aria-selected="true"], #medley .f120-review-option-row[aria-selected="true"]');
      const selected = (inputs.find((input) => input.checked) || {}).value || (selectedRow ? (selectedRow.getAttribute('data-review-input-value') || selectedRow.getAttribute('data-review-option-letter') || '') : '');
      const expected = expectedAnswers[key] || '';
      summaries.push({
        navIndex: Number(nav.querySelector('.index')?.textContent || 0),
        questionId: nav.getAttribute('data-question-id') || '',
        ...position,
        key,
        selected,
        expected,
        stemVisible: document.body.innerText.includes(`Synthetic Step 1 Block ${position.blockNumber} Q${position.itemIndex} stem`),
        optionValues,
        optionTexts,
        optionsMatch: JSON.stringify(optionValues) === JSON.stringify(choices)
          && choices.every((choice) => optionTexts.some((text) => text.includes(`Synthetic Step 1 Block ${position.blockNumber} Q${position.itemIndex} option ${choice}`))),
        optionCount: rows.length,
        correctCount: document.querySelectorAll('#medley .f120-review-option--correct').length,
        unavailable: document.body.innerText.includes('Stored rendered item snapshot unavailable'),
      });
    }
    const blockCounts = summaries.reduce((counts, summary) => {
      counts[summary.blockNumber] = (counts[summary.blockNumber] || 0) + 1;
      return counts;
    }, {});
    const seen = new Set();
    const duplicateKeys = [];
    summaries.forEach((summary) => {
      if (seen.has(summary.key)) duplicateKeys.push(summary.key);
      seen.add(summary.key);
    });
    const expectedKeys = [];
    for (let blockNumber = 1; blockNumber <= Math.ceil(totalQuestionCount / questionCountPerBlock); blockNumber += 1) {
      for (let itemIndex = 1; itemIndex <= questionCountPerBlock; itemIndex += 1) expectedKeys.push(`${blockNumber}:${itemIndex}`);
    }
    return {
      navCount: navItems.length,
      navAnsweredCount: navItems.filter((item) => item.querySelector('.ans_status')?.classList.contains('f120-review-answered')).length,
      blockFilterOptions: [...document.querySelectorAll('#f120-review-block-filter option')].map((option) => option.value),
      blockCounts,
      duplicateKeys,
      missingKeys: expectedKeys.filter((key) => !seen.has(key)),
      selectionMismatches: summaries.filter((summary) => summary.selected !== summary.expected).map((summary) => ({ key: summary.key, expected: summary.expected, selected: summary.selected })).slice(0, 20),
      contentFailures: summaries.filter((summary) => !(summary.stemVisible && summary.optionCount === choices.length && summary.correctCount === 1 && !summary.unavailable)).slice(0, 20),
      optionMismatches: summaries.filter((summary) => !summary.optionsMatch).map((summary) => ({ key: summary.key, optionValues: summary.optionValues, optionTexts: summary.optionTexts })).slice(0, 20),
      uniqueQuestionIds: new Set(summaries.map((summary) => summary.questionId)).size,
      firstFiveSelections: Object.fromEntries(summaries.slice(0, 5).map((summary) => [summary.key, summary.selected])),
      lastFiveSelections: Object.fromEntries(summaries.slice(-5).map((summary) => [summary.key, summary.selected])),
    };
  }, { expectedAnswers: USER_ANSWERS, choices: CHOICES, totalQuestionCount: TOTAL_QUESTION_COUNT, questionCountPerBlock: QUESTION_COUNT_PER_BLOCK });

  assert(reviewState.navCount === TOTAL_QUESTION_COUNT, 'all-block review nav count mismatch', reviewState);
  assert(reviewState.navAnsweredCount === TOTAL_QUESTION_COUNT, 'all-block review answered nav count mismatch', reviewState);
  assert(JSON.stringify(reviewState.blockCounts) === JSON.stringify({ 1: 40, 2: 40, 3: 40 }), 'all-block review block counts mismatch', reviewState.blockCounts);
  assert(reviewState.blockFilterOptions.includes('1') && reviewState.blockFilterOptions.includes('2') && reviewState.blockFilterOptions.includes('3'), 'all-block review block filter missing blocks', reviewState.blockFilterOptions);
  assert(reviewState.uniqueQuestionIds === TOTAL_QUESTION_COUNT, 'all-block review question IDs duplicated or missing', reviewState.uniqueQuestionIds);
  assert(reviewState.duplicateKeys.length === 0 && reviewState.missingKeys.length === 0, 'all-block review block/item keys duplicated or missing', { duplicateKeys: reviewState.duplicateKeys, missingKeys: reviewState.missingKeys });
  assert(reviewState.contentFailures.length === 0, 'all-block review question content incomplete', reviewState.contentFailures);
  assert(reviewState.optionMismatches.length === 0, 'all-block review options did not match captured options', reviewState.optionMismatches);
  assert(reviewState.selectionMismatches.length === 0, 'all-block review selected answers did not match random selections', reviewState.selectionMismatches);

  return {
    ok: true,
    browser: await page.evaluate(() => navigator.userAgent),
    qbank: {
      status: qbank.result.status,
      capturedDefinitions: qbank.result.capturedDefinitions,
      questionCount: qbank.result.questionCount,
      knownAnswerCount: qbank.result.knownAnswerCount,
    },
    completion,
    review: {
      navCount: reviewState.navCount,
      navAnsweredCount: reviewState.navAnsweredCount,
      blockCounts: reviewState.blockCounts,
      firstFiveSelections: reviewState.firstFiveSelections,
      lastFiveSelections: reviewState.lastFiveSelections,
    },
  };
}
