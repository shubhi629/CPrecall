# AI Integration — LLM Code Analysis

## Overview

CP Recall uses **Google Gemini 2.0 Flash** to analyse the user's accepted LeetCode
solution immediately after submission. This analysis drives the Solution Efficiency
and Time Complexity components of the mastery score and provides rich pedagogical
feedback on the Problem Details page.

## When Analysis Runs

The Tampermonkey extension calls `POST /api/analyze` with the accepted code immediately
after the submission is accepted — **before** the full ingestion POST. The analysis
result is embedded in the ingestion payload as `analysisResult`.

## Input to Gemini

| Field | Source |
|---|---|
| `code` | Full accepted source code from LeetCode GraphQL (sent by extension) |
| `problemTitle` | LeetCode problem title (sent by extension) |
| `difficulty` | `"Easy"`, `"Medium"`, or `"Hard"` (sent by extension) |
| `language` | Programming language, e.g. `python3`, `cpp` (sent by extension) |
| `patterns` | Loaded from the `Problem` record in the database (`[]` if not yet in DB) |
| `problemDescription` | Lazy-loaded by `analyzeController.js` from LeetCode `questionContent` GraphQL (4s timeout) and cached on `Problem.description` if the problem already exists in the DB with an empty description; HTML-stripped and truncated to 3000 chars (`""` if the problem is not yet in the DB) |

## Output from Gemini

```json
{
  "actualTimeComplexity":    "O(N)",
  "actualSpaceComplexity":   "O(1)",
  "optimalTimeComplexity":   "O(N)",
  "optimalSpaceComplexity":  "O(1)",
  "explanation":             "Linear scan with constant extra space.",
  "richAnalysis": {
    "problemUnderstanding":     "...",
    "yourApproach":             "...",
    "correctness":              "...",
    "optimalApproach":          "...",
    "comparison":               "...",
    "efficiencyAssessment":     "...",
    "improvementSuggestions":   "..."
  }
}
```

## Rich Analysis Fields

| Field | Description |
|---|---|
| `problemUnderstanding` | What the problem requires and its key constraints |
| `yourApproach` | Algorithm the user used: data structures, loops, recursion |
| `correctness` | Logical correctness and potential edge-case issues |
| `optimalApproach` | Best-known solution technique for this problem type |
| `comparison` | Direct comparison of user's vs optimal approach |
| `efficiencyAssessment` | Whether the user's approach is feasible under given constraints |
| `improvementSuggestions` | 1–2 concrete, actionable improvements |

## Complexity Validation & Fallback Impact

After parsing Gemini's JSON response, `codeAnalysis.js` validates that all four
complexity fields (`actualTimeComplexity`, `actualSpaceComplexity`,
`optimalTimeComplexity`, `optimalSpaceComplexity`) are present. If any field is
missing or falsy, it falls back to `"O(N)"` to prevent null propagation.

> **Impact on Mastery Scoring:** Because `scoring.js` compares complexity strings by
> exact equality (`actualTimeComplexity === optimalTimeComplexity`), an `"O(N)"`
> fallback can affect both the **Solution Efficiency (25%)** and **Time Complexity
> (25%)** mastery components — either penalizing a non-`O(N)` solution (e.g., `O(1)`
> or `O(log N)`) if `optimalTimeComplexity` fell back to `"O(N)"`, or artificially
> matching if both fell back to `"O(N)"`. If the entire JSON parse fails, the analysis
> endpoint throws an error.

## Model Selection Rationale

`gemini-2.0-flash` was chosen for:
- **Latency**: fast enough to call synchronously before the ingestion POST
- **Structured output**: reliable JSON formatting for complexity analysis tasks
- **Cost**: efficient token usage for code analysis at this scale

## Where Results Are Displayed

The `richAnalysis` object is stored in `AcceptedSolution.analysisResult` and displayed
on the **Problem Details** page under the AI Code Analysis panel. The complexity fields
drive the Solution Efficiency and Time Complexity mastery component scores.
