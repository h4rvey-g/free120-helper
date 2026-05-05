# PRD: USMLE Free 120 Tampermonkey QBank Helper

Date: 2026-05-04

## Problem Statement

USMLE Free 120 is valuable because it uses the official NBME-style exam driver, but its review workflow is limited compared with standard question banks. Learners can answer questions in an exam-like interface, yet they do not get a persistent UWorld-like review experience after completing a block or full test. They must manually remember which questions they missed, manually revisit items, and cannot easily build a history of completed questions across attempts.

The Free 120 site includes a native “Show Correct Answers” option, but that option is tied to the live exam experience. Learners who want test-mode conditions should not need to expose answers while testing. They need a local helper that observes their selections during the test, preserves attempt data, grades only when appropriate, and provides structured review and history without changing NBME server behavior.

## Solution

Build a Tampermonkey userscript for the USMLE Free 120 orientation site that augments the official NBME exam driver with a local question-bank layer. The script will run only on the USMLE orientation launch and WebFRED exam pages. It will track the user’s selected answers, answer-change timeline, question identifiers, answer choices, correct answers available in page metadata or in-page WebFRED services, completion status, marked status, notes, highlights, strikeouts, rough per-question time, and attempt timestamps.

The default experience is exam/test mode. During an active exam, the helper must not reveal answers, navigate the native app, submit answers, or interfere with NBME progress. The only default active-exam UI is a small status pill showing answered progress for the current block, formatted like `12/40 · Block 1`. The user can hide this pill in settings.

After the launched scope is complete, the helper unlocks review. A single-block launch unlocks after that block completes. An all-block launch unlocks only after all launched blocks complete; partial all-block attempts remain in-progress unless the user manually finishes them with a clear warning. Completion can be detected from native terminal state or completed launched scope plus explicit user confirmation.

Review opens only after the user clicks a `Review ready` action. The review UI opens in a new browser tab backed by a generated blob URL, but it is a replay of the existing WebFRED exam page rather than a brand-new interface. It renders stored exam-page shell/snapshots without navigating the live WebFRED app, preserves the familiar left question navigation and option box, and adds review-only annotations in those existing regions: checkmarks/crosses before question numbers in the left navigation, checkmarks before correct options, crosses before wrongly selected options, and a time-spent row below each question. Review supports full question view, compact summary controls, overall/per-block scoring, filters for all/correct/incorrect/omitted/marked/block, and answer comparison.

The script will maintain browser-local history of completed attempts. History will preserve repeated attempts, full locally stored question snapshots, selected answers, correct answers, notes/highlights/strikeouts when accessible, timing, marks, and score summaries. The launch page will show a top-right `Free120 History` button. History export/import will be JSON-based; exports exclude full question content by default unless the user explicitly opts in after a strong warning. All learner data remains local to the browser unless the user explicitly exports it.

The intended experience is similar to a lightweight UWorld overlay: test-mode answering stays clean and exam-like; review-mode adds scoring, filters, answer status, full local snapshots, and persistent progress history.

## User Stories

1. As a USMLE learner, I want the helper to load automatically on the official USMLE Free 120 launch page, so that I do not need to manually inject code every session.
2. As a USMLE learner, I want the helper to load automatically inside the WebFRED exam driver, so that my answers can be tracked while I use the official interface.
3. As a USMLE learner, I want to take a block without seeing correct answers during the block, so that I can preserve exam-like conditions.
4. As a USMLE learner, I want my answer selections saved immediately, so that a refresh or accidental navigation does not erase my local progress.
5. As a USMLE learner, I want marked questions saved, so that I can review uncertain items later.
6. As a USMLE learner, I want omitted questions detected, so that unanswered items appear separately from incorrect items.
7. As a USMLE learner, I want a completion summary after ending a block, so that I can quickly see how I performed.
8. As a USMLE learner, I want review mode after completing a block, so that I can inspect each question after testing.
9. As a USMLE learner, I want review mode after completing all blocks, so that I can review the full Free 120 in one workflow.
10. As a USMLE learner, I want each review item to show my selected answer and the correct answer, so that I can understand whether I was right.
11. As a USMLE learner, I want correct answers highlighted in green, so that I can identify them quickly.
12. As a USMLE learner, I want my wrong selected answer highlighted in red, so that I can see my mistake quickly.
13. As a USMLE learner, I want omitted items highlighted neutrally, so that I can distinguish skipped questions from wrong answers.
14. As a USMLE learner, I want the review navigation sidebar to reuse the WebFRED left item list with checkmarks/crosses before item numbers, so that I can jump directly to any item and see status at a glance.
15. As a USMLE learner, I want review filters for all, incorrect, correct, omitted, and marked, so that I can focus on specific subsets.
16. As a USMLE learner, I want a percentage score and raw score, so that I can track readiness.
17. As a USMLE learner, I want per-block scores when using all blocks, so that I can identify weak blocks.
18. As a USMLE learner, I want overall Free 120 score aggregation, so that I can compare my performance across attempts.
19. As a USMLE learner, I want a history page or panel, so that I can see previous completed attempts.
20. As a USMLE learner, I want history grouped by exam section and block, so that Step 1, Step 2, and Step 3 MCQ attempts do not mix confusingly.
21. As a USMLE learner, I want repeated attempts preserved separately, so that I can compare first pass and later pass performance.
22. As a USMLE learner, I want the latest attempt shown clearly, so that I know my current status.
23. As a USMLE learner, I want question-level history, so that I can see whether I previously got an item correct or incorrect.
24. As a USMLE learner, I want an incorrect-question list across attempts, so that I can target weak items.
25. As a USMLE learner, I want a marked-question list across attempts, so that I can revisit concepts I flagged.
26. As a USMLE learner, I want a reset option for a section, so that I can start fresh when retaking.
27. As a USMLE learner, I want a delete-history option, so that I can remove local data if needed.
28. As a privacy-conscious learner, I want all data stored locally, so that my answers and performance are not transmitted to a third party.
29. As a privacy-conscious learner, I want explicit export/import controls, so that backups happen only when I choose.
30. As a learner using multiple browsers, I want to export and import JSON history, so that I can move my progress manually.
31. As a learner in timed mode, I want the helper not to interfere with the native timer, so that the official exam driver remains reliable.
32. As a learner using the native calculator, lab values, notes, highlights, or reverse color tools, I want those tools to continue working, so that the helper does not break the official UI.
33. As a learner using text zoom, I want helper UI to remain readable, so that review controls remain usable.
34. As a keyboard-focused learner, I want review controls to be reachable by keyboard, so that I can navigate efficiently.
35. As a learner using smaller screens, I want the active-exam helper UI to stay minimal, so that it does not cover question content.
36. As a learner, I want a small active-exam progress pill like `12/40 · Block 1`, so that I know tracking is working without leaving exam mode.
37. As a learner, I want to hide the progress pill in settings, so that I can remove all visible helper UI during the exam.
38. As a learner in all-block mode, I want review to remain locked until all launched blocks are complete, so that review does not interfere with exam progress.
39. As a learner in all-block mode, I want partial attempts to remain in-progress by default, so that Block 1 review does not appear before Blocks 2 and 3 are done.
40. As a learner with an interrupted all-block attempt, I want a manual finish option with a clear warning, so that I can intentionally grade only captured/completed questions.
41. As a learner, I want clear status labels, so that I know whether I am in test mode, in-progress state, review-ready state, or history mode.
42. As a learner, I want the helper to detect when the site updates or selectors fail, so that I get a safe warning instead of silent bad grading.
43. As a learner, I want the helper to avoid modifying submitted answers, so that my interaction with the official NBME app remains trustworthy.
44. As a learner, I want the helper to work whether I launched a single block or all blocks, so that my workflow can match my study plan.
45. As a learner, I want the helper to distinguish in-progress attempts from completed attempts, so that partial sessions do not pollute my performance history.
46. As a learner, I want a “resume in-progress attempt” indicator, so that I can continue after leaving and returning.
47. As a learner, I want score cards to show started time, completed time, duration, exam section, and block count, so that my history is meaningful.
48. As a learner, I want answer choices captured exactly as shown, so that review matches the official item display.
49. As a learner, I want media and lab-value-dependent questions not to break review mode, so that special items remain reviewable.
50. As a learner, I want full stored question snapshots rendered in a new review tab that reuses the existing exam-page layout, so that review feels familiar without navigating the native exam driver.
51. As a learner, I want review to preserve the native-style full question view and offer compact summaries as secondary controls, so that I can deeply review questions or quickly scan statuses without learning a new layout.
52. As a learner, I want answer changes tracked over time, so that I can see when I changed from one answer to another while final scoring still uses my final answer.
53. As a learner, I want rough time spent displayed below each reviewed question, so that I can review pacing in context.
54. As a learner, I want native notes, highlights, strikeouts, and marks saved when accessible, so that review preserves my exam annotations.
55. As a learner, I want a top-right `Free120 History` button on the launch page, so that past attempts are easy to access before launching a new block.
56. As a learner, I want JSON export/import in history, so that I can back up or move local data between browsers.
57. As a learner, I want JSON export to exclude full question text by default, so that I do not accidentally distribute NBME content.
58. As a learner, I want an explicit full-backup export option with a strong warning, so that I can intentionally back up complete local snapshots.
59. As a learner, I want the helper to support native Show Correct Answers launches, so that review mode still works if I used the native answer-visible workflow.
60. As a learner, I want native Show Correct Answers attempts counted like normal attempts, so that my history stays simple.
61. As a learner, I want the script to support the current USMLE Free 120 Step 1, Step 2 CK, and Step 3 MCQ blocks where feasible, so that one helper covers the official practice sets.
62. As a developer, I want a normalized question snapshot model, so that extraction, grading, storage, and UI can be tested independently.
63. As a developer, I want an adapter around the NBME Angular/WebFRED state, so that site-specific logic is isolated from the rest of the userscript.
64. As a developer, I want storage migrations, so that future versions can evolve without corrupting existing user history.
65. As a developer, I want live-site smoke tests with Playwright, so that the userscript can be validated against the actual Free 120 workflow.
66. As a developer, I want synthetic fixture tests for parsing and grading, so that most behavior can be tested without storing copyrighted NBME content in the repository.

## Implementation Decisions

- Delivery will be a Tampermonkey userscript scoped to the official USMLE orientation launch and WebFRED exam-driver pages.
- The script will not replace the official exam driver. It will observe state, store local snapshots, and render separate local history/review UI.
- The helper will never send learner answers, scores, or question content to any external service.
- The helper will not automate answer selection, submit answers, alter submitted answers, navigate between questions to scrape answers, or change NBME server calls.
- Default active-exam behavior is test mode. Correct answers are captured when possible but never shown by the helper before completion.
- No custom tutor mode will be built for v1. If the user uses the native Show Correct Answers option, the helper still tracks and reviews the attempt.
- Native Show Correct Answers attempts are stored and scored the same as normal attempts. They are not separated in aggregate stats.
- The active-exam UI is a small progress pill only. It shows answered count for the current block and the block number, e.g. `12/40 · Block 1`.
- The progress pill counts answered questions only, not visited questions.
- The progress pill can be hidden in settings.
- The script will attempt to capture all correct answers immediately after WebFRED initializes and before the user answers questions, using in-page WebFRED services or bulk content data. It must not navigate the native exam to capture keys.
- Correct-answer capture will use the site adapter and bulk content/service access first. Passive per-item capture is fallback. Hidden jump-through scraping is not default behavior.
- If correct-answer capture is incomplete, the active-exam pill may show a subtle degraded tracking status in settings but must not change the requested progress text. The exam continues.
- If correct-answer capture fails or is incomplete, the script automatically retries a limited number of times with backoff and exposes a manual retry action in settings. Retries must not navigate or show answers.
- If some keys remain unknown at review time, scoring shows both minimum score over total and known-key score, e.g. `30/40 minimum · 30/38 graded · 2 unknown`.
- The script will use a site adapter around WebFRED state. The adapter will prefer official in-page Angular state/services when available and fall back to DOM parsing when needed.
- Question identity will use stable NBME identifiers: exam program, exam name/section, component id, and medley id. Block number and item index are stored only as attempt-position metadata because order may shuffle.
- A content hash will be stored to detect changed question content or site updates.
- A question extractor module will convert current page state and bulk content into normalized question snapshots containing prompt HTML, choices, selected answer, correct answer when available, marked state, notes, highlights, strikeouts, media/resource URLs, timing, and metadata.
- Stored media handling will preserve HTML and existing resource URLs only. The script will not download/embed media assets as data URLs.
- A response tracker module will listen for answer selection, native navigation, mark toggles, note/highlight/strikeout changes when accessible, block transitions, and page lifecycle events.
- Answer changes will be tracked as a local timeline. Grading uses the final selected answer.
- Rough per-question time will be measured from active current-item enter/leave timestamps.
- A grader module will classify questions as correct, incorrect, omitted, or unknown based on selected answer and correct answer.
- An attempt store module will persist in-progress attempts and completed attempts locally. IndexedDB is primary because full snapshots can be large. localStorage is allowed for small settings such as pill visibility.
- Stored attempts will include schema version, script version, attempt id, exam identity, launched scope, block metadata, timestamps, completion state, question snapshots, selected answers, answer timeline, correct answers, marked flags, notes/highlights/strikeouts when accessible, timing, and score summary.
- Storage retention is unlimited until the user deletes attempts. No automatic purge will run.
- Stored local data will be plain IndexedDB/localStorage data, not encrypted or obfuscated.
- History will preserve multiple attempts instead of overwriting old attempts.
- Launch page UI will include a top-right floating `Free120 History` button.
- History v1 will be attempt-list focused: date, exam, launched scope, block count, duration, score, review, delete, and export/import actions.
- Export/import will live in the History UI. Default JSON export excludes full question content. Full local backup export can include question content only after explicit opt-in and strong warning.
- Single-block review unlocks after the native block completes or the user explicitly finishes the launched single-block scope.
- All-block review unlocks only after all launched blocks complete. Partial all-block attempts remain in-progress by default.
- Manual finish is allowed for partial or ambiguous attempts with a warning that grading covers only captured/completed questions and does not submit or alter NBME state.
- Completion detection is hybrid: native terminal state unlocks automatically; otherwise all launched answerable items plus user confirmation can complete the attempt.
- When review is ready, the script shows a `Review ready` action. It does not auto-open review.
- Review opens in a new browser tab using a generated blob URL.
- Review reuses the existing WebFRED exam-page structure in the blob tab. It renders stored snapshots into a native-style exam shell instead of a brand-new standalone review UI, and it does not navigate the live WebFRED app during review.
- The helper will store rendered question content needed for review at capture time. Review will not call the live webpage for question text, because the live app may be closed, expired, reordered, updated, or unsafe to navigate during review.
- Stored review content should be limited to the rendered item snapshot and existing media/resource URLs needed to replay the item; default export still excludes question content.
- Review annotations are inserted into observed exam-page targets: left navigation results before question numbers, option results inside each answer row, and time spent below each item.
- Review supports native-style full question mode, compact summary controls, overall and per-block scoring, filters for all/correct/incorrect/omitted/marked/block, answer comparison, answer-change timeline display, rough time display, and annotation display when available.
- The script will include defensive version checks. If key WebFRED state is unavailable, it will enter degraded mode and show a clear warning rather than grade from unreliable data.
- The script will support current MCQ-style Free 120 blocks for Step 1, Step 2 CK, and Step 3 where feasible. Non-MCQ Step 3 CCS cases require a separate data model and are excluded from the initial implementation.
- The script will include a privacy and data notice in the helper settings/history UI.
- The script will include delete-history/delete-attempt actions with confirmation.

## Testing Decisions

- Tests should validate external behavior rather than implementation details: what the user sees, what is stored, and how grading/history behave.
- Parsing tests should use synthetic HTML fixtures that mimic the WebFRED DOM shape without committing full NBME question content.
- The site adapter should be unit tested for extracting exam identity, launched scope, block metadata, component id, medley id, current item, answer state, marks, annotations, and correct-answer metadata from mocked Angular state and DOM fallback fixtures.
- The bulk answer-key capture flow should be unit tested for complete key capture, partial key capture, retry behavior, manual retry behavior, and no-navigation guarantees.
- The question extractor should be unit tested for single-answer MCQ items, omitted items, marked items, answer-visible native mode, missing correct-answer metadata, media/resource URLs, notes, highlights, strikeouts, and changed DOM class names.
- The grader should be unit tested for correct, incorrect, omitted, unknown, malformed answer states, and incomplete key scoring with minimum-score plus known-key score output.
- The attempt store should be unit tested for creating attempts, updating responses, recording answer-change timeline, recording rough timing, completing attempts, preserving repeated attempts, migrating schema versions, exporting with and without question content, importing, deleting attempts, and clearing all data.
- The UI state reducer or controller should be unit tested for pill progress formatting, pill visibility setting, review-ready state, filter selection, summary counts, per-block breakdown, history sorting, attempt selection, export/import flow, and delete confirmations.
- Review-tab generation should be tested with synthetic attempts to verify the blob HTML renders the existing exam-page shell, full and compact modes, filters, left-nav status icons, option-row correct/incorrect icons, answer highlighting, answer timeline, below-question timing, and annotations.
- Playwright smoke tests should validate live workflows on the official site: launch Step 1 Block 1, verify answer-key capture attempts, answer at least one item, navigate, mark an item, use notes/highlights/strikeouts where possible, end or simulate completion, click review-ready, open new review tab, and verify score/status display plus existing-page review markers in `ol#leftnav > li`, `ol.options > li.stContext`, and the below-question time row.
- Playwright smoke tests should run both with native Show Correct Answers disabled and enabled, because the helper must support both workflows and count them the same in history.
- Playwright tests should verify the active-exam pill displays answered-only progress as `12/40 · Block 1` and can be hidden in settings.
- Playwright tests should verify all-block mode does not unlock review after Block 1 and only unlocks after all launched blocks are complete or after explicit manual finish warning.
- Playwright tests should verify the script does not break native Next, Previous, Mark, End Block, Calculator, Lab Values, Notes, Reverse Color, and Text Zoom controls.
- Playwright tests should verify the script does not navigate the native WebFRED app for key capture or review rendering.
- Playwright tests should verify refresh recovery for an in-progress attempt.
- Playwright tests should verify export/import produces equivalent history, with default export excluding full question content and full-backup export including content only after explicit opt-in.
- Live-site tests should avoid storing official question content in repository fixtures. Assertions should use structural selectors and synthetic local fixtures wherever possible.
- Manual QA should include Chrome with Tampermonkey, because the launch page itself recommends Chrome.
- Manual QA should include single-block launch and all-block launch.
- Manual QA should include Step 1, Step 2 CK, and Step 3 MCQ blocks where feasible.
- Manual QA should include small viewport and zoomed text.
- Regression checks should fail safely when required WebFRED state cannot be found.

## Out of Scope

- Providing medical explanations, third-party answer explanations, or teaching content not present in the official Free 120 site.
- Redistributing NBME question content or publishing captured item text.
- Bypassing access controls, modifying NBME server responses, or changing official submitted answers.
- Automating answer selection or solving questions for the user.
- Syncing history to cloud storage or external accounts.
- Custom tutor mode or custom answer reveal during an active exam; native Show Correct Answers remains supported by the site.
- Hidden native navigation to scrape answers.
- Downloading and embedding NBME media assets as data URLs.
- Automatic storage retention limits or automatic history purge.
- Encrypting local browser storage in v1.
- Supporting browsers without Tampermonkey-compatible userscript APIs in the initial release.
- Supporting Step 3 CCS case workflows in the initial release.
- Building a standalone web app or browser extension package beyond the userscript.
- Guaranteeing compatibility with future NBME site redesigns without adapter updates.

## Further Notes

- Playwright reconnaissance confirmed the launch page exposes Step 1, Step 2 CK, and Step 3 orientation choices plus native options for Show Correct Answers and Enable Timer.
- Playwright reconnaissance of the live Step 1 Block 1 exam page found the left question navigation at `nav > ol#leftnav`, with item rows at `ol#leftnav > li` and existing native children `span.ans_status`, `span.index`, and `span.hoverNote`. Review status icons should be inserted as `.f120-review-nav-status` inside each `li` immediately before `span.index`, preserving the item number and replacing inert Angular navigation with helper review click handlers in the generated blob shell.
- Playwright reconnaissance found answer choices in the option box at `div[id$="_div"].NBOptionListComp.answerbox > form > ol.options > li.stContext`; each row contains `input.NBOptionInput[type="radio"]` followed by the visible option text `span`. Review option icons should be inserted as `.f120-review-option-status` after the radio input and immediately before the visible option text, with checkmarks for correct options, crosses only for wrongly selected options, and an empty placeholder for unrelated distractors.
- Playwright reconnaissance found the visible item root at `section#item article#content div#medley div[id^="item"]`, with prompt in `div.NBExposition`, answer box in `div[id$="_div"].NBOptionListComp.answerbox`, and native proceed controls after the answer box. The review time-spent row should be inserted as `.f120-review-time-spent` after `ol.options` inside the answer form when possible, otherwise after the answer box within `div[id^="item"]` and before native proceed controls.
- The active exam driver is an Angular-based WebFRED app with in-page services for current item, item list, answers, block info, configuration, navigation, content, and scoring-related calls.
- Current item HTML includes stable item/component identifiers and answer-choice markup. In observed Step 1 Block 1, the correct answer was available in markup as answer metadata even when native answer display was not enabled.
- Native Show Correct Answers adds a `correct` class to the correct option after pressing Show Answer. The helper should not depend only on this visible class because test-mode users may not press Show Answer.
- The initial implementation should prioritize correctness, privacy, and non-interference over visual polish.
- “Do not interfere with exam progress” is a hard product constraint. Active-exam features must be passive except user-visible settings and explicit manual finish.
- Full question snapshots are stored locally by product choice. Repository tests and docs must still avoid committing official NBME content.
- If no issue tracker is configured, this PRD can be used as the source for later implementation issues.

## Implementation Plan

### Phase 1: Project scaffold and userscript shell

- [x] Create a Tampermonkey userscript file with scoped `@match` rules for the USMLE orientation launch and WebFRED pages.
- [x] Add a small runtime bootstrap that detects launch page vs WebFRED page.
- [x] Add shared constants for script version, storage schema version, supported URL patterns, and UI z-index namespace.
- [x] Add defensive logging that can be enabled from settings and stays quiet by default.

### Phase 2: Storage foundation

- [x] Implement IndexedDB storage with object stores for attempts, in-progress attempt state, question snapshots, and schema metadata.
- [x] Implement localStorage-backed settings for pill visibility and debug mode.
- [x] Implement schema migration plumbing from version 1 onward.
- [x] Implement attempt CRUD, delete attempt, clear all history, export history-only JSON, export full-backup JSON with warning, and import JSON.
- [x] Add data validation for imported attempts before persistence.

### Phase 3: WebFRED site adapter

- [x] Implement initialization wait for Angular/WebFRED services without blocking the native app.
- [x] Read exam program, exam name/section, launched scope, current block, block count, item count, current item, item list, answers, marks, and current content from in-page state/services.
- [x] Use component id and medley id as primary question identity with exam program and exam name/section.
- [x] Store block number and item index only as attempt-position metadata.
- [x] Add DOM fallback extraction for current item state if Angular services are unavailable.
- [x] Add degraded-mode reporting when required state cannot be trusted.

### Phase 4: Answer-key capture

- [x] Implement bulk answer-key/content capture via in-page WebFRED service/API access after WebFRED initialization.
- [x] Parse correct-answer metadata from returned content without rendering or revealing answers.
- [x] Retry key capture automatically with limited exponential backoff.
- [x] Add manual retry in settings.
- [x] Persist key-capture status per attempt: complete, partial, failed, unknown count.
- [x] Guarantee key capture does not navigate, answer, submit, or mutate native exam state.

### Phase 5: Tracking engine

- [x] Create or resume an in-progress attempt when a supported MCQ launch is detected.
- [x] Track answer selections and answer-change timeline from state polling and/or event listeners.
- [x] Track answered-only progress by block.
- [x] Track marks, notes, highlights, strikeouts when accessible, with graceful fallback if extraction fails.
- [x] Track rough per-question time from active-item enter/leave events.
- [x] Capture and persist full question HTML snapshots plus existing media/resource URLs.
- [x] Persist changes promptly on answer selection, navigation, mark changes, and page lifecycle events.

### Phase 6: Modular build pipeline

- [x] Split the implemented monolithic userscript into ES modules under `src/core`, `src/storage`, `src/webfred`, `src/tracking`, `src/answer-keys`, and `src/runtime`.
- [x] Preserve the Tampermonkey metadata block in `src/userscript.meta.txt` and inject it into the bundled release artifact.
- [x] Add an esbuild pipeline that bundles `src/main.js` into one release file at `dist/free120-helper.user.js` with IIFE output and no code splitting.
- [x] Keep module boundaries aligned with implemented PRD responsibilities: constants/settings/logger, IndexedDB attempt store, WebFRED adapter, answer-key capture, tracking engine, and runtime bootstrap.
- [x] Keep generated build artifacts out of source control while keeping release source modules editable and testable.

### Phase 7: Active-exam UI

- [x] Render a small floating progress pill in WebFRED: `answered/total · Block n` from the existing tracking engine progress state.
- [x] Add settings access from the pill using the existing localStorage-backed settings store.
- [x] Allow user to hide/show pill and persist visibility through `settings.setPillVisible`.
- [x] Show non-intrusive tracking/key-capture details only inside settings, not in the main pill text.
- [x] Add `Review ready` action after completion; do not auto-open review.
- [x] Add manual finish flow with explicit warning for ambiguous or partial attempts.
- [x] Implement active-exam UI in `src/ui/active-exam-pill.js` and wire it through `src/main.js`; do not add UI logic to `src/tracking/engine.js`.

### Phase 8: Completion and scoring

- [x] Detect native terminal state for single-block and all-block launches.
- [x] Prevent review unlock after early blocks in all-block mode.
- [x] Complete single-block attempts after block completion or explicit finish.
- [x] Complete all-block attempts only after all launched blocks complete, except explicit partial finish.
- [x] Grade final selected answers against captured keys.
- [x] Calculate correct, incorrect, omitted, unknown, minimum score over total, known-key score, overall score, and per-block breakdown.
- [x] Store final score summary on completed attempt.

### Phase 9: Review tab

Detailed selector-level plan: [`docs/plan-review-mode-existing-exam-page.md`](plan-review-mode-existing-exam-page.md).

- [x] Generate a self-contained blob HTML review tab from stored attempt data.
- [x] Build the review tab by replaying the stored WebFRED exam-page shell/snapshots, not by creating a brand-new review UI.
- [x] Use stored rendered item snapshots as the review source of truth; do not fetch or reconstruct question text from the live WebFRED page during review.
- [x] Preserve the native-style left navigation (`ol#leftnav`), current item header, question content, option list, and next/previous review navigation semantics inside the blob tab.
- [x] Insert one review status marker `.f120-review-nav-status` before each left-nav item number in `ol#leftnav > li`, specifically before `span.index`: green check for correct, red cross for incorrect, neutral dash/dot for omitted or unknown; keep the existing item number visible and attach helper review navigation handlers to the existing row target.
- [x] Insert one option marker slot `.f120-review-option-status` in each answer row at `ol.options > li.stContext`, specifically after `input.NBOptionInput` and before the visible option text `span`: green check before the correct answer and red cross before the user-selected wrong answer; leave the slot blank for unrelated distractors.
- [x] Render answer highlighting in the existing option box: correct answer green, incorrect selected answer red, omitted neutral, unknown key warning.
- [x] Insert a time-spent display `.f120-review-time-spent` below each question, immediately after `ol.options` in its answer form when possible, with fallback placement after the answer box inside the current `div[id^="item"]` item root.
- [x] Render filters for all, correct, incorrect, omitted, marked, and block as helper controls around the reused exam shell.
- [x] Render overall score and per-block score breakdown.
- [x] Render answer-change timeline, rough time per question, marks, notes, highlights, and strikeouts when available.
- [x] Ensure review tab does not depend on navigating native WebFRED.

### Phase 10: Launch-page history

- [x] Render top-right floating `Free120 History` button on launch page.
- [x] Build history view with attempt list: date, exam, launched scope, block count, duration, score, review, delete, export/import.
- [x] Open selected attempt review in a blob tab.
- [x] Support delete with confirmation.
- [x] Support history-only export by default and full-backup export only after warning/opt-in.
- [x] Support import with validation and conflict handling.

### Phase 11: Testing and live validation

- [x] Add synthetic fixtures for WebFRED-like MCQ content, answer-key metadata, annotations, and incomplete-key states.
- [x] Unit test storage, migrations, adapter parsing, key capture parsing, extractor, grader, scoring, and review generation.
- [x] Add module-level tests for exported pure helpers before further splitting large implemented modules.
- [x] Add a build check that runs esbuild and `node --check dist/free120-helper.user.js` before release.
- [x] Use Playwright CLI to validate live Step 1 single-block workflow without native Show Correct Answers.
- [x] Use Playwright CLI to validate live workflow with native Show Correct Answers enabled.
- [x] Use Playwright CLI to validate all-block review locking behavior.
- [x] Use Playwright CLI to validate native controls remain functional.
- [x] Use Playwright CLI to validate refresh/resume and export/import.
- [x] Keep live-test assertions structural and avoid committing NBME question content.

### Phase 12: Hardening and release

- Add fail-safe warnings for unsupported pages, unavailable WebFRED state, incomplete key capture, storage errors, and import validation errors.
- Add privacy notice and local-data notice.
- Add install/update notes for Tampermonkey, pointing users at the bundled `dist/free120-helper.user.js` release artifact.
- Run manual QA in Chrome with Tampermonkey using the bundled output, not source modules.
- Tag v1 when Step 1/Step 2 CK/Step 3 MCQ smoke tests pass or unsupported MCQ variants fail safely.