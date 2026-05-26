async page => {
  const ORIGIN = 'https://orientation.nbme.org';
  const LAUNCH_URL = `${ORIGIN}/Launch/USMLE`;
  const WEBFRED_URL = `${ORIGIN}/webfred/#/main?program=USMLE&exam=STPF1&section=STPF1C0139&testDefinitionName=STPF1C0139&testDefinitionDisplayName=Step%201%20Block%203&publicationName=LIVE120&block=3&mode=test`;
  const QBANK_ATTEMPT_ID = 'qbank-cache:USMLE:STPF1:STPF1C0139';
  const CHOICES = ['A', 'B', 'C', 'D'];
  const QUESTION_COUNT = 40;
  const ANSWER_RANDOM_SEED = 0xf120b3;
  const makeSeededRandom = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };
  const buildRandomAnswers = (count) => {
    const random = makeSeededRandom(ANSWER_RANDOM_SEED);
    return Object.fromEntries(Array.from({ length: count }, (_unused, index) => [index + 1, CHOICES[Math.floor(random() * CHOICES.length)]]));
  };
  const USER_ANSWERS = buildRandomAnswers(QUESTION_COUNT);
  const PNG_BYTES = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const WEBM_BYTES = 'GkXfo59ChYEBQveBAQ==';

  const fail = (message, details) => {
    const error = new Error(message);
    error.details = details || null;
    throw error;
  };
  const assert = (condition, message, details) => {
    if (!condition) fail(message, details);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const waitFor = async (predicate, message, timeoutMs = 15000) => {
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

  const pad = (index) => String(index).padStart(2, '0');
  const componentId = (index) => `COMP-B3-Q${pad(index)}`;
  const correctAnswer = (index) => CHOICES[index % CHOICES.length];
  const mediaHtml = (index) => {
    if (index === 8) {
      return '<div class="NBMediaPlayer" id="media-q8"><img src="api/Resource?name=step1-b3-q8.png" alt="Q8 image"><video src="api/Resource?name=step1-b3-q8.webm"></video></div>';
    }
    if (index === 40) {
      return '<div class="NBMediaPlayer" id="media-q40" data-media-id="B3Q40MEDIA"></div>';
    }
    return '';
  };
  const itemHtml = (index, selected = '') => {
    const component = componentId(index);
    const options = CHOICES.map((choice) => {
      const checked = selected === choice ? ' checked' : '';
      const klass = choice === correctAnswer(index) ? 'stContext correct' : 'stContext';
      return `<li class="${klass}"><input class="NBOptionInput" type="radio" name="${component}" value="${choice}"${checked}><span>${choice}. Synthetic Step 1 Block 3 Q${index} option ${choice}</span></li>`;
    }).join('');
    return `<div id="page-${pad(index)}" class="NBSinglePage"><div id="item-${pad(index)}" data-component-id="${component}" data-item-index="${index}"><div class="NBExposition">Synthetic Step 1 Block 3 Q${index} stem</div>${mediaHtml(index)}<div id="${component}_div" class="NBOptionListComp answerbox"><form><ol class="options">${options}</ol></form></div><fred-show-answer ans="${correctAnswer(index)}"></fred-show-answer></div></div>`;
  };
  const qbankBulkHtml = () => Array.from({ length: 40 }, (_unused, index) => itemHtml(index + 1)).join('\n');
  const launchHtml = () => '<!doctype html><html><head><title>USMLE Launch</title></head><body><main ng-controller="launch"><h1>USMLE</h1><label><input type="radio" name="block"> Step 1 Block 3</label><button>Start</button></main></body></html>';
  const webfredApp = (fixture) => {
    const choices = fixture.choices;
    const answers = {};
    let current = 1;
    const componentId = (index) => `COMP-B3-Q${String(index).padStart(2, '0')}`;
    const itemHtml = (index) => {
      const component = componentId(index);
      const selected = answers[index] || '';
      const media = index === 8
        ? '<div class="NBMediaPlayer" id="media-q8"><img src="api/Resource?name=step1-b3-q8.png" alt="Q8 image"><video src="api/Resource?name=step1-b3-q8.webm"></video></div>'
        : (index === 40 ? '<div class="NBMediaPlayer" id="media-q40" data-media-id="B3Q40MEDIA"></div>' : '');
      const rows = choices.map((choice, offset) => `<li class="${offset === index % choices.length ? 'stContext correct' : 'stContext'}"><input class="NBOptionInput" type="radio" name="${component}" value="${choice}"${selected === choice ? ' checked' : ''}><span>${choice}. Synthetic Step 1 Block 3 Q${index} option ${choice}</span></li>`).join('');
      return `<section id="item"><article id="content"><div id="medley" data-medley-id="MED-B3"><div id="item-${String(index).padStart(2, '0')}" data-component-id="${component}" data-item-index="${index}"><div class="NBExposition">Synthetic Step 1 Block 3 Q${index} stem</div>${media}<div id="${component}_div" class="NBOptionListComp answerbox"><form><ol class="options">${rows}</ol></form></div></div></div></article></section>`;
    };
    const renderExam = () => {
      document.body.innerHTML = `<main><h1>Step 1 Block 3</h1><div>Block 3 of 3</div><nav><ol id="leftnav">${Array.from({ length: 40 }, (_unused, index) => {
        const item = index + 1;
        return `<li id="nav-q${item}" data-medley-id="MED-B3" data-component-id="COMP-B3-Q${String(item).padStart(2, '0')}" class="${item === current ? 'currentitem ' : ''}${answers[item] ? 'answered' : ''}" ${item === current ? 'aria-current="true"' : ''}><span class="ans_status ${answers[item] ? 'answered' : ''}"></span><span class="index">${item}</span></li>`;
      }).join('')}</ol></nav>${itemHtml(current)}<button id="native-prev" type="button">Previous</button><button id="native-next" type="button">Next</button><button id="native-end" type="button">End Exam</button></main>`;
      document.querySelectorAll('#leftnav li').forEach((node) => node.addEventListener('click', () => { current = Number(node.querySelector('.index').textContent); renderExam(); }));
      document.querySelectorAll('input.NBOptionInput').forEach((input) => input.addEventListener('change', (event) => { answers[current] = event.target.value; renderExam(); }));
      document.querySelector('#native-prev').addEventListener('click', () => { current = Math.max(1, current - 1); renderExam(); });
      document.querySelector('#native-next').addEventListener('click', () => { current = Math.min(40, current + 1); renderExam(); });
      document.querySelector('#native-end').addEventListener('click', () => {
        window.__syntheticWebfredAnswers = { ...answers };
        location.hash = '!/endExam?program=USMLE&exam=STPF1&section=STPF1C0139&block=3';
        document.body.innerHTML = '<main><h1>Exam complete</h1><p>You have completed the exam.</p><a href="#">Close</a></main>';
      });
    };
    renderExam();
  };
  const webfredHtml = () => {
    const script = `(${webfredApp.toString()})(${JSON.stringify({ choices: CHOICES })});`;
    return `<!doctype html><html><head><title>Synthetic Step 1 Block 3 WebFRED</title><style>body{font-family:sans-serif}#leftnav{display:flex;flex-wrap:wrap;gap:4px;list-style:none;padding:0}#leftnav li{border:1px solid #999;padding:4px;cursor:pointer}.currentitem{background:#dbeafe}.answered .ans_status{background:#94a3b8}.NBMediaPlayer img{max-width:180px}</style></head><body><script>${script}</script></body></html>`;
  };

  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes('/Launch/USMLE') || requestUrl.endsWith('/Launch')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: launchHtml() });
    }
    if (requestUrl.includes('/webfred/api/services/WebFred/examStatus/GetExamStatus')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { examBlock: { medleys: [{ medleyId: 'MED-B3', items: Array.from({ length: 40 }, (_unused, index) => ({ componentId: componentId(index + 1), answerable: true })) }] } } }) });
    }
    if (requestUrl.includes('/webfred/api/Content/GetBulk')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ 'MED-B3': qbankBulkHtml() }) });
    }
    if (requestUrl.includes('/webfred/api/metadata/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ media: [{ id: 'diagram', src: 'api/Resource?name=step1-b3-q40.png' }, { id: 'clip', src: 'api/Resource?name=step1-b3-q40.webm' }], hotspots: [{ label: 'Synthetic Q40 hotspot', coords: '30,30,8', image: 'diagram', media: 'clip' }] }) });
    }
    if (requestUrl.includes('/webfred/api/Resource')) {
      const isImage = /\.(?:png|jpg|jpeg|gif|webp)(?:&|$)/i.test(requestUrl);
      return route.fulfill({ status: 200, contentType: isImage ? 'image/png' : 'video/webm', body: isImage ? PNG_BYTES : WEBM_BYTES });
    }
    if (requestUrl.includes('/webfred')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: webfredHtml() });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });

  const installLaunchAngular = async () => page.evaluate(() => {
    const scope = {
      program: 'USMLE',
      ipa: 'LIVE',
      programs: { name: 'USMLE', exams: [{ name: 'STPF1', description: 'Step 1 Free 120', examPublications: [{ publicationName: 'LIVE120', testDefinitions: [{ name: 'STPF1C0139', displayName: 'Step 1 Block 3' }] }] }] },
    };
    const injector = { get(name) { if (name === 'launchService') return { createSession: (params) => { window.__free120CreatedSessions = [...(window.__free120CreatedSessions || []), params]; return Promise.resolve({ data: { result: { examSession: { id: 'live-step1-block3-session' } } } }); } }; if (name === 'uuid2') return { newguid: () => 'live-guid' }; return {}; } };
    window.angular = { element(node) { return { scope: () => (node && node.hasAttribute && node.hasAttribute('ng-controller') ? scope : {}), injector: () => injector }; } };
  });

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
  await waitFor(() => page.evaluate(() => window.Free120Helper.qbankCache.getLastResult()?.status === 'complete'), 'QBank capture incomplete');
  const qbank = await page.evaluate(async (attemptId) => {
    const helper = window.Free120Helper;
    const attempt = await helper.storage.getAttempt(attemptId);
    const snapshots = await helper.storage.listQuestionSnapshots(attemptId);
    const byIndex = Object.fromEntries(snapshots.map((snapshot) => [snapshot.itemIndex, snapshot]));
    return {
      result: helper.qbankCache.getLastResult(),
      directResult: attempt ? null : helper.qbankCache.getLastResult(),
      questionCount: attempt && attempt.questionCount,
      knownAnswers: attempt && Object.keys(attempt.correctAnswers || {}).length,
      snapshotCount: snapshots.length,
      q8DataKeys: Object.keys((byIndex[8] && byIndex[8].resourceDataByUrl) || {}),
      q40Interactions: (byIndex[40] && byIndex[40].metadata && byIndex[40].metadata.mediaInteractions && byIndex[40].metadata.mediaInteractions.length) || 0,
      q40DataKeys: Object.keys((byIndex[40] && byIndex[40].resourceDataByUrl) || {}),
    };
  }, QBANK_ATTEMPT_ID);
  assert(qbank.result && qbank.result.status === 'complete', 'QBank capture status failed', qbank);
  assert(qbank.result.capturedDefinitions === 1, 'QBank captured definition count mismatch', qbank);
  assert(qbank.result.questionCount === 40 && qbank.result.knownAnswerCount === 40, 'QBank capture counts mismatch', qbank);
  assert(JSON.stringify(qbank.result.selectedStepKeys) === JSON.stringify(['step1']), 'QBank selected steps mismatch', qbank.result);
  assert(qbank.questionCount === 40 && qbank.knownAnswers === 40 && qbank.snapshotCount === 40, 'stored QBank attempt incomplete', qbank);
  assert(qbank.q8DataKeys.some((url) => url.includes('step1-b3-q8.png')), 'Q8 image not cached', qbank.q8DataKeys);
  assert(qbank.q8DataKeys.some((url) => url.includes('step1-b3-q8.webm')), 'Q8 video not cached', qbank.q8DataKeys);
  assert(qbank.q40Interactions === 1, 'Q40 media interaction not captured', qbank);
  assert(qbank.q40DataKeys.some((url) => url.includes('step1-b3-q40.png')), 'Q40 image not cached', qbank.q40DataKeys);
  assert(qbank.q40DataKeys.some((url) => url.includes('step1-b3-q40.webm')), 'Q40 video not cached', qbank.q40DataKeys);

  await page.goto(WEBFRED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await injectUserscript();
  await waitFor(() => page.locator('#f120-active-exam-pill').count(), 'active exam pill missing');
  await waitFor(() => page.evaluate(() => window.Free120Helper.tracking.getAttempt()?.questionCount === 40), 'tracking attempt not initialized to 40 questions');

  for (const [rawIndex, answer] of Object.entries(USER_ANSWERS)) {
    const index = Number(rawIndex);
    const selector = `input[name="${componentId(index)}"][value="${answer}"]`;
    await waitFor(() => page.locator(selector).count(), `answer option missing for item ${index}`);
    await page.locator(selector).check();
    await page.evaluate(() => window.Free120Helper.tracking.flush('live-answer'));
    await waitFor(() => page.evaluate((expected) => Object.values(window.Free120Helper.tracking.getAttempt()?.responses || {}).filter(Boolean).length === expected, index), `answer ${index} not tracked`);
    if (index < QUESTION_COUNT) await page.locator('#native-next').click();
  }

  await page.locator('#native-end').click();
  await waitFor(() => page.evaluate(() => document.body.innerText.includes('You have completed the exam')), 'end-exam screen missing');
  await page.evaluate(() => window.Free120Helper.tracking.flush('live-end-exam'));
  await waitFor(() => page.evaluate(() => window.Free120Helper.tracking.getAttempt()?.status === 'completed'), 'attempt did not complete', 15000);
  await waitFor(() => page.evaluate(() => {
    const cta = document.querySelector('#f120-end-exam-review-cta');
    const button = cta && cta.querySelector('button');
    return Boolean(cta && !cta.hidden && button && !button.disabled);
  }), 'review CTA not enabled', 15000);

  const completion = await page.evaluate(() => {
    const attempt = window.Free120Helper.tracking.getAttempt();
    return {
      status: attempt && attempt.status,
      reviewReady: attempt && attempt.reviewReady,
      questionCount: attempt && attempt.questionCount,
      answered: Object.values((attempt && attempt.responses) || {}).filter(Boolean).length,
      responses: attempt && attempt.responses,
      keyStatus: attempt && attempt.answerKeyCapture && attempt.answerKeyCapture.status,
      keyKnown: attempt && attempt.answerKeyCapture && attempt.answerKeyCapture.knownCount,
    };
  });
  assert(completion.status === 'completed' && completion.reviewReady === true, 'completed attempt not review-ready', completion);
  assert(completion.questionCount === QUESTION_COUNT && completion.answered === QUESTION_COUNT, 'completed attempt count mismatch', completion);
  assert(completion.keyStatus === 'complete' && completion.keyKnown === 40, 'completed attempt key mismatch', completion);

  await page.evaluate(() => { window.open = (url) => { window.__free120ReviewUrl = String(url || ''); return { closed: false, focus() {} }; }; });
  await page.evaluate(async () => window.Free120Helper.review.openAttempt(window.Free120Helper.tracking.getAttempt().id));
  const reviewHtml = await waitFor(async () => page.evaluate(async () => {
    const url = window.__free120ReviewUrl || '';
    if (!url) return '';
    const response = await fetch(url);
    return response.text();
  }), 'review HTML not opened', 10000);
  assert(reviewHtml.includes('id="f120-review-root"'), 'review root missing from generated review HTML');

  await page.setContent(reviewHtml, { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.locator('#f120-review-root').count(), 'review root not rendered');
  await waitFor(() => page.locator('ol#leftnav li').count().then((count) => count === 40), 'review nav did not render 40 questions');
  const reviewState = await page.evaluate(async () => {
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const navItems = [...document.querySelectorAll('ol#leftnav li')];
    const summaries = [];
    for (const nav of navItems) {
      nav.click();
      await waitFrame();
      const label = document.querySelector('#f120-review-current-label')?.textContent || '';
      const itemIndex = Number((label.match(/Item\s+(\d+)/) || [])[1] || nav.querySelector('.index')?.textContent || 0);
      const selectedRow = document.querySelector('#medley ol.options [aria-selected="true"], #medley .f120-review-option-row[aria-selected="true"]');
      const selected = document.querySelector('#medley ol.options input:checked')?.getAttribute('value') || (selectedRow ? (selectedRow.getAttribute('data-review-input-value') || selectedRow.getAttribute('data-review-option-letter') || '') : '');
      summaries.push({
        navIndex: Number(nav.querySelector('.index')?.textContent || 0),
        questionId: nav.getAttribute('data-question-id') || '',
        itemIndex,
        selected,
        stem: document.body.innerText.includes(`Synthetic Step 1 Block 3 Q${itemIndex} stem`),
        optionCount: document.querySelectorAll('#medley ol.options > li.stContext').length,
        correctCount: document.querySelectorAll('#medley .f120-review-option--correct').length,
        unavailable: document.body.innerText.includes('Stored rendered item snapshot unavailable'),
        q8ImageLoaded: itemIndex === 8 ? Boolean(document.querySelector('#medley img[src^="data:image/png"]')) : null,
        q40MediaLoaded: itemIndex === 40 ? Boolean(document.querySelector('#medley .f120-review-native-media-fallback--interactive .f120-review-audio-player[data-audio-src^="data:video/webm"]')) : null,
      });
    }
    return {
      navAnsweredCount: navItems.filter((item) => item.querySelector('.ans_status')?.classList.contains('f120-review-answered')).length,
      summaries,
    };
  });

  const expectedIndexes = Array.from({ length: 40 }, (_unused, index) => index + 1);
  assert(JSON.stringify(reviewState.summaries.map((item) => item.navIndex)) === JSON.stringify(expectedIndexes), 'review nav indexes mismatch', reviewState.summaries.map((item) => item.navIndex));
  assert(new Set(reviewState.summaries.map((item) => item.questionId)).size === 40, 'review question IDs duplicated or missing');
  assert(new Set(reviewState.summaries.map((item) => item.itemIndex)).size === 40, 'review item indexes duplicated or missing');
  assert(reviewState.summaries.every((item) => item.stem && item.optionCount === 4 && item.correctCount === 1 && !item.unavailable), 'review question content incomplete', reviewState.summaries.filter((item) => !(item.stem && item.optionCount === 4 && item.correctCount === 1 && !item.unavailable)));
  assert(reviewState.navAnsweredCount === QUESTION_COUNT, 'review answered nav count mismatch', reviewState.navAnsweredCount);
  const selected = Object.fromEntries(reviewState.summaries.filter((item) => item.selected).map((item) => [item.itemIndex, item.selected]));
  assert(JSON.stringify(selected) === JSON.stringify(USER_ANSWERS), 'review selected answers mismatch', selected);
  assert(reviewState.summaries.find((item) => item.itemIndex === 8)?.q8ImageLoaded === true, 'review Q8 cached image missing');
  assert(reviewState.summaries.find((item) => item.itemIndex === 40)?.q40MediaLoaded === true, 'review Q40 cached media missing');

  return {
    ok: true,
    browser: await page.evaluate(() => navigator.userAgent),
    qbank: {
      status: qbank.result.status,
      capturedDefinitions: qbank.result.capturedDefinitions,
      questionCount: qbank.result.questionCount,
      knownAnswerCount: qbank.result.knownAnswerCount,
      selectedStepKeys: qbank.result.selectedStepKeys,
      q8ResourceCount: qbank.q8DataKeys.length,
      q40ResourceCount: qbank.q40DataKeys.length,
      q40Interactions: qbank.q40Interactions,
    },
    completion,
    review: {
      navCount: reviewState.summaries.length,
      navAnsweredCount: reviewState.navAnsweredCount,
      selected,
      q8ImageLoaded: reviewState.summaries.find((item) => item.itemIndex === 8)?.q8ImageLoaded,
      q40MediaLoaded: reviewState.summaries.find((item) => item.itemIndex === 40)?.q40MediaLoaded,
    },
  };
}
