async page => {
  const ORIGIN = 'https://orientation.nbme.org';
  const LAUNCH_URL = `${ORIGIN}/Launch/USMLE`;
  const STEP_KEY = 'step1';
  const BLOCK_LABEL = 'Step 1 All Blocks';
  const BLOCK_COUNT = 3;
  const QUESTION_COUNT_PER_BLOCK = 40;
  const TOTAL_QUESTION_COUNT = BLOCK_COUNT * QUESTION_COUNT_PER_BLOCK;
  const RANDOM_SEED = 0xf120ab;
  const EXPECTED_QBANK_DEFINITIONS = ['STPF1C0137', 'STPF1C0138', 'STPF1C0139'];

  const fail = (message, details) => {
    const suffix = details ? `\n${JSON.stringify(details, null, 2).slice(0, 6000)}` : '';
    const error = new Error(`${message}${suffix}`);
    error.details = details || null;
    throw error;
  };
  const assert = (condition, message, details) => {
    if (!condition) fail(message, details);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const waitFor = async (predicate, message, timeoutMs = 30000, intervalMs = 250) => {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      try {
        last = await predicate();
        if (last) return last;
      } catch (error) {
        last = error && (error.message || String(error));
      }
      await wait(intervalMs);
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

  const summarizeAttempt = async () => page.evaluate(async () => {
    const helper = window.Free120Helper;
    const attempt = helper.tracking.getAttempt();
    if (!attempt) return null;
    const progressByBlock = attempt.source && attempt.source.progress && attempt.source.progress.byBlock
      ? Object.fromEntries(Object.entries(attempt.source.progress.byBlock).map(([block, progress]) => [block, {
          total: progress.total,
          answered: progress.answered,
          questionIdsCount: (progress.questionIds || []).length,
          answeredQuestionIdsCount: (progress.answeredQuestionIds || []).length,
        }]))
      : {};
    const metadataBlockCounts = (attempt.blockMetadata || []).reduce((counts, block) => {
      counts[block.blockNumber] = { itemCount: block.itemCount, answeredCount: block.answeredCount || 0 };
      return counts;
    }, {});
    return {
      attemptId: attempt.id,
      status: attempt.status,
      reviewReady: attempt.reviewReady,
      questionCount: attempt.questionCount,
      questionIdsCount: (attempt.questionIds || []).length,
      responseCount: Object.values(attempt.responses || {}).filter(Boolean).length,
      launchedScope: attempt.launchedScope,
      progressByBlock,
      metadataBlockCounts,
      answerKeyCapture: attempt.answerKeyCapture,
    };
  });

  const waitForBlockReady = async (blockNumber) => waitFor(() => page.evaluate(({ blockNumber, blockCount, questionCountPerBlock }) => {
    const helper = window.Free120Helper;
    if (!helper || !helper.webfred) return false;
    const state = helper.webfred.readState();
    const bodyText = document.body ? document.body.innerText || '' : '';
    const visibleInputs = Array.from(document.querySelectorAll('input.NBOptionInput'))
      .filter((input) => input.offsetParent !== null || input.getClientRects().length);
    let nativeCurrentBlock = 0;
    let nativeBlockCount = 0;
    try {
      const injector = window.angular && window.angular.element(document.body).injector();
      const itemService = injector && injector.get('itemService');
      nativeCurrentBlock = Number(itemService && itemService.blockInfo && itemService.blockInfo.currentBlock) + 1;
      nativeBlockCount = Number(itemService && itemService.blockInfo && itemService.blockInfo.blockCount) || 0;
    } catch (_error) {}
    return Boolean(
      state
        && state.currentBlock === blockNumber
        && state.blockCount >= blockCount
        && state.itemCount >= questionCountPerBlock
        && Array.isArray(state.itemList)
        && state.itemList.length >= questionCountPerBlock
        && visibleInputs.length > 0
        && new RegExp(`Block\\s*:\\s*${blockNumber}\\s+of\\s+${blockCount}`, 'i').test(bodyText)
        && (!nativeCurrentBlock || nativeCurrentBlock === blockNumber)
        && (!nativeBlockCount || nativeBlockCount === blockCount)
    );
  }, { blockNumber, blockCount: BLOCK_COUNT, questionCountPerBlock: QUESTION_COUNT_PER_BLOCK }), `real NBME Step 1 All Blocks block ${blockNumber} did not become ready`, 120000, 500);

  const answerItem = async (blockNumber, itemIndex, random) => {
    await page.evaluate(({ itemIndex }) => {
      const injector = window.angular.element(document.body).injector();
      const itemService = injector.get('itemService');
      const scope = window.angular.element(document.body).scope();
      itemService.setCurrItem(itemIndex);
      if (scope && scope.$applyAsync) scope.$applyAsync();
    }, { itemIndex });

    const itemNumber = itemIndex + 1;
    await waitFor(() => page.evaluate(({ blockNumber, itemNumber }) => {
      const helper = window.Free120Helper;
      const state = helper && helper.webfred && helper.webfred.readState();
      const visibleInputs = Array.from(document.querySelectorAll('input.NBOptionInput'))
        .filter((input) => input.offsetParent !== null || input.getClientRects().length);
      let nativeIndex = 0;
      let nativeBlock = 0;
      let nativeComponentId = '';
      let answerBoxInputCount = 0;
      try {
        const injector = window.angular.element(document.body).injector();
        const itemService = injector.get('itemService');
        nativeIndex = Number(itemService && itemService.currItem && itemService.currItem.index) + 1;
        nativeBlock = Number(itemService && itemService.blockInfo && itemService.blockInfo.currentBlock) + 1;
        nativeComponentId = itemService && itemService.currItem && (itemService.currItem.compID || itemService.currItem.componentId || itemService.currItem.componentID) || '';
        const answerInputs = nativeComponentId ? Array.from(document.querySelectorAll(`input.NBOptionInput[name="${nativeComponentId}"]`)) : [];
        answerBoxInputCount = answerInputs.filter((input) => input.offsetParent !== null || input.getClientRects().length).length;
      } catch (_error) {}
      const readiness = {
        ready: Boolean(
          state
            && state.currentBlock === blockNumber
            && state.currentItem
            && state.currentItem.itemIndex === itemNumber
            && state.currentItem.identitySource === 'component-medley'
            && (!nativeComponentId || state.currentItem.componentId === nativeComponentId)
            && visibleInputs.length > 0
            && (answerBoxInputCount > 0 || visibleInputs.some((input) => input.name === nativeComponentId))
            && (!nativeIndex || nativeIndex === itemNumber)
            && (!nativeBlock || nativeBlock === blockNumber)
        ),
        stateBlock: state && state.currentBlock,
        stateItemIndex: state && state.currentItem && state.currentItem.itemIndex,
        stateComponentId: state && state.currentItem && state.currentItem.componentId,
        stateIdentitySource: state && state.currentItem && state.currentItem.identitySource,
        nativeIndex,
        nativeBlock,
        nativeComponentId,
        visibleInputCount: visibleInputs.length,
        visibleInputNames: visibleInputs.map((input) => input.name).slice(0, 10),
        answerBoxInputCount,
        bodyHeader: (document.body && document.body.innerText || '').match(/Item:\s*\d+\s*of\s*\d+\s*Block:\s*\d+\s*of\s*\d+/)?.[0] || '',
      };
      if (!readiness.ready) {
        throw new Error(JSON.stringify(readiness));
      }
      return readiness;
    }, { blockNumber, itemNumber }), `real NBME item did not become ready for block ${blockNumber} item ${itemNumber}`, 60000, 250);

    const candidate = await page.evaluate(() => {
      const helper = window.Free120Helper;
      const state = helper.webfred.readState();
      const injector = window.angular.element(document.body).injector();
      const itemService = injector.get('itemService');
      const componentId = itemService.currItem && (itemService.currItem.compID || itemService.currItem.componentId || itemService.currItem.componentID);
      const matchingItem = (state.itemList || []).find((item) => item.componentId === componentId)
        || state.currentItem
        || {};
      const inputs = Array.from(componentId ? document.querySelectorAll(`input.NBOptionInput[name="${componentId}"]`) : document.querySelectorAll('input.NBOptionInput'))
        .filter((input) => input.offsetParent !== null || input.getClientRects().length);
      return {
        values: inputs.map((input) => input.value).filter(Boolean),
        questionId: matchingItem.questionId || '',
        componentId,
        medleyId: itemService.currItem && itemService.currItem.medleyId,
        stateBlock: state.currentBlock,
        stateItemIndex: matchingItem.itemIndex || (state.currentItem && state.currentItem.itemIndex) || 0,
      };
    });
    assert(candidate.values.length > 0, `no visible answer choices for real NBME block ${blockNumber} item ${itemNumber}`, candidate);
    assert(candidate.questionId, `trusted question id unavailable for real NBME block ${blockNumber} item ${itemNumber}`, candidate);

    const selected = candidate.values[Math.floor(random() * candidate.values.length)] || candidate.values[0];
    const row = await page.evaluate(async ({ blockNumber, itemNumber, selected }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const helper = window.Free120Helper;
      const injector = window.angular.element(document.body).injector();
      const itemService = injector.get('itemService');
      const scope = window.angular.element(document.body).scope();
      const componentId = itemService.currItem && (itemService.currItem.compID || itemService.currItem.componentId || itemService.currItem.componentID);
      const inputs = Array.from(componentId ? document.querySelectorAll(`input.NBOptionInput[name="${componentId}"]`) : document.querySelectorAll('input.NBOptionInput'))
        .filter((input) => input.offsetParent !== null || input.getClientRects().length);
      const input = inputs.find((candidateInput) => candidateInput.value === selected) || inputs[0];
      if (!input) {
        throw new Error(`No input available for real NBME block ${blockNumber} item ${itemNumber}`);
      }
      input.click();
      if (scope && scope.$applyAsync) scope.$applyAsync();
      await sleep(250);
      await helper.tracking.flush('real-all-blocks-answer');
      const state = helper.webfred.readState();
      const matchingItem = (state.itemList || []).find((item) => item.componentId === componentId)
        || state.currentItem
        || {};
      const attempt = helper.tracking.getAttempt();
      const questionId = matchingItem.questionId || '';
      return {
        blockNumber,
        itemIndex: itemNumber,
        selected,
        visibleValues: inputs.map((candidateInput) => candidateInput.value).filter(Boolean),
        questionId,
        componentId,
        medleyId: itemService.currItem && itemService.currItem.medleyId,
        stateBlock: state.currentBlock,
        stateItemIndex: matchingItem.itemIndex || (state.currentItem && state.currentItem.itemIndex) || 0,
        selectedAnswerId: matchingItem.selectedAnswerId || (state.currentItem && state.currentItem.selectedAnswerId) || '',
        trackedResponse: questionId && attempt && attempt.responses ? attempt.responses[questionId] || '' : '',
      };
    }, { blockNumber, itemNumber, selected });

    await waitFor(() => page.evaluate(({ questionId, selected }) => {
      const helper = window.Free120Helper;
      const attempt = helper && helper.tracking && helper.tracking.getAttempt();
      return Boolean(attempt && attempt.responses && attempt.responses[questionId] === selected);
    }, { questionId: row.questionId, selected }), `answer not tracked for real NBME block ${blockNumber} item ${itemNumber}`, 30000, 250);

    return row;
  };

  const advanceToNextBlock = async (blockNumber) => {
    await page.evaluate(({ lastIndex }) => {
      const injector = window.angular.element(document.body).injector();
      const itemService = injector.get('itemService');
      const scope = window.angular.element(document.body).scope();
      itemService.setCurrItem(lastIndex);
      if (scope && scope.$applyAsync) scope.$applyAsync();
    }, { lastIndex: QUESTION_COUNT_PER_BLOCK - 1 });
    await wait(300);
    await page.evaluate(() => {
      window.confirm = () => true;
      const injector = window.angular.element(document.body).injector();
      const itemService = injector.get('itemService');
      const scope = window.angular.element(document.body).scope();
      itemService.endBlock();
      if (scope && scope.$applyAsync) scope.$applyAsync();
    });
    await waitFor(() => page.evaluate(() => /Start\s+Next\s+Block/i.test(document.body && document.body.innerText || '')), `real NBME Start Next Block control missing after block ${blockNumber}`, 90000, 500);
    await page.locator('button, a').filter({ hasText: /Start\s+Next\s+Block/i }).first().click();
    await waitForBlockReady(blockNumber + 1);
    await page.evaluate(() => window.Free120Helper.tracking.flush('real-all-blocks-next-block'));
  };

  const captureQBankWithRetry = async () => {
    const attempts = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await page.evaluate(async (stepKey) => window.Free120Helper.qbankCache.captureAllAvailable({ stepKeys: [stepKey] }), STEP_KEY);
      attempts.push({
        status: result && result.status,
        capturedDefinitions: result && result.capturedDefinitions,
        failedDefinitions: result && result.failedDefinitions,
        questionCount: result && result.questionCount,
        knownAnswerCount: result && result.knownAnswerCount,
        errors: result && result.errors,
      });
      if (result && result.status === 'complete' && result.capturedDefinitions >= BLOCK_COUNT && result.questionCount >= TOTAL_QUESTION_COUNT && result.knownAnswerCount >= TOTAL_QUESTION_COUNT) {
        return result;
      }
      await wait(3000);
    }
    fail('real NBME Step 1 QBank capture did not complete after retries', attempts);
  };

  page.on('dialog', (dialog) => dialog.accept().catch(() => null));

  let launchLoaded = false;
  let launchLoadError = '';
  for (let attempt = 0; attempt < 3 && !launchLoaded; attempt += 1) {
    try {
      await page.goto(LAUNCH_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
      launchLoaded = true;
    } catch (error) {
      launchLoadError = error && (error.message || String(error));
      await wait(3000);
    }
  }
  assert(launchLoaded, 'real NBME launch page did not load', { launchLoadError });
  await waitFor(() => page.evaluate(() => Boolean(window.angular && document.querySelectorAll('input[type="radio"]').length >= 10)), 'real NBME launch page did not expose expected Angular/radio controls', 60000);
  await page.addScriptTag({ path: 'dist/free120-helper.user.js' });
  await waitFor(() => page.evaluate(() => Boolean(window.Free120Helper)), 'Free120Helper API not published on real launch page', 20000);
  await waitFor(() => page.evaluate(() => {
    try {
      const controller = document.querySelector('[ng-controller]');
      const scope = controller && window.angular.element(controller).scope();
      return Boolean(scope && scope.programs && scope.programs.exams && scope.programs.exams.length);
    } catch (_error) {
      return false;
    }
  }), 'real NBME launch Angular metadata unavailable', 60000);

  await page.evaluate(async () => {
    window.confirm = () => true;
    await window.Free120Helper.storage.clearAllHistory();
  });

  const qbankResult = await captureQBankWithRetry();

  const qbankStorage = await page.evaluate(async (expectedDefinitions) => {
    const helper = window.Free120Helper;
    const attempts = await helper.storage.listAttempts({ includeInProgress: true });
    const byDefinition = {};
    for (const testDefinitionName of expectedDefinitions) {
      const attempt = attempts.find((candidate) => String(candidate.id || '').includes(testDefinitionName));
      const snapshots = attempt ? await helper.storage.listQuestionSnapshots(attempt.id) : [];
      byDefinition[testDefinitionName] = {
        attemptId: attempt && attempt.id,
        status: attempt && attempt.status,
        questionCount: attempt && attempt.questionCount,
        knownAnswers: attempt && Object.keys(attempt.correctAnswers || {}).length,
        snapshotCount: snapshots.length,
      };
    }
    return byDefinition;
  }, EXPECTED_QBANK_DEFINITIONS);
  EXPECTED_QBANK_DEFINITIONS.forEach((testDefinitionName) => {
    const stored = qbankStorage[testDefinitionName] || {};
    assert(stored.attemptId && stored.questionCount === QUESTION_COUNT_PER_BLOCK && stored.knownAnswers === QUESTION_COUNT_PER_BLOCK && stored.snapshotCount === QUESTION_COUNT_PER_BLOCK, `stored real NBME ${testDefinitionName} QBank cache incomplete`, stored);
  });

  await page.getByLabel(BLOCK_LABEL).check();
  await page.evaluate(() => {
    window.confirm = () => true;
    const controller = document.querySelector('[ng-controller]');
    const scope = window.angular.element(controller).scope();
    scope.$apply(() => scope.launchExam());
  });
  await waitFor(() => page.evaluate(() => /\/webfred\//.test(window.location.href)), 'real NBME Step 1 All Blocks launch did not navigate to WebFRED', 90000);
  await waitFor(() => page.evaluate(() => document.querySelectorAll('ol#leftnav li').length >= 40 && document.querySelectorAll('input.NBOptionInput').length > 0), 'real NBME Step 1 All Blocks WebFRED UI did not become ready', 120000);

  await page.addScriptTag({ path: 'dist/free120-helper.user.js' });
  await waitFor(() => page.evaluate(() => Boolean(window.Free120Helper && window.Free120Helper.tracking && window.Free120Helper.webfred)), 'Free120Helper API not published on real WebFRED page', 20000);
  await waitForBlockReady(1);
  await waitFor(() => page.evaluate((count) => window.Free120Helper.tracking.getAttempt()?.questionCount >= count, QUESTION_COUNT_PER_BLOCK), 'tracking attempt did not initialize for real NBME Step 1 All Blocks', 30000);

  const random = makeSeededRandom(RANDOM_SEED);
  const rows = [];
  const selectedByPosition = {};
  for (let blockNumber = 1; blockNumber <= BLOCK_COUNT; blockNumber += 1) {
    await waitForBlockReady(blockNumber);
    for (let itemIndex = 0; itemIndex < QUESTION_COUNT_PER_BLOCK; itemIndex += 1) {
      const row = await answerItem(blockNumber, itemIndex, random);
      rows.push(row);
      selectedByPosition[`${blockNumber}:${itemIndex + 1}`] = row.selected;
    }

    const summary = await summarizeAttempt();
    const blockSummary = summary && summary.progressByBlock && summary.progressByBlock[String(blockNumber)];
    assert(blockSummary && blockSummary.answered === QUESTION_COUNT_PER_BLOCK && blockSummary.total === QUESTION_COUNT_PER_BLOCK, `real NBME block ${blockNumber} progress incomplete`, summary);

    if (blockNumber < BLOCK_COUNT) {
      await advanceToNextBlock(blockNumber);
    }
  }

  await page.evaluate(() => window.Free120Helper.tracking.flush('real-all-blocks-final'));
  const answerResult = await page.evaluate(async ({ rows, totalQuestionCount }) => {
    const helper = window.Free120Helper;
    const attempt = helper.tracking.getAttempt();
    const snapshots = await helper.storage.listQuestionSnapshots(attempt.id);
    const selectedByQuestionId = Object.fromEntries(rows.map((row) => [row.questionId, row.selected]));
    const mismatchedResponses = rows.filter((row) => attempt.responses[row.questionId] !== row.selected).map((row) => ({
      blockNumber: row.blockNumber,
      itemIndex: row.itemIndex,
      questionId: row.questionId,
      expected: row.selected,
      actual: attempt.responses[row.questionId] || '',
    }));
    const progressBlockCounts = Object.fromEntries(Object.entries((attempt.source && attempt.source.progress && attempt.source.progress.byBlock) || {}).map(([block, progress]) => [block, {
      total: progress.total,
      answered: progress.answered,
      questionIdsCount: (progress.questionIds || []).length,
      answeredQuestionIdsCount: (progress.answeredQuestionIds || []).length,
    }]));
    const metadataBlockCounts = (attempt.blockMetadata || []).reduce((counts, block) => {
      counts[block.blockNumber] = { itemCount: block.itemCount, answeredCount: block.answeredCount || 0 };
      return counts;
    }, {});
    return {
      attemptId: attempt.id,
      rows,
      selectedByQuestionId,
      questionCount: attempt.questionCount,
      questionIdsCount: (attempt.questionIds || []).length,
      responseCount: Object.values(attempt.responses || {}).filter(Boolean).length,
      uniqueQuestionIdsCount: new Set(attempt.questionIds || []).size,
      mismatchedResponses,
      answerKeyCapture: attempt.answerKeyCapture,
      snapshotCount: snapshots.length,
      progressBlockCounts,
      metadataBlockCounts,
      launchedScope: attempt.launchedScope,
      expectedCount: totalQuestionCount,
    };
  }, { rows, totalQuestionCount: TOTAL_QUESTION_COUNT });

  const answerResultSummary = {
    attemptId: answerResult.attemptId,
    questionCount: answerResult.questionCount,
    questionIdsCount: answerResult.questionIdsCount,
    uniqueQuestionIdsCount: answerResult.uniqueQuestionIdsCount,
    responseCount: answerResult.responseCount,
    snapshotCount: answerResult.snapshotCount,
    progressBlockCounts: answerResult.progressBlockCounts,
    metadataBlockCounts: answerResult.metadataBlockCounts,
    launchedScope: answerResult.launchedScope,
    answerKeyCapture: answerResult.answerKeyCapture,
    unansweredRows: answerResult.rows.filter((row) => !answerResult.selectedByQuestionId[row.questionId]).slice(0, 20),
    duplicateRowQuestionIds: answerResult.rows.map((row) => row.questionId).filter((questionId, index, values) => questionId && values.indexOf(questionId) !== index).slice(0, 20),
  };
  assert(answerResult.mismatchedResponses.length === 0, 'tracked responses did not match real NBME selected answers', answerResult.mismatchedResponses.slice(0, 20));
  assert(answerResult.questionIdsCount === TOTAL_QUESTION_COUNT && answerResult.uniqueQuestionIdsCount === TOTAL_QUESTION_COUNT, 'real NBME all-block question id coverage incomplete', answerResultSummary);
  assert(answerResult.responseCount === TOTAL_QUESTION_COUNT, 'real NBME all-block tracked response count incomplete', answerResultSummary);
  assert(answerResult.answerKeyCapture && answerResult.answerKeyCapture.status === 'complete' && answerResult.answerKeyCapture.knownCount >= TOTAL_QUESTION_COUNT, 'real NBME all-block QBank answer-key matching incomplete', answerResult.answerKeyCapture);
  [1, 2, 3].forEach((blockNumber) => {
    const progress = answerResult.progressBlockCounts[String(blockNumber)] || {};
    const metadata = answerResult.metadataBlockCounts[String(blockNumber)] || answerResult.metadataBlockCounts[blockNumber] || {};
    assert(progress.total === QUESTION_COUNT_PER_BLOCK && progress.answered === QUESTION_COUNT_PER_BLOCK && metadata.itemCount === QUESTION_COUNT_PER_BLOCK && metadata.answeredCount === QUESTION_COUNT_PER_BLOCK, `real NBME all-block metadata/progress incomplete for block ${blockNumber}`, { progress, metadata, answerResult });
  });

  const completion = await page.evaluate(async (attemptId) => {
    const helper = window.Free120Helper;
    await helper.storage.updateAttempt(attemptId, {
      status: 'completed',
      reviewReady: true,
      completedAt: new Date().toISOString(),
    });
    const attempt = await helper.storage.getAttempt(attemptId);
    const snapshots = await helper.storage.listQuestionSnapshots(attemptId);
    return {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        reviewReady: attempt.reviewReady,
        questionCount: attempt.questionCount,
        questionIdsCount: (attempt.questionIds || []).length,
        responseCount: Object.values(attempt.responses || {}).filter(Boolean).length,
        blockMetadata: attempt.blockMetadata,
      },
      html: helper.review.buildReviewHtml(attempt, snapshots),
    };
  }, answerResult.attemptId);
  assert(completion.attempt.status === 'completed' && completion.attempt.reviewReady === true, 'real NBME Step 1 All Blocks attempt did not become review-ready', completion.attempt);
  assert(completion.attempt.questionIdsCount === TOTAL_QUESTION_COUNT && completion.attempt.responseCount === TOTAL_QUESTION_COUNT, 'real NBME Step 1 All Blocks completion counts incomplete', completion.attempt);

  await page.setContent(completion.html, { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.locator('#f120-review-root').count(), 'real NBME Step 1 All Blocks Review Mode root did not render', 15000);
  await waitFor(() => page.locator('ol#leftnav li').count().then((count) => count === TOTAL_QUESTION_COUNT), 'real NBME Step 1 All Blocks Review Mode did not render 120 nav questions', 20000);

  const review = await page.evaluate(async ({ selectedByPosition, totalQuestionCount, questionCountPerBlock, blockCount }) => {
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const parseLabel = () => {
      const label = document.querySelector('#f120-review-current-label')?.textContent || '';
      const match = label.match(/Block\s+(\d+)\s+·\s+Item\s+(\d+)/i) || label.match(/Block\s+(\d+).*Item\s+(\d+)/i);
      return { label, blockNumber: Number(match && match[1] || 0), itemIndex: Number(match && match[2] || 0) };
    };
    const navItems = Array.from(document.querySelectorAll('ol#leftnav li'));
    const summaries = [];
    for (const nav of navItems) {
      nav.click();
      await waitFrame();
      await waitFrame();
      const position = parseLabel();
      const key = `${position.blockNumber}:${position.itemIndex}`;
      const rows = Array.from(document.querySelectorAll('#medley ol.options > li.stContext, #medley .NBOptionListComp.answerbox li.stContext, #medley li.stContext'));
      const inputs = Array.from(document.querySelectorAll('#medley input.NBOptionInput, #medley input[type="radio"], #medley input[type="checkbox"]'));
      const optionValues = inputs.map((input) => input.getAttribute('value') || '').filter(Boolean);
      const selected = (inputs.find((input) => input.checked) || {}).value || '';
      const expected = selectedByPosition[key] || '';
      summaries.push({
        navIndex: Number(nav.querySelector('.index')?.textContent || 0),
        questionId: nav.getAttribute('data-question-id') || '',
        ...position,
        key,
        selected,
        expected,
        optionValues,
        optionCount: rows.length,
        correctCount: document.querySelectorAll('#medley .f120-review-option--correct').length,
        unavailable: document.body.innerText.includes('Stored rendered item snapshot unavailable'),
        inputCount: inputs.length,
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
    for (let blockNumber = 1; blockNumber <= blockCount; blockNumber += 1) {
      for (let itemIndex = 1; itemIndex <= questionCountPerBlock; itemIndex += 1) {
        expectedKeys.push(`${blockNumber}:${itemIndex}`);
      }
    }
    return {
      navCount: navItems.length,
      navAnsweredCount: navItems.filter((item) => item.querySelector('.ans_status')?.classList.contains('f120-review-answered')).length,
      blockFilterOptions: Array.from(document.querySelectorAll('#f120-review-block-filter option')).map((option) => option.value),
      blockCounts,
      duplicateKeys,
      missingKeys: expectedKeys.filter((key) => !seen.has(key)),
      selectionMismatches: summaries.filter((summary) => summary.selected !== summary.expected).map((summary) => ({ key: summary.key, expected: summary.expected, selected: summary.selected })).slice(0, 20),
      contentFailures: summaries.filter((summary) => !(summary.inputCount >= 2 && summary.correctCount === 1 && !summary.unavailable && summary.optionValues.includes(summary.expected))).map((summary) => ({
        key: summary.key,
        optionCount: summary.optionCount,
        inputCount: summary.inputCount,
        correctCount: summary.correctCount,
        unavailable: summary.unavailable,
        expectedInOptions: summary.optionValues.includes(summary.expected),
      })).slice(0, 20),
      uniqueQuestionIds: new Set(summaries.map((summary) => summary.questionId)).size,
      firstFiveSelections: Object.fromEntries(summaries.slice(0, 5).map((summary) => [summary.key, summary.selected])),
      lastFiveSelections: Object.fromEntries(summaries.slice(-5).map((summary) => [summary.key, summary.selected])),
      expectedCount: totalQuestionCount,
    };
  }, { selectedByPosition, totalQuestionCount: TOTAL_QUESTION_COUNT, questionCountPerBlock: QUESTION_COUNT_PER_BLOCK, blockCount: BLOCK_COUNT });

  assert(review.navCount === TOTAL_QUESTION_COUNT, 'real NBME Step 1 All Blocks Review Mode nav count mismatch', review);
  assert(review.navAnsweredCount === TOTAL_QUESTION_COUNT, 'real NBME Step 1 All Blocks Review Mode answered nav count mismatch', review);
  assert(JSON.stringify(review.blockCounts) === JSON.stringify({ 1: 40, 2: 40, 3: 40 }), 'real NBME Step 1 All Blocks Review Mode block counts mismatch', review.blockCounts);
  assert(review.blockFilterOptions.includes('1') && review.blockFilterOptions.includes('2') && review.blockFilterOptions.includes('3'), 'real NBME Step 1 All Blocks Review Mode block filter missing blocks', review.blockFilterOptions);
  assert(review.uniqueQuestionIds === TOTAL_QUESTION_COUNT, 'real NBME Step 1 All Blocks Review Mode question IDs duplicated or missing', review.uniqueQuestionIds);
  assert(review.duplicateKeys.length === 0 && review.missingKeys.length === 0, 'real NBME Step 1 All Blocks Review Mode block/item keys duplicated or missing', { duplicateKeys: review.duplicateKeys, missingKeys: review.missingKeys });
  assert(review.contentFailures.length === 0, 'real NBME Step 1 All Blocks Review Mode question content incomplete', review.contentFailures);
  assert(review.selectionMismatches.length === 0, 'real NBME Step 1 All Blocks Review Mode selected answers did not match random selections', review.selectionMismatches);

  return {
    ok: true,
    mode: 'real-step1-all-blocks',
    browser: await page.evaluate(() => navigator.userAgent),
    qbank: {
      status: qbankResult.status,
      capturedDefinitions: qbankResult.capturedDefinitions,
      questionCount: qbankResult.questionCount,
      knownAnswerCount: qbankResult.knownAnswerCount,
      storedBlocks: qbankStorage,
    },
    tracking: {
      attemptId: answerResult.attemptId,
      launchedScope: answerResult.launchedScope,
      questionCount: answerResult.questionCount,
      questionIdsCount: answerResult.questionIdsCount,
      responseCount: answerResult.responseCount,
      snapshotCount: answerResult.snapshotCount,
      progressBlockCounts: answerResult.progressBlockCounts,
      metadataBlockCounts: answerResult.metadataBlockCounts,
      answerKeyCapture: answerResult.answerKeyCapture,
    },
    review: {
      navCount: review.navCount,
      navAnsweredCount: review.navAnsweredCount,
      blockCounts: review.blockCounts,
      firstFiveSelections: review.firstFiveSelections,
      lastFiveSelections: review.lastFiveSelections,
    },
  };
}
