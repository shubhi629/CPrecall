# A→B Recall Target Resolution Engine

## Purpose

The core pedagogical insight of CP Recall is that reviewing a concept is best done by
solving a **different, unsolved** problem that exercises the same pattern — not by
re-solving the original problem from memory. *(Note: the engine filters out problems
the user has already solved in `ProblemMastery`, the trigger Problem A, and duplicates
within the same batch; it does not track or exclude problems the user may have merely
viewed or attempted without solving.)*

The Recall Engine (`recallSelector.js`) dynamically resolves a "target" Problem B for
every "trigger" Problem A that is due for FSRS review.

## Algorithm

```
Input:  fsrsTriggers[]  — FSRSState records where nextReviewDate ≤ today
        userId          — authenticated user

Output: resolvedTargets[] — {problem: B, originalDueProblemId: A, relevantPattern, ...}
```

**Step 1 — Pre-load solved problem IDs**
Query all `ProblemMastery` records for the user → extract `problemId` set.

**Step 2 — Pre-load pattern masteries**
Query all `PatternMastery` records → build `Map<pattern, mastery>`.
This avoids N+1 database round-trips when processing many triggers.

**Step 3 — For each trigger Problem A:**

a. Extract A's patterns array

b. Map each pattern to its mastery score from the pre-loaded map (O(1) lookup)

c. Sort patterns ascending by mastery → select the **weakest pattern**

d. Determine target difficulty:
   - Weakest pattern mastery < 50% → Easy
   - 50% ≤ mastery < 80% → Medium
   - mastery ≥ 80% → Hard

e. Query problem catalog: `patterns contains weakest_pattern AND difficulty = target`
   excluding (solved IDs ∪ {A} ∪ already-selected-in-this-batch)

f. If no difficulty match found: fall back to any difficulty, same pattern, same exclusions

g. If still no candidates: **return empty** — never fall back to Problem A

h. Shuffle candidates, pick one at random

i. Add selected problem to `selectedRecallProblemIds` set (batch deduplication — prevents
   the same Problem B from being selected for multiple triggers in one request)

j. Build result: `{ problem: B, originalDueProblemId: A, relevantPattern, relevantMastery, nextReviewDate }`

**Step 4 — Return resolvedTargets[]**

## Exhaustion Handling

If the user has solved every problem in a given pattern (catalog exhaustion), the engine
returns no target for that trigger. A `LibraryCompletionModal` is shown if the user has
solved every problem in the entire catalog (`totalSolved === totalProblems`), prompting
them to reset progress and start a new learning cycle.

## Performance Decisions

| Decision | Reason |
|---|---|
| Pre-load pattern mastery map | O(1) per lookup vs O(N) per trigger |
| Pre-load solved IDs as Set | O(1) exclusion checks |
| DynamoDB in-memory catalog | Catalog queries operate from RAM (no remote I/O per lookup) |
| Batch deduplication set | Prevents same Problem B being assigned to multiple triggers |

## Why Pattern-Level, Not Problem-Level?

If the FSRS trigger were attached to individual problems and the user were shown the
same problem on review, they would be testing **recall of the solution** rather than
**recognition of the pattern**. By selecting a structurally similar but visually
different problem, the system tests genuine conceptual transfer.
