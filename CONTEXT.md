# Free120 Helper Context

Free120 Helper is a local-only userscript for official USMLE Free 120 launch and WebFRED pages. It observes exam state, stores local attempts, and opens local review without automating WebFRED.

## Language

**Attempt**:
A locally stored exam run with responses, timing, question snapshots, scoring state, and completion state.
_Avoid_: Session, try

**QBank cache attempt**:
A local review-ready cache record created from launch-page QBank capture for answer-key lookup.
_Avoid_: Real attempt, learner attempt

**Review readiness**:
The condition that an **Attempt** has enough evidence and a terminal or explicit-ready state to open local review.
_Avoid_: Completion, unlock flag

**Active exam pill**:
The small WebFRED overlay that shows current-block progress and local helper status without showing correct answers.
_Avoid_: Dashboard, tutor panel

**Launch history**:
The launch-page UI for stored attempts, QBank cache status, export, import, and review opening.
_Avoid_: Admin console, history service

## Relationships

- An **Attempt** may become **Review readiness** after native completion or explicit local finish.
- A **QBank cache attempt** is not a learner **Attempt** and must be excluded from latest-attempt selection.
- The **Active exam pill** and **Launch history** both rely on **Review readiness** to decide whether local review can open.
- **Launch history** manages **QBank cache attempt** records; active exams only read them.

## Example dialogue

> **Dev:** "Should the Active exam pill open review for the latest stored record?"
> **Domain expert:** "Only if it is a learner Attempt with Review readiness. Ignore QBank cache attempts."

## Flagged ambiguities

- "Completed" can mean native WebFRED ended or local review can open. Resolved: use **Review readiness** when discussing review access.
