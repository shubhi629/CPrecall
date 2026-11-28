# Application Workflow

This page describes the complete end-to-end flow from a user solving a problem on
LeetCode through to the system scheduling the next review.

## Full Solving Session Flow

```
User opens a LeetCode problem
         │
         ▼
Extension detects the problem page
• Records sessionStart timestamp
• Fetches problem metadata via GraphQL (without description)
• Fetches existing submissions via GraphQL
• Stores lastSeenTopId as a baseline to exclude pre-session submissions
         │
         ▼
User submits a solution
         │
         ▼
Extension polls LeetCode GraphQL every 4 seconds for new submissions
• Compares each submission's ID against lastSeenTopId
• Collects all new submissions (WA, TLE, MLE, Accepted) into submissionHistory[]
• Resets tracking state if the user navigates to a different problem
         │
         ▼
Submission is Accepted
         │
         ├── Extension fetches accepted code via GraphQL (submissionDetails)
         │
         ├── POST /api/analyze ──► Gemini 2.0 Flash
         │
         │   body: { code, problemTitle, difficulty, language, titleSlug }
         │   (backend lazy-loads description from LeetCode if problem exists in DB)
         │
         │   returns:
         │     actualTimeComplexity, actualSpaceComplexity
         │     optimalTimeComplexity, optimalSpaceComplexity
         │     explanation, richAnalysis (7 fields)
         │
         ├── User optionally enters Hints Used (manual numeric input, default 0)
         │   and clicks "Submit to CPRecal"
         │
         ▼
POST /api/ingestion/submission  (Bearer token via GM_xmlhttpRequest)
{
  problemId, title, titleSlug, difficulty, patterns,
  sessionStart, sessionEnd, submissionHistory[],
  acceptedSubmissionId, acceptedCode, language, hintsUsed, analysisResult
}
         │
         ▼
processSubmission() — 9-step pipeline
  Step 1: Find or create Problem record (by leetcodeId)
  Step 2: Create SolvingSession (totalTimeSeconds computed)
  Step 3: Batch-create Submission records for each attempt
  Step 4: Upsert AcceptedSolution (code + analysis)
  Step 5: Calculate ProblemMastery (5-component weighted score)
  Step 6: Update PatternMastery for each pattern on this problem
  Step 7: Create/update FSRSState (nextReviewDate, intervalDays, easeFactor)
  Step 8: Create ReviewHistory entry
  Step 9: Return structured result
```

## Review Surfacing Flow

```
User opens the CP Recall dashboard (/)
         │
         ▼
GET /api/dashboard → dashboardService.getDashboardData(userId)

  Parallel queries:
  • User stats (solved count, average mastery, attempt count)
  • All pattern masteries → weak/strong pattern rankings
  • FSRSState: all triggers where nextReviewDate ≤ today
  • Problem catalog batch fetch
         │
         ▼
selectRecallTargets(dueProblems, userId)

  For each due trigger Problem A:
    • Look up A's patterns
    • Find the weakest pattern (lowest mastery in patternMasteryMap)
    • Determine target difficulty from pattern mastery
    • Query catalog for unsolved Problem B in that pattern
    • Return B annotated with originalDueProblemId: A
         │
         ▼
todaysRevision array displayed on Home dashboard
User sees: "Problem B — Sliding Window — Recall Due"
         │
User clicks "Mark Done"
         │
POST /api/reviews { problemId: A, status: "completed", satisfiedByProblemId: B }
  → interval updated, nextReviewDate pushed forward
```

## Targeted Practice Flow (Recommendations)

```
GET /api/recommendations
  • Fetches user's pattern masteries
  • Identifies weakest patterns
  • Queries problem catalog for unsolved problems in those patterns
  • Returns unsolved problems (excluding problems in the user's `ProblemMastery` records), ordered by weak pattern priority
```
