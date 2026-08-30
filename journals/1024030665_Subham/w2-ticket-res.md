# Week 2 : CPRecal Backend Routes and Data Models Architecture

## W2 : Designing Normalized Data Models for Mastery, Patterns, and FSRS State

### Error

Storing user attempts, pattern aggregations, and FSRS spaced repetition states inside a single monolithic problem or user document caused unbounded document growth, duplicate state updates, and inefficient querying.

### Relevant Context

CPRecal requires tracking global LeetCode problem metadata (`Problem`), individual user performance metrics (`ProblemMastery`), aggregated DSA pattern competencies (`PatternMastery`), spaced repetition schedules (`FSRSState`), and review history (`ReviewHistory`).

### Key Observation

User learning states evolve independently of global problem data. FSRS intervals and pattern masteries need to be queried and updated independently without rewriting large nested arrays or creating lock contention during frequent solving ingestion.

### Solution

We designed a normalized Mongoose schema architecture:
1. `Problem`: Holds immutable global problem metadata, difficulty, and standardized algorithmic patterns.
2. `ProblemMastery`: Stores per-user solving stats, 5-component mastery score (0–100%), attempt history, and solving duration with a compound unique index on `{ userId, problemId }`.
3. `PatternMastery`: Stores user mastery across each DSA pattern to drive targeted practice recommendations.
4. `FSRSState`: Maintains core spaced repetition parameters (stability, difficulty, interval, `nextReviewDate`) for solved problems acting as recall triggers.

---

## W2 : Resolving Dynamic A -> B Recall Targets in Problem and Dashboard Routes

### Error

Querying `/api/problems?status=recall` or `/api/problems?status=scheduled` was directly returning the original solved problem (Problem A) instead of finding a new, unsolved challenge belonging to the same algorithmic pattern (Problem B).

### Relevant Context

In the CPRecal pedagogy, the solved problem (Problem A) acts purely as an FSRS timer trigger. When A becomes due for recall, the system must dynamically identify A's weakest pattern and present a different, unsolved problem (Problem B) containing that same pattern to test true conceptual retention.

### Key Observation

The database stores `FSRSState` linked to the solved trigger `problemId` (A). If the route simply queries `FSRSState` and returns its populated problem, the user is presented with the problem they already solved rather than a new challenge.

### Solution

We implemented a centralized `selectRecallTargets` service integrated into `problemController.js` and `dashboardService.js`:
1. The route queries all `FSRSState` triggers due today (or queued for future review).
2. For each trigger Problem A, the user's weakest associated pattern is identified.
3. The database queries unattempted catalog problems matching the pattern, explicitly excluding all problems in the user's `ProblemMastery` and Problem A itself.
4. The route returns target Problem B annotated with `originalDueProblemId: A` and `nextReviewDate: A.nextReviewDate`.
5. If all matching pattern problems are exhausted, the route safely returns an empty state without falling back to Problem A.

---

## W2 : Enforcing Strict Multi-User Data Isolation and Indexing in API Routes

### Error

Without scoped querying and input validation, problem status filters and dashboard routes risked leaking mastery stats or recall queues across different user accounts.

### Relevant Context

CPRecal supports multiple concurrent users. All routes for problem catalog browsing, pattern analytics, solving session ingestion, and review submissions must operate strictly within the authenticated user's scope.

### Key Observation

Routes using broad `.find()` queries or unindexed lookups can cross-contaminate user stats or suffer severe performance degradation as the problem catalog and submission history scale.

### Solution

1. Scoped every query with `userId: req.user._id` across `/api/problems`, `/api/dashboard`, `/api/patterns`, `/api/reviews`, and `/api/ingestion`.
2. Created compound unique indexes on `{ userId: 1, problemId: 1 }` across `ProblemMastery`, `FSRSState`, and `AcceptedSolution` to guarantee data isolation and $O(1)$ query lookups.
3. Added strict MongoDB ObjectId validation middleware on all parameterized routes (`/api/problems/:id`, `/api/reviews`) to reject malformed IDs with `400 Bad Request`.
