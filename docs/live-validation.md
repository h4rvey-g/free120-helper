# Live Validation

Phase 11 live checks use Playwright CLI and structural assertions only. They must not commit NBME question text or screenshots.

## Commands

- `npm run check` — builds `dist/free120-helper.user.js`, runs `node --check`, then runs all synthetic module tests.
- `npm run live:validate` — runs the default Step 1 Block 3 Playwright CLI validation in installed Microsoft Edge.
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

On 2026-05-05, the official launch page loaded and exposed the expected Step 1/2/3 choices. Starting Step 1 Block 1 from this environment returned a launch-service response without `examSession`, so full live navigation to WebFRED could not complete. `npm run live:validate` therefore keeps official-site checks to launch-page structure and uses synthetic WebFRED markup for active-exam workflow checks. Re-run full manual QA in Chrome/Tampermonkey when the official launch service returns a valid session.

## Manual QA checklist

- Chrome + Tampermonkey, bundled `dist/free120-helper.user.js`.
- Step 1 single-block launch with Show Correct Answers off.
- Step 1 single-block launch with Show Correct Answers on.
- All-block launch: review remains locked after Block 1; manual finish warning is explicit.
- Native controls: Next, Previous, Mark, End Block, Calculator, Lab Values, Notes, Reverse Color, Text Zoom.
- Refresh/resume: in-progress attempt resumes and history remains consistent.
- Export/import: history-only export excludes question content; full backup requires warning acceptance.
