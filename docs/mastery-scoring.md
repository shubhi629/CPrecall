# Mastery Scoring Algorithm

When a user solves a problem on LeetCode, CP Recall computes a **mastery score
from 0 to 100** that reflects the quality of the solution across five dimensions.

## The Five Components

### 1. Solution Efficiency (SE) — weight 25%

Compares the user's actual time and space complexity against the optimal complexity
determined by Gemini's analysis.

| Scenario | Score |
|---|---|
| TC matches optimal AND SC matches optimal | 100 |
| TC matches, SC does not | 90 |
| TC does not match, SC does | 70 |
| Neither matches | 60 |

Formula: `score = 100 − TC_penalty − SC_penalty` (TC_penalty = 30, SC_penalty = 10)

### 2. Time Complexity (TC) — weight 25%

| Scenario | Score |
|---|---|
| User's TC == optimal TC | 100 |
| User's TC is worse than optimal | 75 |

#### Why Solution Efficiency and Time Complexity Are Separate Components

Although both **Solution Efficiency (25%)** and **Time Complexity (25%)** inspect the
user's time complexity, they serve distinct scoring roles in `scoring.js`:

- **Solution Efficiency** evaluates **joint resource optimality** across both time and
  space (`-30` if TC is non-optimal, `-10` if SC is non-optimal).
- **Time Complexity** isolates **asymptotic time optimality** alone (`100` if exact
  match, `75` otherwise).

Separating them is a **design choice** in CPRecall's scoring model that gives
asymptotic time complexity higher effective weight in the final score: a non-optimal
time complexity loses points in *both* components, whereas a non-optimal space
complexity (e.g., `O(N)` auxiliary space with optimal `O(N)` time) only loses 10
points inside Solution Efficiency. Note that these component weights (`25% / 25% /
20% / 15% / 15%`) and penalty heuristics are heuristic design choices rather than
empirically validated parameters.

### 3. Submissions Until Success (SUS) — weight 20%

`SUS = max(0, 100 − (submissionCount − 1) × 20)`

| Attempts | Score |
|---|---|
| 1 (first try) | 100 |
| 2 | 80 |
| 3 | 60 |
| 4 | 40 |
| 5 | 20 |
| ≥ 6 | 0 |

### 4. Time Taken (TT) — weight 15%

| Difficulty | Baseline |
|---|---|
| Easy | 5 minutes |
| Medium | 15 minutes |
| Hard | 30 minutes |

If `minutes ≤ baseline`: score = 100.
Otherwise: `score = min(100, max(0, 100 / (minutes / baseline)))`.

### 5. Hints Used (HU) — weight 15%

`HU = max(0, 100 − hintsUsed × 15)`

> **Note on hint tracking:** Hint usage is **not** automatically detected or tracked by the extension. Instead, the user manually enters the number of hints used in the Tampermonkey widget's numeric **Hints Used** field (default `0`) before clicking **Submit to CPRecal**. That manually entered integer is passed to `scoring.js` for this calculation.

## Final Mastery Formula

```
mastery = round(
    SE  × 0.25 +
    TC  × 0.25 +
    SUS × 0.20 +
    TT  × 0.15 +
    HU  × 0.15
)
```

Result is an integer from 0 to 100.

## Mastery → FSRS Rating Mapping

| Mastery | FSRS Rating | Label | Initial Review Interval |
|---|---|---|---|
| 0–39 | 1 | Learn | 1 day |
| 40–59 | 2 | Moderate | 3 days |
| 60–79 | 3 | Good | 7 days |
| 80–100 | 4 | Excellent | 14 days |

## Pattern Mastery Aggregation

After `ProblemMastery` is saved, `PatternMastery` is recomputed for every pattern
on the solved problem:

1. Find all problems in the catalog with this pattern
2. Find all `ProblemMastery` records for this user on those problems
3. `avgMastery = sum(mastery) / count(solved)`
4. Average each component score across all solved problems in this pattern
5. Upsert the `PatternMastery` record

Pattern mastery is a **running aggregate** that updates with every new solve.
