# Frontend Architecture

## Stack

React 18 + Vite single-page application, served separately from the backend API.

## Application Shell and Routing

`App.jsx` defines two routing zones:

- **Public routes** (`/login`, `/register`): wrapped in `PublicRoute` — redirect to `/`
  if the user is already authenticated
- **Protected routes** (`/`, `/patterns`, `/problems`, `/problems/:id`): wrapped in
  `ProtectedRoute` + `AppShell` — redirect to `/login` if not authenticated

The `AppShell` renders the sidebar, top header, mobile drawer, and an `<Outlet>` for
the active page.

## Pages

### Home (`/`)
The command centre view:
- **Stats bar**: problems solved, patterns covered, today's recall count, average mastery
- **Today's Revision**: list of recall-due problems (Problem B, not the original triggers),
  with a "Mark Done" button that fires `POST /api/reviews` with `status: completed`
- **Targeted Practice Recommendations**: unsolved problems in the user's weakest patterns
- **Weak/Strong Patterns**: the bottom-3 and top-3 pattern masteries
- **Spaced Recall Architecture card**: explains the FSRS logic to the user

### Pattern Dashboard (`/patterns`)
Mastery across all 25 tracked DSA patterns:
- Filterable by status (Recall Due, Scheduled, Attempted, Unsolved) and by mastery tier
  (Mastered ≥80%, Strong ≥60%, Moderate ≥40%, Needs Focus <40%)
- Sortable by mastery (asc/desc), problems solved, or name
- Each pattern card shows: mastery %, problems solved, next recall date, strength tier badge
- Sidebar sections for top-3 strongest and top-3 weakest patterns

### Problem Library (`/problems`)
Full problem catalog with user-specific state overlaid:
- **Filters**: difficulty, status (Solved, Unsolved, Recall Due, Scheduled), pattern, text search
- **Pagination**: 20 problems per page; filter params synced to URL query string
- Each card shows: title, difficulty badge, pattern tags, mastery %, recall status,
  LeetCode link, Problem Details link

### Problem Details (`/problems/:id`)
Deep view of a single problem:
- Problem header: LeetCode ID, title, difficulty, pattern tags
- Mastery ring (circular progress indicator showing overall mastery %)
- Mastery breakdown: 5 component scores with progress bars
- Solving data: time taken, submission count, language, solve date
- FSRS state: current interval, next review date, ease factor
- **LLM Analysis panel**: actual vs optimal complexity + rich pedagogical breakdown
  (all 7 richAnalysis fields from Gemini)
- Accepted solution code with copy button
- Unsolved state: prompt to solve on LeetCode with the extension active

### Auth Pages (`/login`, `/register`)
Standard form-based authentication. Register requires name, email, password, confirm
password — client-side password mismatch validation runs before any API call.

## State Management

No global state library. State is managed via:
- `AuthContext`: user object, token, login/logout/register functions, loading state
- `ThemeContext`: light/dark theme preference persisted to localStorage
- Local `useState`/`useEffect` per page component

## API Client (`services/api.js`)

| Feature | Implementation |
|---|---|
| In-flight deduplication | Identical concurrent GET requests share one Promise |
| Response caching | 15-second client-side cache for all GET endpoints |
| Cache invalidation | Automatic on any non-GET request |
| Cold-start retry | Auto-retry once after 2.5 s delay on 502/504 responses |
| Dual auth | HTTP-only cookie (sent automatically) + `Authorization: Bearer` from localStorage |

## 25 Tracked DSA Patterns

```
Advanced Graphs   Arrays & Hashing   Backtracking   Binary Search
Bit Manipulation  Counting           Database       Design
Dynamic Programming  2D DP           Enumeration    Graphs
Greedy            Heap / Priority Queue  Linked List  Math & Geometry
Number Theory     Prefix Sum        Simulation     Sliding Window
Sorting           Stack             Trees          Two Pointers
Union-Find
```
