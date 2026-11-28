# Browser Extension

## Overview

The CP Recall browser extension is a **Tampermonkey userscript** (`v3.1.0`) located in
this repository at `code/extension/cp-recal.user.js`. It runs on
`https://leetcode.com/problems/*` and `https://www.leetcode.com/problems/*` and serves
as the system's primary data collection interface.

By default, the script targets the AWS-deployed backend and frontend at
`http://cprecall.duckdns.org` (`BACKEND_URL` and `FRONTEND_URL`).

## Installation

1. Install the **Tampermonkey** extension in a Chromium-based browser or Firefox.
2. Open the Tampermonkey dashboard and create a new userscript.
3. Copy the contents of `code/extension/cp-recal.user.js` into the editor and save.
   *(If running locally instead of against `http://cprecall.duckdns.org`, update
   `BACKEND_URL` and `FRONTEND_URL` at the top of the script.)*
4. Log into the CP Recall web dashboard (`http://cprecall.duckdns.org`), click the
   **Extension Key** button in the top header (`TopHeader.jsx`) to copy your JWT,
   open any LeetCode problem, paste the key into the widget's **Extension Key** input,
   and click **Save**.

## What It Does

1. **SPA & session tracking**: Records `sessionStart` when a problem page opens and uses
   a `MutationObserver` on `document.body` to detect LeetCode SPA navigation between
   problems and reset state.
2. **Baseline management**: Fetches the existing submission list on page load and stores
   `lastSeenTopId` so pre-session submissions are excluded.
3. **Submission polling**: Polls LeetCode's GraphQL API every **4 seconds**
   (`setInterval(..., 4000)`) for new submissions, collecting every non-pending attempt
   (Wrong Answer, Time Limit Exceeded, Accepted, etc.) into `submissionHistory[]`.
4. **Code extraction**: When the latest new submission reaches `Accepted`, stops polling
   and fetches the full source code, language, runtime, and memory via `submissionDetails`.
5. **LLM analysis**: Calls `POST /api/analyze` via `GM_xmlhttpRequest` and renders
   the Efficiency Score, complexity comparison, and `richAnalysis` cards inside the
   floating widget.
6. **Manual hint count & ingestion**: Provides a numeric **Hints Used** input field
   (default `0`) — hint usage is **not** automatically detected or tracked by the
   extension. When the user clicks **Submit to CPRecal**, the extension sends the
   session, submission history, accepted code, `hintsUsed`, and `analysisResult` to
   `POST /api/ingestion/submission`.

## Authentication (JWT Flow)

The extension has no independent login form. It uses a manual token-transfer flow:

1. The user authenticates on the CP Recall dashboard, which stores their JWT in
   `localStorage` (`cprecall_token`) and an HTTP-only cookie.
2. Clicking **Extension Key** in the dashboard header copies that JWT to the clipboard.
3. Pasting and saving the key in the Tampermonkey widget stores it in Tampermonkey's
   persistent storage via `GM_setValue("cprecall_sync_token", val)`.
4. `getAuthHeaders()` reads `GM_getValue("cprecall_sync_token", null)` and attaches
   `Authorization: Bearer <token>` to `POST /api/analyze` and
   `POST /api/ingestion/submission`.
5. Cross-origin requests use `GM_xmlhttpRequest` (declared with `@grant` and `@connect *`)
   to bypass LeetCode's Content Security Policy and cookie restrictions, with a `fetch()`
   fallback if `GM_xmlhttpRequest` is unavailable.

## LeetCode GraphQL Integration

Three separate GraphQL operations are executed against `https://leetcode.com/graphql/`:

| Operation | Data Retrieved |
|---|---|
| `questionData` | `questionId`, `questionFrontendId`, `title`, `titleSlug`, `difficulty`, `topicTags` *(does not fetch problem description)* |
| `submissionList` | Recent submission `id`, `status`, `statusDisplay`, `lang`, `runtime`, `memory`, `timestamp`, `isPending` |
| `submissionDetails` | `runtime`, `memory`, `code`, `statusCode`, `lang { name verboseName }` |

## Extension State

| Variable | Purpose |
|---|---|
| `currentTitleSlug` | Slug of the active LeetCode problem |
| `sessionStartTime` | Timestamp when the problem session began |
| `lastSeenTopId` | Most recent submission ID at session start (baseline) |
| `submissionHistory` | Array of all new non-pending submissions detected in this session |
| `acceptedDetected` | Flag preventing duplicate processing once `Accepted` is reached |
| `pollInterval` | Reference to the 4-second polling interval |

## Floating Widget UI

The extension injects a **draggable** dark-themed floating overlay (`#cr-widget`) that
can be minimized to a compact bubble (position persisted via `GM_setValue("CPRecal_widget_pos")`).
It transitions through three states:

- **Waiting / Tracking**: Displays session status pulse, Extension Key link/input badge
  (`● Connected` / `○ Not Linked`), problem title, difficulty, and tags.
- **Solved**: Displays time taken, submissions until success, runtime, memory, live
  Gemini analysis results, the manual **Hints Used** numeric input, and **Submit to CPRecal**.
- **Submitted**: Displays the backend-computed **Mastery Score** and **Next Review** date,
  with a direct link to the dashboard.
