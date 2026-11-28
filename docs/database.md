# Database Design

## Overview

CP Recall uses a **database abstraction layer** controlled by the `DB_BACKEND`
environment variable:

| Value | Backend |
|---|---|
| `mongodb` (default) | Mongoose ORM against MongoDB Atlas |
| `dynamodb` | Custom repository layer against AWS DynamoDB |
| `DUAL_WRITE=true` | Writes go to both; reads come from primary |

This design enabled iterative migration from MongoDB (rapid prototyping) to DynamoDB
(scalable, serverless production) without changing the service layer logic.

The backend defines **9 Mongoose models** (`User`, `Problem`, `ProblemMastery`,
`PatternMastery`, `FSRSState`, `SolvingSession`, `Submission`, `AcceptedSolution`,
`ReviewHistory`) and **10 DynamoDB repositories**: 9 repositories mapping 1-to-1 to
those models (`userRepo`, `problemRepo`, `problemMasteryRepo`, `patternMasteryRepo`,
`fsrsStateRepo`, `solvingSessionRepo`, `submissionRepo`, `acceptedSolutionRepo`,
`reviewHistoryRepo`), plus `progressResetRepo.js`, which manages DynamoDB-specific
atomic progress-reset locks and execution state rather than a standalone Mongoose model.

## Data Models

### `User`

| Field | Type | Notes |
|---|---|---|
| name | String | max 50 chars |
| email | String | unique, lowercase, validated |
| passwordHash | String | bcrypt; `select: false` — never returned in queries |

**Indexes:** `email` (unique)

### `Problem`
Global, shared catalog of LeetCode problems. Populated on first solve by any user.

| Field | Type | Notes |
|---|---|---|
| leetcodeId | Number | unique — LeetCode's numeric problem ID |
| title | String | e.g. "Two Sum" |
| titleSlug | String | unique, lowercase — used to build LeetCode URLs |
| difficulty | Enum | "Easy", "Medium", "Hard" |
| patterns | [String] | DSA pattern tags assigned by the extension |
| description | String | Problem statement HTML (default `""`; not sent by the extension or ingestion pipeline — lazy-loaded from LeetCode `questionContent` GraphQL by `POST /api/analyze` if the problem already exists in the DB without a description) |

**Indexes:** `leetcodeId` (unique), `titleSlug` (unique), `difficulty`, `patterns`

### `ProblemMastery`
Per-user mastery record for a solved problem. One record per (user, problem).

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId | scoped to user |
| problemId | ObjectId | — |
| solvingSessionId | ObjectId | — |
| acceptedSubmissionId | ObjectId | — |
| totalSubmissions | Number | total attempts including failures |
| totalTimeSeconds | Number | session duration in seconds |
| hintsUsedCount | Number | — |
| solvedAt | Date | timestamp of accepted submission |
| components | Object | 5 scores: solutionEfficiency, timeComplexity, submissionsUntilSuccess, timeTaken, hintsUsed (each 0–100) |
| mastery | Number | weighted final score 0–100 |

**Indexes:** `{userId, problemId}` (unique), `{userId, mastery: -1}`, `{userId}`

### `PatternMastery`
Per-user mastery aggregated at the pattern level. Recomputed after every new solve.

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId | — |
| pattern | String | DSA pattern name |
| totalProblemsAttempted | Number | — |
| totalProblemsSolved | Number | — |
| mastery | Number | weighted average of ProblemMastery records for this pattern |
| components | Object | average of 5 component scores across solved problems in this pattern |

**Indexes:** `{userId, pattern}` (unique), `{userId, mastery: -1}`, `{userId}`

### `FSRSState`
Tracks the spaced-repetition schedule for each solved problem (the trigger, Problem A).

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId | — |
| problemId | ObjectId | trigger problem |
| rating | Enum [1,2,3,4] | derived from mastery score |
| nextReviewDate | Date | when to next surface a recall |
| intervalDays | Number | current interval |
| easeFactor | Number | default 2.5, min 1.3 |
| reviewHistory | [{reviewedAt, rating, intervalBefore}] | audit trail |

**Indexes:** `{userId, problemId}` (unique), `{userId, nextReviewDate}`, `{userId}`

### `SolvingSession`

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId | — |
| problemId | ObjectId | — |
| startTime | Date | when user opened the problem |
| endTime | Date | when submission was accepted |
| totalTimeSeconds | Number | computed: endTime − startTime |

**Indexes:** `{userId, problemId, startTime: -1}`, `{userId}`, `{problemId}` *(non-unique; multiple sessions allowed per user/problem)*

### `Submission`
One record per individual submission attempt within a session.

| Field | Type | Notes |
|---|---|---|
| userId, problemId, sessionId | ObjectId | — |
| submissionId | String | LeetCode's submission ID |
| status | String | "Accepted", "Wrong Answer", "Time Limit Exceeded", etc. |
| runtime, memory | String | LeetCode's reported values |
| language | String | e.g. "Python3", "C++" |
| timestamp | Date | — |

**Indexes:** `{userId, problemId}`, `{sessionId}`, `{userId}` *(non-unique; multiple attempts per session/problem)*

### `AcceptedSolution`
Stores the final accepted code and AI analysis. One record per (user, problem).
**Upserted on re-solve** — later solves overwrite earlier ones.

| Field | Type | Notes |
|---|---|---|
| userId, problemId, submissionId | ObjectId | — |
| code | String | full accepted source code |
| language, runtime, memory | String | — |
| analysisResult | Object | full Gemini response (complexities + richAnalysis) |
| solvedAt | Date | — |

**Indexes:** `{userId, problemId}` (unique), `{userId}`

### `ReviewHistory`
Audit trail of mastery changes.

| Field | Type | Notes |
|---|---|---|
| userId, problemId | ObjectId | — |
| reviewedAt | Date | — |
| previousMastery | Number | mastery before this solve |
| newMastery | Number | mastery after this solve |
| fsrsRating | Number | — |
| status | String | "completed" |

**Indexes:** `{userId, reviewedAt: -1}`, `{userId, problemId}`, `{userId}` *(non-unique; audit log of review events)*

## Entity Relationships

```
User ──┬── ProblemMastery ──── Problem
       ├── FSRSState ──────────┘
       ├── SolvingSession ─────┘
       ├── Submission ─────────┘
       ├── AcceptedSolution ───┘
       ├── ReviewHistory ──────┘
       └── PatternMastery (user-pattern aggregate computed from ProblemMastery + Problem.patterns)
```

User-scoped collections enforce per-user isolation by scoping queries to `userId`
from the JWT. Specifically, `ProblemMastery`, `FSRSState`, and `AcceptedSolution`
carry unique compound indexes on `{userId, problemId}`, and `PatternMastery` carries
a unique compound index on `{userId, pattern}`; event/history collections
(`SolvingSession`, `Submission`, `ReviewHistory`) use non-unique indexes so multiple
attempts and review records can be stored per user and problem.
