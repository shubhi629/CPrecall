# FSRS-Inspired Spaced Repetition Engine

## What is This Scheduler?

FSRS (Free Spaced Repetition Scheduler) is an open-source spaced repetition family
that models memory using separate Difficulty, Stability, and Retrievability (DSR)
parameters.

CP Recall does **not** implement the full FSRS-4.5/5 DSR mathematical model. Instead,
`scheduler.js` and `ratingMapper.js` implement a **simplified, FSRS-inspired custom
scheduler** adapted for DSA pattern learning — mapping mastery scores to 1–4 ratings,
assigning fixed initial intervals (1, 3, 7, or 14 days), and scaling subsequent
intervals with a per-problem `easeFactor` clamped to `[1.3, 2.5]`.

## Core Concepts

### Ease Factor
A per-problem multiplier (default: 2.5, minimum: 1.3) that scales the review interval.
Higher ease factor means longer intervals, implying the concept is easy for this user.

### Review Interval
The number of days before the next review is due. Starts at the initial interval
determined by the mastery rating and grows multiplicatively on each successful review.

### Next Review Date
Stored as `nextReviewDate = today + intervalDays`. The dashboard queries all FSRSState
records where `nextReviewDate ≤ today` to surface due reviews.

## Scheduling Logic

### On First Solve

```
mastery → FSRS rating (1–4) → initialInterval

FSRSState created:
  rating          = derived from mastery
  intervalDays    = initialInterval
  easeFactor      = 2.5
  nextReviewDate  = today + intervalDays
```

### On Re-Solve (the user solves the same problem again)

```
if rating ≥ 3 (Good/Excellent):
    newInterval = ceil(existingInterval × easeFactor)
    easeFactor  = min(2.5, easeFactor + 0.1)

elif rating == 2 (Moderate):
    newInterval = ceil(existingInterval × 1.2)
    (easeFactor unchanged)

else (rating == 1, Learn):
    newInterval = initialInterval for this rating
    easeFactor  = max(1.3, easeFactor − 0.2)
```

### On Review Submission (`POST /api/reviews`)

```
"completed": newInterval = ceil(interval × easeFactor), easeFactor += 0.1
"failed":    newInterval = initialInterval, easeFactor −= 0.2
"skipped":   newInterval = 1 day
```

## Why a Custom Adaptive Scheduler Instead of Fixed-Interval SM-2?

Basic fixed-multiplier schedules do not adapt well without manual user difficulty
ratings. CP Recall's custom scheduler derives the 1–4 rating automatically from the
5-component mastery score and adjusts the per-problem `easeFactor` (`1.3` to `2.5`)
over time, separating strong patterns (long intervals) from weak ones (short
intervals) without requiring manual flashcard grading.

## Interval Growth Example

For a user who consistently scores Excellent (rating 4):

| Review | Interval | easeFactor |
|---|---|---|
| Initial | 14 days | 2.5 |
| After review 1 | 35 days | 2.5 |
| After review 2 | 87 days | 2.5 |

For a user who struggles (rating 1 → 2):

| Review | Interval | easeFactor |
|---|---|---|
| Initial | 1 day | 2.5 |
| Re-rated to 2 | 3 days | 2.3 |
| Re-rated to 1 | 1 day | 1.3 |

## Separation of Trigger and Target

A critical architectural decision: the FSRSState is associated with the **solved problem
(Problem A)** — not the problem being recalled. When A is due, the system uses A's
patterns to find a different Problem B. This ensures the user is never asked to repeat
Problem A from memory.

See the [Recall Engine](recall-engine.md) page for details.
