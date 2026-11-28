# Current Limitations & Future Scope

## Known Limitations

### Manual Extension Installation & JWT Copy-Paste
Users must manually install Tampermonkey, add `code/extension/cp-recal.user.js`,
copy their JWT via the dashboard's **Extension Key** button, and paste it into the
extension widget. There is no automated one-click browser store install or OAuth token
exchange.

### Manual Hint Tracking
The extension does **not** automatically detect whether or how many LeetCode hints
the user viewed. Users manually enter **Hints Used** (default `0`) in the widget before
submitting, so the accuracy of the 15% Hints Used mastery component relies on user
self-reporting.

### Problem Description Availability on First Solve
The extension's `questionData` GraphQL query does not fetch problem descriptions, and
`processSubmission.js` does not populate `Problem.description`. Although
`analyzeController.js` lazy-loads the description from LeetCode's `questionContent`
GraphQL endpoint when a `Problem` record already exists in the database without one,
that lazy-load is skipped if the problem is not yet in the database when `/api/analyze`
runs (for example, the first time any user solves a newly added problem).

### Plain HTTP Deployment Endpoint
The confirmed AWS EC2 deployment URL (`http://cprecall.duckdns.org`) serves traffic
over plain HTTP rather than HTTPS, so requests (including JWTs and code payloads)
are not TLS-encrypted in transit at that endpoint.

### Unspecified AWS Region in Repository Config
While the live AWS EC2 deployment URL (`http://cprecall.duckdns.org`) is confirmed, the
production AWS region is not recorded in repository configuration (`.env.example` uses
`ap-southeast-2` only as an example placeholder).

### Simplified FSRS-Inspired Scheduler
The implemented scheduler (`scheduler.js`) uses a simplified interval-and-ease-factor
model rather than the full FSRS-4.5/5 DSR algorithm (which models separate Difficulty,
Stability, and Retrievability parameters). It does not reproduce full FSRS interval
curves.

### Pattern Assignment
Algorithmic patterns are assigned to problems by the extension (sent as part of the
ingestion payload). The accuracy of pattern assignment depends on the quality of the
data provided at solve time. There is no server-side pattern validation or correction.

### Optimal Complexity Ground Truth & Fallback
The "optimal" time and space complexity used for the Solution Efficiency and Time
Complexity scores is provided by Gemini 2.0 Flash, not by a curated database of
verified optimal solutions. Gemini's assessment may occasionally be incorrect for
atypical problems, and if any complexity field is missing from Gemini's JSON output,
`codeAnalysis.js` falls back to `"O(N)"`, which can distort the resulting mastery
score.

### No Offline Mode
The dashboard and extension require active internet connectivity. There is no offline
caching of review schedules or problem data beyond the client-side 15-second API cache.

### Progress Reset (DynamoDB Only)
The atomic, concurrency-safe progress reset with verification (`progressResetService.js`)
is fully implemented for DynamoDB only. The MongoDB code path does not have the same
multi-step deletion with locking.

### Single Accepted Solution Per Problem
`AcceptedSolution` is upserted on re-solve — a later solve overwrites the earlier one.
Only the most recent accepted code and analysis are stored per (user, problem) pair.

## Future Scope

- **Full FSRS-5 implementation**: Incorporate the complete FSRS-5 algorithm with
  separate stability/difficulty parameters for more accurate scheduling
- **Automated extension installation**: One-click extension install with OAuth-based
  token exchange instead of manual JWT configuration
- **Server-side pattern curation**: A verified pattern-to-problem mapping maintained
  server-side, reducing dependence on extension-provided pattern data
- **Multi-platform support**: Extend beyond LeetCode to Codeforces, HackerRank, etc.
- **Social/team features**: Compare mastery across team members, shared problem lists
- **Mobile application**: React Native app for review notifications
- **Offline review mode**: Cache due problems locally for offline sessions
- **End-to-end testing**: Playwright test suite covering full solving → review cycles
