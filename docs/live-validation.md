# Live Validation

Phase 11 live checks use Playwright CLI and structural assertions only. They must not commit NBME question text or screenshots.

## Commands

- `npm run check` — builds `dist/free120-helper.user.js`, runs `node --check`, then runs all synthetic module tests.
- `npm run live:validate` — runs the default Step 1 Block 3 Playwright CLI validation in installed Microsoft Edge.
- `npm run live:validate -- --mode=step1-all-blocks` or `npm run live:validate:step1-all-blocks` — runs the real official NBME Orientation Step 1 All Blocks validation.
- `npm run live:validate -- --mode=real-step1-all-blocks` or `npm run live:validate:real-step1-all-blocks` — alias for the same real Step 1 All Blocks validation.
- `npm run live:validate -- --mode=synthetic-step1-all-blocks` or `npm run live:validate:synthetic-step1-all-blocks` — runs the synthetic official-origin Step 1 All Blocks fixture.
- `npm run live:validate -- --mode=smoke` — runs the older launch + single-question synthetic smoke path.

## Current coverage

Default `step1-block3` mode uses Playwright CLI with `--browser=msedge` and official-origin synthetic routes. No NBME text/screenshots are stored.

- Launch-page QBank capture for Step 1 Block 3 only.
- QBank cache stores 40 snapshots, 40 known correct answers, and cached media resources.
- Simulated WebFRED user answers first 5 questions, ends exam, and opens Review mode.
- Review nav contains exactly 40 questions, item numbers 1–40, no duplicate/missing question ids.
- Review mode shows exactly 5 selected answers and they match the simulated selections.
- Each review question has stem, 4 options, and exactly 1 correct-answer marker.
- Step 1 Block 3 Q8 image/video resources are cached and render from `data:` URLs.
- Step 1 Block 3 Q40 interactive media metadata is captured and renders playable cached media.

`step1-all-blocks` / `real-step1-all-blocks` mode additionally covers the official NBME Orientation site, not mocked routes:

- Opens the real `https://orientation.nbme.org/Launch/USMLE` launch page and selects the native “Step 1 All Blocks” option.
- Runs launch-page QBank capture for all three real Step 1 blocks (`STPF1C0137`, `STPF1C0138`, `STPF1C0139`), totaling 120 snapshots and 120 known correct answers.
- Launches the real WebFRED all-block exam, answers all 120 items across Blocks 1–3 with seeded random selections, and uses the native Start Next Block flow between blocks.
- Completed all-block attempt remains review-ready with 120 question ids/responses, 120 snapshots, complete QBank answer-key matching, and per-block metadata/progress of 40/40 for Blocks 1, 2, and 3.
- Local Review mode renders all 120 questions across three blocks.
- Every review question has stored answer inputs, exactly one correct-answer marker, and the expected selected option available.
- Every review selected option exactly matches the seeded random option chosen during the real WebFRED exam.

`synthetic-step1-all-blocks` mode covers the same all-block helper invariants against mocked official-origin launch/WebFRED routes, without using real NBME content.

Smoke mode still covers:

- Launch page detection at `https://orientation.nbme.org/Launch/USMLE`.
- Launch History button rendering and storage readiness.
- Native launch controls stay present: Start, Step 1 Block 1, Show Correct Answers surface.
- WebFRED runtime detection on `/webfred` URL shape.
- Active exam pill rendering.
- DOM fallback adapter parsing for `ol#leftnav`, current item identity, choices, selected answer, and answer-key metadata.
- Tracking attempt creation and storage persistence.
- Answer-key capture completion from structural metadata.
- Native controls remain enabled after helper injection.

## Manual live-site notes

On 2026-05-12, the official launch page loaded and exposed Step 1 All Blocks. The real all-block validation launched official WebFRED, answered 120 items across Blocks 1–3, preserved 40/40 progress per block, and rendered a 120-question local review. Do not commit NBME text, screenshots, or captured local storage from these runs.

## Manual QA checklist

- Chrome + Tampermonkey, bundled `dist/free120-helper.user.js`.
- Step 1 single-block launch with Show Correct Answers off.
- Step 1 single-block launch with Show Correct Answers on.
- All-block launch: review remains locked after Block 1; manual finish warning is explicit.
- Native controls: Next, Previous, Mark, End Block, Calculator, Lab Values, Notes, Reverse Color, Text Zoom.
- Refresh/resume: in-progress attempt resumes and history remains consistent.
- Export/import: history-only export excludes question content; full backup requires warning acceptance.
