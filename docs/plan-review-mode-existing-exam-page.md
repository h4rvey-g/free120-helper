# Plan: Review Mode on Existing Exam Page

Date: 2026-05-04

## Goal

Build review mode as a replay of the existing WebFRED exam page, not as a brand-new review UI. The generated blob tab should preserve the native-style item navigation, question layout, and option box, then add review-only markers and timing.

Decision: store rendered question snapshots locally during the attempt and use those snapshots as review source of truth. Do not call the live webpage for problem text during review.

Rationale:

- More robust: review works after the exam tab closes, session expires, site order changes, or NBME updates content.
- Safer: review does not navigate or query live WebFRED, preserving non-interference.
- Easier implementation: review renderer consumes one local attempt model instead of coordinating live app state, routing, auth/session state, item order, and async content loading.
- Privacy/export still controlled: keep content local in IndexedDB and exclude question content from default JSON export.

## Playwright Reconnaissance

Live page inspected with Playwright CLI on the WebFRED exam driver. Findings below avoid storing official question text.

### Left question navigation

- Container: `nav > ol#leftnav`
- Item rows: `ol#leftnav > li`
- Observed row children:
  - Angular comment nodes for note/mark conditionals
  - `span.ans_status`
  - `span.index`
  - `span.hoverNote`
- Current item row had class `currentitem`.
- Native rows carry Angular click bindings in the live app; in the generated blob review shell, replace live Angular behavior with helper review navigation handlers.

Modification target:

- Insert `.f120-review-nav-status` inside each `ol#leftnav > li` immediately before `span.index`.
- Use green check for correct, red cross for incorrect, neutral dash/dot for omitted or unknown.
- Keep native item number visible and preserve row as click target for review navigation.

### Option box

- Visible item root: `section#item article#content div#medley div[id^="item"]`
- Prompt/stem area: `div.NBExposition`
- Answer box: `div[id$="_div"].NBOptionListComp.answerbox`
- Answer list: `form > ol.options`
- Option rows: `ol.options > li.stContext`
- Observed row children:
  - `input.NBOptionInput[type="radio"]`
  - visible option text `span`

Modification target:

- Insert `.f120-review-option-status` inside each `ol.options > li.stContext` after `input.NBOptionInput` and immediately before the visible option text `span`.
- Show green check before the correct option.
- Show red cross before the user-selected option only when it is wrong.
- Leave an empty marker slot for unselected distractors to keep row alignment stable.
- Retain native-looking option rows; disable live answer mutation in review blob.

### Time spent display

- Preferred insertion point: immediately after `ol.options` inside the answer form.
- Fallback insertion point: after `div[id$="_div"].NBOptionListComp.answerbox` within `div[id^="item"]`, before native proceed controls.

Modification target:

- Insert `.f120-review-time-spent` below each question.
- Format: `Time spent: m:ss` or `Time spent: —` when unavailable.
- Use captured rough per-question timing from attempt data.

## Implementation Plan

1. Store enough shell/snapshot data during tracking to replay the WebFRED exam layout in a blob tab, including rendered prompt, option box, and existing media/resource URLs.
2. Generate review blob from stored attempt data and sanitized stored snapshots; never fetch problem text from the live webpage during review.
3. Rebuild `ol#leftnav` with one row per reviewed item, keeping native-style `span.ans_status`, `span.index`, and row click behavior.
4. Add `.f120-review-nav-status` markers before `span.index` based on final grading status.
5. Render selected question snapshot into the native-style item root.
6. Locate `ol.options > li.stContext` rows in the snapshot.
7. Add `.f120-review-option-status` markers after each `input.NBOptionInput` and before visible option text.
8. Apply option highlighting classes: correct green, wrong selected red, omitted neutral, unknown warning.
9. Insert `.f120-review-time-spent` below `ol.options`; use fallback placement if snapshot shape differs.
10. Add helper review controls around the reused shell for filters, score summary, compact summary, and previous/next review navigation.
11. Do not navigate or call live WebFRED from review; all review actions operate on local attempt data.
12. Add structural tests using synthetic WebFRED-like fixtures for nav markers, option markers, and timing placement.
13. Add Playwright smoke checks against live page structure using selectors only, avoiding committed official question content.

## Acceptance Criteria

- Review tab uses a native-style WebFRED exam shell instead of a separate custom question-card UI.
- `ol#leftnav > li` rows show review status markers before item numbers.
- Correct items show checkmarks; incorrect items show crosses; omitted/unknown items show neutral markers.
- `ol.options > li.stContext` rows show checkmark before the correct option and red cross before the wrongly selected option.
- No red cross appears before unselected distractors.
- Time spent appears below each reviewed question.
- Filters and score summary work without replacing the native-style question layout.
- Review does not navigate the live WebFRED app, fetch live problem text, or mutate live exam answers.
