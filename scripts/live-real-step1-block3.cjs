async page => {
  const ORIGIN = 'https://orientation.nbme.org';
  const LAUNCH_URL = `${ORIGIN}/Launch/USMLE`;
  const QUESTION_COUNT = 40;
  const STEP_KEY = 'step1';
  const BLOCK_LABEL = 'Step 1 Block 3';
  const TEST_DEFINITION_NAME = 'STPF1C0139';
  const RANDOM_SEED = 0xf120b3;

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

  page.on('dialog', (dialog) => dialog.accept().catch(() => null));

  await page.goto(LAUNCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
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

  const qbankResult = await page.evaluate(async (stepKey) => window.Free120Helper.qbankCache.captureAllAvailable({ stepKeys: [stepKey] }), STEP_KEY);
  assert(qbankResult && qbankResult.status === 'complete', 'real NBME Step 1 QBank capture did not complete', qbankResult);
  assert(qbankResult.capturedDefinitions >= 3, 'real NBME Step 1 QBank capture did not capture all Step 1 blocks', qbankResult);
  assert(qbankResult.questionCount >= 120 && qbankResult.knownAnswerCount >= 120, 'real NBME Step 1 QBank capture counts are incomplete', qbankResult);

  const qbankStorage = await page.evaluate(async (testDefinitionName) => {
    const helper = window.Free120Helper;
    const attempts = await helper.storage.listAttempts({ includeInProgress: true });
    const blockAttempt = attempts.find((attempt) => String(attempt.id || '').includes(testDefinitionName));
    const snapshots = blockAttempt ? await helper.storage.listQuestionSnapshots(blockAttempt.id) : [];
    return {
      attemptId: blockAttempt && blockAttempt.id,
      status: blockAttempt && blockAttempt.status,
      questionCount: blockAttempt && blockAttempt.questionCount,
      knownAnswers: blockAttempt && Object.keys(blockAttempt.correctAnswers || {}).length,
      snapshotCount: snapshots.length,
      firstQuestionId: snapshots[0] && snapshots[0].questionId,
    };
  }, TEST_DEFINITION_NAME);
  assert(qbankStorage.attemptId && qbankStorage.questionCount === QUESTION_COUNT && qbankStorage.knownAnswers === QUESTION_COUNT && qbankStorage.snapshotCount === QUESTION_COUNT, 'stored real NBME Block 3 QBank cache incomplete', qbankStorage);

  await page.getByLabel(BLOCK_LABEL).check();
  await page.evaluate(() => {
    window.confirm = () => true;
    const controller = document.querySelector('[ng-controller]');
    const scope = window.angular.element(controller).scope();
    scope.$apply(() => scope.launchExam());
  });
  await waitFor(() => page.evaluate(() => /\/webfred\//.test(window.location.href)), 'real NBME launch did not navigate to WebFRED', 90000);
  await waitFor(() => page.evaluate((count) => document.querySelectorAll('ol#leftnav li').length >= count && document.querySelectorAll('input.NBOptionInput').length > 0, QUESTION_COUNT), 'real NBME WebFRED Block 3 UI did not become ready', 120000);

  await page.addScriptTag({ path: 'dist/free120-helper.user.js' });
  await waitFor(() => page.evaluate(() => Boolean(window.Free120Helper && window.Free120Helper.tracking && window.Free120Helper.webfred)), 'Free120Helper API not published on real WebFRED page', 20000);
  await waitFor(() => page.evaluate((count) => window.Free120Helper.tracking.getAttempt()?.questionCount >= count, QUESTION_COUNT), 'tracking attempt did not initialize for real NBME Block 3', 30000);

  const answerResult = await page.evaluate(async ({ questionCount, randomSeed }) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const random = (() => {
      let state = randomSeed >>> 0;
      return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    })();
    const helper = window.Free120Helper;
    const injector = window.angular.element(document.body).injector();
    const itemService = injector.get('itemService');
    const scope = window.angular.element(document.body).scope();
    await helper.tracking.flush('real-validation-settle');

    const rows = [];
    for (let index = 0; index < questionCount; index += 1) {
      itemService.setCurrItem(index);
      if (scope && scope.$applyAsync) scope.$applyAsync();
      await sleep(index < 2 ? 800 : 250);

      const inputs = Array.from(document.querySelectorAll('input.NBOptionInput'))
        .filter((input) => input.offsetParent !== null || input.getClientRects().length);
      const values = inputs.map((input) => input.value).filter(Boolean);
      if (!values.length) {
        throw new Error(`No visible answer choices for real NBME item ${index + 1}`);
      }
      const selected = values[Math.floor(random() * values.length)] || values[0];
      const input = inputs.find((candidate) => candidate.value === selected) || inputs[0];
      input.click();
      if (scope && scope.$applyAsync) scope.$applyAsync();
      await sleep(index < 2 ? 800 : 250);

      const state = helper.webfred.readState();
      await helper.tracking.flush('real-validation-answer');
      const current = state.currentItem || {};
      const componentId = itemService.currItem && (itemService.currItem.compID || itemService.currItem.componentId || itemService.currItem.componentID);
      const matchingItem = (state.itemList || []).find((item) => item.componentId === componentId)
        || (state.itemList || [])[index]
        || current;
      rows.push({
        index: index + 1,
        selected,
        componentId,
        medleyId: itemService.currItem && itemService.currItem.medleyId,
        questionId: matchingItem.questionId || current.questionId,
        selectedAnswerId: current.selectedAnswerId,
        visibleValues: values,
        nativeAnswer: componentId && itemService.answers && itemService.answers[componentId] && itemService.answers[componentId].answer,
      });
    }

    await helper.tracking.flush('real-validation-final');
    const attempt = helper.tracking.getAttempt();
    const selectedByQuestionId = Object.fromEntries(rows.map((row) => [row.questionId, row.selected]));
    const mismatchedResponses = rows.filter((row) => attempt.responses[row.questionId] !== row.selected).map((row) => ({
      index: row.index,
      questionId: row.questionId,
      expected: row.selected,
      actual: attempt.responses[row.questionId] || '',
    }));
    const trustedQuestionIds = (attempt.questionIds || []).filter((questionId) => questionId.includes(':USMLE:Block-3:'));
    const fallbackQuestionIds = (attempt.questionIds || []).filter((questionId) => !questionId.includes(':USMLE:Block-3:'));
    const snapshots = await helper.storage.listQuestionSnapshots(attempt.id);
    return {
      attemptId: attempt.id,
      rows,
      selectedByQuestionId,
      questionCount: attempt.questionCount,
      questionIdsCount: (attempt.questionIds || []).length,
      responseCount: Object.values(attempt.responses || {}).filter(Boolean).length,
      trustedQuestionIdsCount: trustedQuestionIds.length,
      fallbackQuestionIds,
      mismatchedResponses,
      answerKeyCapture: attempt.answerKeyCapture,
      snapshotCount: snapshots.length,
      snapshotQuestionIds: snapshots.map((snapshot) => snapshot.questionId),
    };
  }, { questionCount: QUESTION_COUNT, randomSeed: RANDOM_SEED });

  assert(answerResult.mismatchedResponses.length === 0, 'tracked responses did not match real NBME selected answers', answerResult.mismatchedResponses);
  assert(answerResult.responseCount >= QUESTION_COUNT, 'real NBME tracked response count incomplete', answerResult);
  assert(answerResult.trustedQuestionIdsCount >= QUESTION_COUNT, 'real NBME trusted question id coverage incomplete', answerResult);
  assert(answerResult.answerKeyCapture && answerResult.answerKeyCapture.status === 'complete' && answerResult.answerKeyCapture.knownCount >= QUESTION_COUNT, 'real NBME QBank answer-key matching incomplete', answerResult.answerKeyCapture);
  assert(answerResult.snapshotCount >= QUESTION_COUNT - 1, 'real NBME live snapshot capture unexpectedly low', answerResult);

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
        responseCount: Object.values(attempt.responses || {}).filter(Boolean).length,
      },
      html: helper.review.buildReviewHtml(attempt, snapshots),
    };
  }, answerResult.attemptId);
  assert(completion.attempt.status === 'completed' && completion.attempt.reviewReady === true, 'real NBME attempt did not become review-ready', completion.attempt);

  await page.setContent(completion.html, { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.locator('#f120-review-root').count(), 'real NBME Review Mode root did not render', 15000);
  await waitFor(() => page.locator('ol#leftnav li').count().then((count) => count === QUESTION_COUNT), 'real NBME Review Mode did not render 40 nav questions', 15000);

  const review = await page.evaluate(async ({ rows, questionCount }) => {
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const navItems = Array.from(document.querySelectorAll('ol#leftnav li'));
    const expectedByIndex = Object.fromEntries(rows.map((row) => [row.index, row.selected]));
    const summaries = [];
    for (const nav of navItems) {
      nav.click();
      await waitFrame();
      const label = document.querySelector('#f120-review-current-label')?.textContent || '';
      const itemIndex = Number((label.match(/Item\s+(\d+)/) || [])[1] || nav.querySelector('.index')?.textContent || 0);
      const selected = document.querySelector('#medley input.NBOptionInput:checked, #medley input[type="radio"]:checked, #medley ol.options input:checked')?.getAttribute('value') || '';
      summaries.push({
        navIndex: Number(nav.querySelector('.index')?.textContent || 0),
        itemIndex,
        selected,
        expected: expectedByIndex[itemIndex] || '',
        unavailable: document.body.innerText.includes('Stored rendered item snapshot unavailable'),
        inputCount: document.querySelectorAll('#medley input.NBOptionInput, #medley input[type="radio"], #medley ol.options input').length,
      });
    }
    return {
      navCount: navItems.length,
      navAnsweredCount: navItems.filter((item) => item.querySelector('.ans_status')?.classList.contains('f120-review-answered')).length,
      unavailableCount: summaries.filter((summary) => summary.unavailable).length,
      inputlessCount: summaries.filter((summary) => summary.inputCount === 0).length,
      mismatches: summaries.filter((summary) => summary.expected !== summary.selected),
      summaries,
      allExpectedIndexes: Array.from({ length: questionCount }, (_unused, index) => index + 1),
    };
  }, { rows: answerResult.rows, questionCount: QUESTION_COUNT });

  assert(review.navCount === QUESTION_COUNT, 'real NBME Review Mode nav count mismatch', review);
  assert(review.navAnsweredCount === QUESTION_COUNT, 'real NBME Review Mode answered nav count mismatch', review);
  assert(review.unavailableCount === 0, 'real NBME Review Mode has unavailable question snapshots', review);
  assert(review.inputlessCount === 0, 'real NBME Review Mode has questions without answer inputs', review);
  assert(review.mismatches.length === 0, 'real NBME Review Mode selected answers did not match selected answers', review.mismatches.slice(0, 10));

  return {
    ok: true,
    mode: 'real-step1-block3',
    qbank: {
      status: qbankResult.status,
      capturedDefinitions: qbankResult.capturedDefinitions,
      questionCount: qbankResult.questionCount,
      knownAnswerCount: qbankResult.knownAnswerCount,
      block3AttemptId: qbankStorage.attemptId,
    },
    tracking: {
      attemptId: answerResult.attemptId,
      questionCount: answerResult.questionCount,
      questionIdsCount: answerResult.questionIdsCount,
      responseCount: answerResult.responseCount,
      trustedQuestionIdsCount: answerResult.trustedQuestionIdsCount,
      fallbackQuestionIds: answerResult.fallbackQuestionIds,
      snapshotCount: answerResult.snapshotCount,
      answerKeyCapture: answerResult.answerKeyCapture,
    },
    review: {
      navCount: review.navCount,
      navAnsweredCount: review.navAnsweredCount,
      unavailableCount: review.unavailableCount,
      inputlessCount: review.inputlessCount,
      firstFiveSelections: Object.fromEntries(review.summaries.slice(0, 5).map((summary) => [summary.itemIndex, summary.selected])),
      lastFiveSelections: Object.fromEntries(review.summaries.slice(-5).map((summary) => [summary.itemIndex, summary.selected])),
    },
  };
}
