import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);
const mode = modeArg || 'step1-block3';
const target = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) || 'https://orientation.nbme.org/Launch/USMLE';
const timeoutMs = Number(process.argv.find((arg) => arg.startsWith('--timeout-ms='))?.slice('--timeout-ms='.length) || 120000);
const browserName = process.argv.find((arg) => arg.startsWith('--browser='))?.slice('--browser='.length) || 'msedge';
const step1Block3Script = 'scripts/live-step1-block3.cjs';
const realStep1Block3Script = 'scripts/live-real-step1-block3.cjs';
let scriptRunCounter = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve({ stdout: output, stderr: errorOutput });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with ${code}\n${output}\n${errorOutput}`));
    });
  });
}

function parseCliJson(stdout) {
  if (/^### Error/m.test(stdout)) {
    throw new Error(stdout.trim());
  }
  const resultMatch = stdout.match(/### Result\n([\s\S]*?)\n### Ran Playwright code/);
  const raw = resultMatch ? resultMatch[1].trim() : stdout.trim();
  const candidate = raw.split('\n').reverse().find((line) => line.trim().startsWith('{') || line.trim().startsWith('[')) || raw;
  return JSON.parse(candidate);
}

async function withPlaywrightSession(callback) {
  const sessionName = `free120-live-${process.pid}-${Date.now()}-${++scriptRunCounter}`;
  await run('playwright-cli', [`-s=${sessionName}`, 'open', `--browser=${browserName}`, 'about:blank']);
  try {
    return await callback(sessionName);
  } finally {
    await run('playwright-cli', [`-s=${sessionName}`, 'close']).catch(() => null);
  }
}

async function runPlaywrightScriptFile(filename) {
  const absoluteFilename = filename.startsWith('/') ? filename : join(process.cwd(), filename);
  return withPlaywrightSession(async (sessionName) => {
    const result = await run('playwright-cli', [`-s=${sessionName}`, 'run-code', `--filename=${absoluteFilename}`], { env: { FREE120_LIVE_TARGET: target, FREE120_LIVE_MODE: mode } });
    return parseCliJson(result.stdout);
  });
}

async function runPlaywrightScript(source) {
  const dir = await mkdtemp(join(tmpdir(), 'free120-live-'));
  const filename = join(dir, 'script.cjs');
  try {
    await writeFile(filename, source, 'utf8');
    return await runPlaywrightScriptFile(filename);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const userscript = await readFile('dist/free120-helper.user.js', 'utf8');
  assert(userscript.includes('USMLE Free 120 QBank Helper'), 'dist userscript missing Tampermonkey banner');

  if (mode === 'step1-block3' || mode === 'full') {
    const step1Block3Validation = await runPlaywrightScriptFile(step1Block3Script);
    console.log(JSON.stringify({ mode, browser: browserName, step1Block3Validation }, null, 2));
    return;
  }

  if (mode === 'real-step1-block3') {
    const realStep1Block3Validation = await runPlaywrightScriptFile(realStep1Block3Script);
    console.log(JSON.stringify({ mode, browser: browserName, realStep1Block3Validation }, null, 2));
    return;
  }

  if (mode !== 'smoke') {
    throw new Error(`Unknown live validation mode: ${mode}`);
  }

  const launchValidation = await runPlaywrightScript(`async page => {
    const target = ${JSON.stringify(target)};
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: ${timeoutMs} });
    await page.waitForFunction(() => document.querySelectorAll('input[type="radio"]').length > 0 || document.body.innerText.includes('WebFred:'), null, { timeout: 30000 }).catch(() => {});
    await page.addScriptTag({ path: 'dist/free120-helper.user.js' });
    await page.waitForFunction(() => Boolean(window.Free120Helper && document.querySelector('#f120-launch-history')), null, { timeout: 15000 });
    const result = await page.evaluate(async () => {
      const helper = window.Free120Helper;
      const attempts = await helper.storage.listAttempts({ includeInProgress: true });
      const history = helper.ui.getLaunchHistory();
      await history.refresh();
      return {
        pageKind: helper.runtime.context.pageKind,
        historyRoot: Boolean(document.querySelector('#f120-launch-history')),
        historyButton: [...document.querySelectorAll('button')].some((button) => /Free120 History/.test(button.textContent || '')),
        storageReady: Boolean(await helper.storage.ready()),
        attempts: attempts.length,
        nativeStartButton: [...document.querySelectorAll('button')].some((button) => /^Start$/.test((button.textContent || '').trim())),
        nativeStep1Block1: [...document.querySelectorAll('input[type="radio"]')].some((input) => /Step 1 Block 1/i.test(input.parentElement && input.parentElement.textContent || '')),
      };
    });
    return result;
  }`);

  assert(launchValidation.pageKind === 'launch', 'launch runtime not detected');
  assert(launchValidation.historyRoot, 'launch history root missing');
  assert(launchValidation.historyButton, 'launch history button missing');
  assert(launchValidation.storageReady, 'storage not ready on launch page');
  assert(launchValidation.nativeStartButton, 'native Start control missing');
  assert(launchValidation.nativeStep1Block1, 'Step 1 Block 1 option missing');

  const webfredValidation = await runPlaywrightScript(`async page => {
    const html = \`<!doctype html><html><head><title>Synthetic Step 1 WebFRED</title></head><body>
      <main>
        <nav><ol id="leftnav"><li class="currentitem" aria-current="true"><span class="ans_status"></span><span class="index">1</span></li></ol></nav>
        <section id="item"><article id="content"><div id="medley" data-medley-id="medley-1">
          <div id="item-q1" data-component-id="component-q1" data-item-index="1">
            <div class="NBExposition">Synthetic live-validation stem</div>
            <div id="media1" class="NBMediaPlayer"><img src="api/Resource?name=synthetic.png" alt="Synthetic media"><video src="api/Resource?name=synthetic.webm"></video></div>
            <div id="q1_div" class="NBOptionListComp answerbox" data-correct-answer="A"><form><ol class="options">
              <li class="stContext correct"><input class="NBOptionInput" type="radio" name="q1" value="A" checked><span>A. Synthetic choice A</span></li>
              <li class="stContext"><input class="NBOptionInput" type="radio" name="q1" value="B"><span>B. Synthetic choice B</span></li>
            </ol></form></div>
            <button id="native-next">Next</button><button id="native-end">End Block</button>
          </div>
        </div></article></section>
        <div>Block 1 of 1</div>
      </main>
    </body></html>\`;
    await page.route('https://orientation.nbme.org/webfred/**', route => {
      const url = route.request().url();
      if (url.includes('name=synthetic.png')) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: '' });
      }
      if (url.includes('name=synthetic.webm')) {
        return route.fulfill({ status: 200, contentType: 'video/webm', body: '' });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    await page.goto('https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120&section=Block%201&block=1&mode=test', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.addScriptTag({ path: 'dist/free120-helper.user.js' });
    await page.waitForFunction(() => Boolean(window.Free120Helper && document.querySelector('#f120-active-exam-pill')), null, { timeout: 15000 });
    await page.waitForFunction(async () => {
      const state = window.Free120Helper.webfred.getLastState();
      return state && state.currentItem && state.currentItem.questionId;
    }, null, { timeout: 15000 });
    const result = await page.evaluate(async () => {
      const helper = window.Free120Helper;
      const state = helper.webfred.getLastState();
      const qid = state.currentItem.questionId;
      const qbankAttemptId = 'qbank-cache:USMLE:LIVE:Block1';
      await helper.storage.upsertAttempt({
        id: qbankAttemptId,
        status: 'completed',
        reviewReady: true,
        questionIds: [qid],
        questionCount: 1,
        correctAnswers: { [qid]: 'A' },
        answerKeyCapture: { status: 'complete', source: 'qbank-cache', knownCount: 1, expectedCount: 1, unknownCount: 0 },
        source: { cacheKind: 'qbank', createdBy: 'qbank-cache-controller', itemMetadataByQuestionId: { [qid]: { componentId: state.currentItem.componentId, medleyId: state.currentItem.medleyId, blockNumber: 1, itemIndex: 1 } } },
      });
      await helper.storage.saveQuestionSnapshot({
        attemptId: qbankAttemptId,
        questionId: qid,
        blockNumber: 1,
        itemIndex: 1,
        renderedHtml: state.currentContent.renderedHtml,
        choices: state.currentContent.choices,
        correctAnswerId: 'A',
        metadata: { componentId: state.currentItem.componentId, medleyId: state.currentItem.medleyId },
        snapshot: { qbankCache: { sessionId: 'live-validation' } },
      });
      const startResult = await helper.tracking.start({ adapterState: state });
      await helper.tracking.flush('live-validation');
      const activeAttempt = helper.tracking.getAttempt() || (startResult && startResult.attempt) || null;
      if (activeAttempt) {
        const ownSnapshots = await helper.storage.listQuestionSnapshots(activeAttempt.id);
        const reviewHtml = helper.review.buildReviewHtml(activeAttempt, ownSnapshots);
        window.__free120LiveReviewResult = await new Promise((resolve) => {
          const frame = document.createElement('iframe');
          frame.style.width = '960px';
          frame.style.height = '720px';
          const readReview = () => {
            const doc = frame.contentDocument;
            const selectedInput = doc && doc.querySelector('ol.options input:checked');
            const image = doc && doc.querySelector('#medley img');
            const video = doc && doc.querySelector('#medley video');
            return {
              navItems: doc ? doc.querySelectorAll('ol#leftnav li').length : 0,
              stemVisible: Boolean(doc && doc.body && doc.body.innerText.includes('Synthetic live-validation stem')),
              selectedValue: selectedInput ? selectedInput.getAttribute('value') : '',
              unavailable: Boolean(doc && doc.body && doc.body.innerText.includes('Stored rendered item snapshot unavailable')),
              resourceBase: doc ? doc.baseURI : '',
              imageResolved: Boolean(image && image.currentSrc === 'https://orientation.nbme.org/webfred/api/Resource?name=synthetic.png'),
              videoResolved: Boolean(video && video.currentSrc === 'https://orientation.nbme.org/webfred/api/Resource?name=synthetic.webm'),
              videoControls: Boolean(video && video.controls),
            };
          };
          frame.onload = () => {
            const started = Date.now();
            const poll = () => {
              const result = readReview();
              if (result.navItems >= 1 || Date.now() - started > 3000) {
                resolve(result);
                return;
              }
              setTimeout(poll, 50);
            };
            poll();
          };
          document.body.appendChild(frame);
          frame.srcdoc = reviewHtml;
        });
      }
      const attempts = await helper.storage.listAttempts({ includeInProgress: true });
      const keySummary = activeAttempt && activeAttempt.answerKeyCapture ? activeAttempt.answerKeyCapture : {};
      const activeSnapshots = activeAttempt ? await helper.storage.listQuestionSnapshots(activeAttempt.id) : [];
      const exportEnvelope = await helper.storage.exportHistoryOnly();
      const exportedJson = JSON.stringify(exportEnvelope);
      const importResult = await helper.storage.importJson(exportEnvelope, { conflictMode: 'skip' });
      const allBlockLocked = await helper.storage.upsertAttempt({
        id: 'live-validation-all-block-lock',
        status: 'in-progress',
        reviewReady: false,
        launchedScope: { mode: 'all', blockCount: 3 },
        blockMetadata: [{ blockNumber: 1, itemCount: 1 }, { blockNumber: 2, itemCount: 1 }, { blockNumber: 3, itemCount: 1 }],
        questionIds: [state.currentItem.questionId],
        source: { completion: { reviewLocked: true, reason: 'native-terminal-incomplete-all-block' } },
      });
      const beforeClick = document.querySelector('#native-next').disabled;
      document.querySelector('#native-next').click();
      return {
        pageKind: helper.runtime.context.pageKind,
        pillRoot: Boolean(document.querySelector('#f120-active-exam-pill')),
        stateStatus: state.status,
        stateSource: state.source,
        currentItem: state.currentItem,
        choices: state.currentContent && state.currentContent.choices && state.currentContent.choices.length,
        trackingStatus: helper.tracking.getStatus(),
        attempts: attempts.length,
        activeAttemptId: activeAttempt && activeAttempt.id,
        activeQuestionCount: activeAttempt && activeAttempt.questionIds && activeAttempt.questionIds.length,
        activeResponseValues: activeAttempt ? Object.values(activeAttempt.responses || {}) : [],
        activeSnapshotCount: activeSnapshots.length,
        activeSnapshotSelected: activeSnapshots[0] && activeSnapshots[0].selectedAnswerId,
        activeSnapshotRendered: Boolean(activeSnapshots[0] && activeSnapshots[0].renderedHtml),
        activeSnapshotSource: activeSnapshots[0] && activeSnapshots[0].metadata && activeSnapshots[0].metadata.questionContentSource,
        reviewResult: window.__free120LiveReviewResult || null,
        keyStatus: keySummary.status,
        keyKnown: keySummary.knownCount,
        exportSnapshots: exportEnvelope.questionSnapshots.length,
        exportContentFree: !exportedJson.includes('Synthetic live-validation stem') && !exportedJson.includes('NBOptionInput'),
        importSkipped: importResult.skippedAttempts >= 1,
        allBlockReviewLocked: allBlockLocked.status === 'in-progress' && allBlockLocked.reviewReady === false && allBlockLocked.source.completion.reviewLocked === true,
        nativeNextStillEnabled: beforeClick === false && document.querySelector('#native-next').disabled === false,
        historySafe: !document.body.innerText.includes('official NBME question content'),
      };
    });
    return result;
  }`);

  assert(webfredValidation.pageKind === 'webfred', 'webfred runtime not detected');
  assert(webfredValidation.pillRoot, 'active exam pill missing');
  assert(webfredValidation.currentItem && webfredValidation.currentItem.questionId, 'current item missing');
  assert(webfredValidation.choices >= 2, 'MCQ choices not parsed');
  assert(webfredValidation.attempts >= 1, 'tracking attempt not stored');
  assert(webfredValidation.activeQuestionCount >= 1, 'tracked question ids missing');
  assert(webfredValidation.activeResponseValues.includes('A'), 'selected answer not recorded');
  assert(webfredValidation.activeSnapshotCount >= 1, 'tracking snapshot not stored');
  assert(webfredValidation.activeSnapshotSelected === 'A', 'tracking snapshot selected answer mismatch');
  assert(webfredValidation.activeSnapshotRendered, 'tracking snapshot rendered question missing');
  assert(webfredValidation.reviewResult && webfredValidation.reviewResult.navItems >= 1, 'review mode has no questions');
  assert(webfredValidation.reviewResult.stemVisible, 'review mode question stem missing');
  assert(webfredValidation.reviewResult.selectedValue === 'A', 'review mode selected option missing');
  assert(webfredValidation.reviewResult.unavailable === false, 'review mode fell back to unavailable item');
  assert(webfredValidation.reviewResult.resourceBase === 'https://orientation.nbme.org/webfred/', 'review mode media base missing');
  assert(webfredValidation.reviewResult.imageResolved, 'review mode image resource not resolved');
  assert(webfredValidation.reviewResult.videoResolved, 'review mode video resource not resolved');
  assert(webfredValidation.reviewResult.videoControls, 'review mode media player controls missing');
  assert(webfredValidation.keyStatus === 'complete', 'synthetic answer key capture incomplete');
  assert(webfredValidation.keyKnown >= 1, 'synthetic key count mismatch');
  assert(webfredValidation.exportSnapshots === 0 && webfredValidation.exportContentFree, 'history-only export leaked question content');
  assert(webfredValidation.importSkipped, 'refresh/import conflict path not validated');
  assert(webfredValidation.allBlockReviewLocked, 'all-block review lock state not validated');
  assert(webfredValidation.nativeNextStillEnabled, 'native control disabled by helper');

  console.log(JSON.stringify({ mode, target, launchValidation, webfredValidation }, null, 2));
}

await main();
