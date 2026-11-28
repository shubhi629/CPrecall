# CP Recall — Adaptive Competitive Programming Pattern Retention System

CP Recall is a full-stack web application paired with a Tampermonkey browser extension that helps competitive programmers build long-term retention of **Data Structures & Algorithms (DSA) patterns**, rather than memorizing individual problem solutions.

Instead of tracking only problem counts, CP Recall integrates into LeetCode, captures solving sessions, analyses accepted solutions using **Google Gemini 2.0 Flash**, computes a 5-component mastery score, and uses a **simplified FSRS-inspired custom scheduler** to schedule pattern-level reviews. When a review is due, the dashboard surfaces a **different, unsolved problem** from the same weak pattern family to test conceptual transfer.

- **Live Deployment (AWS EC2):** `http://cprecall.duckdns.org` *(serves over plain HTTP; AWS region unspecified)*
- **Documentation Site:** Built with MkDocs Material from [`docs/`](docs/index.md) via GitHub Actions (`.github/workflows/mkdocs.yml`)
- **Course:** UCS503: Software Engineering (2026–27, Odd Semester) — Thapar Institute of Engineering and Technology

---

## Table of Contents

1. [Core Insight](#core-insight)
2. [Key Features](#key-features)
3. [System Architecture](#system-architecture)
4. [Repository Structure](#repository-structure)
5. [Technology Stack](#technology-stack)
6. [End-to-End Workflow](#end-to-end-workflow)
7. [Mastery Scoring & Spaced Repetition](#mastery-scoring--spaced-repetition)
8. [Installation & Setup](#installation--setup)
9. [Running Locally](#running-locally)
10. [Testing & Verification](#testing--verification)
11. [Known Limitations](#known-limitations)
12. [Documentation](#documentation)

---

## Core Insight

> Solving a Sliding Window problem today does not guarantee you will recognize a new Sliding Window problem three weeks from now.

Standard practice platforms track *whether* a problem was accepted. CP Recall adds a pattern-level memory layer that measures *how well* you solved it and schedules a **different, unsolved problem** from the same pattern when your review interval matures.

---

## Key Features

- **LeetCode Browser Extension (`code/extension/cp-recal.user.js`):**
  - Tampermonkey userscript (`v3.1.0`) for `leetcode.com/problems/*`
  - Tracks session start/end time, handles LeetCode SPA navigation, and polls GraphQL every 4 seconds for new submissions
  - Excludes pre-session submissions using a `lastSeenTopId` baseline
  - Draggable floating overlay widget with Waiting, Solved, and Submitted states
  - Manual **Hints Used** numeric input (default `0`; not auto-tracked)
- **AI Code Analysis (`gemini-2.0-flash`):**
  - Evaluates accepted code for actual vs. optimal time and space complexity
  - Produces a 7-field pedagogical breakdown (`problemUnderstanding`, `yourApproach`, `correctness`, `optimalApproach`, `comparison`, `efficiencyAssessment`, `improvementSuggestions`)
- **5-Component Mastery Scoring:**
  - Combines Solution Efficiency (25%), Time Complexity (25%), Submissions Until Success (20%), Time Taken (15%), and Hints Used (15%)
- **Simplified FSRS-Inspired Scheduler & A→B Recall Engine:**
  - Maps mastery (`0–100`) to ratings `1–4` with initial intervals (`1`, `3`, `7`, `14` days) and adaptive `easeFactor` (`1.3–2.5`)
  - Resolves each due trigger problem **A** to a **different, unsolved** target problem **B** in the user's weakest pattern and target difficulty tier
- **React Dashboard (`code/client`):**
  - **Command Center (`/`):** Stats overview, Today's Revision (Problem B targets with "Mark Done"), targeted practice recommendations, top/weak patterns
  - **Pattern Mastery (`/patterns`):** Tracks all 25 DSA patterns with status/tier filters and sorting
  - **Problem Library (`/problems`):** Indexed problem catalog with search, pattern/difficulty/status filters, and 20-per-page pagination
  - **Problem Details (`/problems/:id`):** Mastery ring, 5-component breakdown, FSRS state, Gemini rich analysis, and accepted code viewer
- **Dual-Database Abstraction Layer:**
  - Switches between **MongoDB** (9 Mongoose models) and **AWS DynamoDB** (10 repositories: 9 model repositories + `progressResetRepo.js`) via `DB_BACKEND`, with optional `DUAL_WRITE=true` shadow syncing

---

## System Architecture

```text
LeetCode (Browser)
  │
  ▼
Tampermonkey Extension (code/extension/cp-recal.user.js)
  ├─ GraphQL: questionData, submissionList (4s poll), submissionDetails
  ├─ POST /api/analyze              (Bearer JWT via GM_xmlhttpRequest)
  └─ POST /api/ingestion/submission (Bearer JWT via GM_xmlhttpRequest)
  │
  ▼
Express.js REST API (code/server, Node.js ESM, Port 5000)
  ├─ /api/auth, /api/problems, /api/patterns, /api/dashboard
  ├─ /api/reviews, /api/ingestion, /api/analyze
  ├─ /api/recommendations, /api/progress, /api/health
  │
  ├─► Google Gemini 2.0 Flash (@google/genai)
  └─► Database Abstraction Layer (DB_BACKEND = mongodb | dynamodb, DUAL_WRITE)
        ├─ MongoDB Atlas (9 Mongoose models)
        └─ AWS DynamoDB (10 repositories)

React 18 + Vite Dashboard (code/client, Port 5173 in dev)
  └─ /, /patterns, /problems, /problems/:id, /login, /register
```

---

## Repository Structure

```text
CPrecall-master/
├── .github/workflows/
│   └── mkdocs.yml              # GitHub Actions CI/CD for GitHub Pages docs
├── code/
│   ├── client/                 # React 18 + Vite frontend & 7 Vitest suites
│   ├── extension/
│   │   └── cp-recal.user.js    # Tampermonkey userscript (v3.1.0)
│   └── server/                 # Express.js backend, models, repositories, services, scripts
├── docs/                       # 18-page MkDocs documentation + docs/summary.md
├── journals/                   # Team member weekly journals
├── mkdocs.yml                  # MkDocs Material configuration
├── summary.md                  # Root navigation index
└── README.md                   # Project overview & quick start
```

---

## Technology Stack

| Layer | Technologies | Role in CP Recall |
|---|---|---|
| **Frontend** | React 18, Vite, React Router v6, Tailwind CSS, Lucide React | Dashboard UI, 15s GET cache & request deduplication (`api.js`), theme & auth contexts |
| **Backend** | Node.js (ESM), Express 4.x, `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `cors` | REST API, 9-step ingestion pipeline, mastery/FSRS/recall services, dual auth |
| **Databases** | MongoDB + Mongoose (9 models), AWS DynamoDB + AWS SDK v3 (10 repositories) | Persistent storage, `DB_BACKEND` switching, `DUAL_WRITE` shadow sync |
| **AI** | Google Gemini 2.0 Flash (`@google/genai`) | Complexity estimation and 7-field code analysis |
| **Extension** | Tampermonkey (`GM_setValue`, `GM_getValue`, `GM_xmlhttpRequest`), LeetCode GraphQL | Session tracking, submission polling, floating widget UI |
| **Testing** | Vitest, React Testing Library, Node verification scripts | Frontend component/unit tests (`code/client/src/test/`) & backend integration scripts |
| **Docs & Hosting** | MkDocs Material, GitHub Pages, AWS EC2 (`http://cprecall.duckdns.org`) | Documentation site & live application hosting |

---

## End-to-End Workflow

1. **Authenticate & Link Extension:** Log into the CP Recall dashboard, click **Extension Key** in the top header (`TopHeader.jsx`) to copy your JWT, and paste it into the Tampermonkey widget on LeetCode (`GM_setValue("cprecall_sync_token")`).
2. **Solve on LeetCode:** Opening a problem records `sessionStartTime` and `lastSeenTopId`. Every submission is recorded into `submissionHistory[]`.
3. **Analyze Code:** Upon `Accepted`, the extension fetches the code and calls `POST /api/analyze`. The backend calls Gemini 2.0 Flash (lazy-loading the problem description from LeetCode `questionContent` if the problem already exists in the DB without one).
4. **Submit & Score:** You optionally enter **Hints Used** (manual input, default `0`) and click **Submit to CPRecal** (`POST /api/ingestion/submission`).
5. **9-Step Ingestion (`processSubmission.js`):** Upserts `Problem`, creates `SolvingSession`, batch-creates `Submission` records, upserts `AcceptedSolution`, computes `ProblemMastery`, updates `PatternMastery`, updates `FSRSState`, and logs `ReviewHistory`.
6. **Recall Review:** On the dashboard, due `FSRSState` triggers (Problem **A**) are resolved by `recallSelector.js` into different, unsolved target problems (Problem **B**) in your weakest pattern. Marking a review done updates the FSRS interval via `POST /api/reviews`.

---

## Mastery Scoring & Spaced Repetition

### Problem Mastery Formula (`scoring.js`)

$$\text{Mastery} = \text{round}(0.25 \cdot \text{SE} + 0.25 \cdot \text{TC} + 0.20 \cdot \text{SUS} + 0.15 \cdot \text{TT} + 0.15 \cdot \text{HU})$$

| Component | Weight | Rule |
|---|---|---|
| **Solution Efficiency (SE)** | 25% | `100` if TC & SC match optimal; `-30` for non-optimal TC, `-10` for non-optimal SC |
| **Time Complexity (TC)** | 25% | `100` if user TC matches optimal TC; `75` otherwise |
| **Submissions Until Success (SUS)** | 20% | `max(0, 100 - (count - 1) * 20)` |
| **Time Taken (TT)** | 15% | `100` if within baseline (Easy `5m`, Medium `15m`, Hard `30m`), else `100 / (minutes / baseline)` |
| **Hints Used (HU)** | 15% | `max(0, 100 - hintsUsed * 15)` (from manual widget input) |

*(Component weights and penalties are heuristic design choices in CP Recall's scoring model.)*

### Mastery → FSRS-Inspired Rating & Initial Interval (`ratingMapper.js`)

| Mastery Score | Rating | Label | Initial Interval |
|---|---|---|---|
| `0–39` | `1` | Learn | 1 day |
| `40–59` | `2` | Moderate | 3 days |
| `60–79` | `3` | Good | 7 days |
| `80–100` | `4` | Excellent | 14 days |

*(Uses a simplified interval-and-`easeFactor` scheduler rather than the full FSRS-4.5/5 DSR model.)*

---

## Installation & Setup

### Option A: Quick Start (Live Hosted App + Extension)

1. Open **`http://cprecall.duckdns.org`** and register or log in.
2. Install the **Tampermonkey** browser extension.
3. Create a new userscript in Tampermonkey and paste the contents of [`code/extension/cp-recal.user.js`](code/extension/cp-recal.user.js).
4. On the CP Recall dashboard, click **Extension Key** in the top header to copy your JWT.
5. Open any problem on `leetcode.com/problems/*`, paste the key into the widget's **Extension Key** input, and click **Save**.

### Option B: Local Development Setup

#### Prerequisites
- Node.js 18+ and `npm`
- MongoDB Atlas (or local MongoDB) **or** AWS DynamoDB / DynamoDB Local
- Google Gemini API key (`GEMINI_API_KEY`)
- Tampermonkey browser extension

#### 1. Backend (`code/server`)
```bash
cd code/server
cp .env.example .env
# Edit .env: set MONGODB_URI (or DB_BACKEND=dynamodb + AWS_*), JWT_SECRET, CLIENT_URL, GEMINI_API_KEY
npm install
npm run dev    # Starts Express API on http://localhost:5000
```

*(Optional — Local DynamoDB)*:
```bash
cd code/server
npm run db:install
npm run db:local
npm run db:init
npm run db:verify
```

#### 2. Frontend (`code/client`)
```bash
cd code/client
npm install
npm run dev    # Starts Vite dev server on http://localhost:5173
```

#### 3. Extension (Local Mode)
In `code/extension/cp-recal.user.js`, update:
```javascript
const BACKEND_URL = "http://localhost:5000";
const FRONTEND_URL = "http://localhost:5173";
```
Then copy your **Extension Key** from `http://localhost:5173` into the widget on LeetCode.

---

## Testing & Verification

### Frontend Unit/Component Tests (7 Vitest Suites)
```bash
cd code/client
npm run test
```
Covers `auth.test.jsx`, `dashboard.test.jsx`, `patterns.test.jsx`, `problemDetails.test.jsx`, `problems.test.jsx`, `resetProgress.test.jsx`, and `theme.test.jsx` (with `api.js` and router dependencies mocked).

### Backend Verification Scripts
```bash
cd code/server
npm run test    # Runs verify_library_recall.js
```
Additional verification scripts in `code/server/` include `run_all_tests.js`, `scripts/verifyPhase1.js`, `scripts/testAllRepositories.js`, `scripts/testPhase3Integration.js`, `scripts/testPhase5Cutover.js`, and `scripts/verifyCloudDatabaseIntegrity.js`.

---

## Known Limitations

- **Plain HTTP Deployment:** `http://cprecall.duckdns.org` currently uses HTTP without TLS encryption in transit.
- **JWT Storage & Manual Copy-Paste:** Dashboard JWTs are stored in both HTTP-only cookies and `localStorage` (`cprecall_token`), so HTTP-only cookies alone do not provide complete XSS protection; linking the extension requires manual key copy-paste.
- **Manual Hint Tracking:** Hint count is self-reported in the widget rather than auto-detected.
- **Simplified FSRS-Inspired Model:** Uses a custom interval + `easeFactor` model rather than full FSRS-4.5/5 DSR parameters.
- **Gemini Complexity Fallback:** Missing complexity fields in Gemini's JSON output fall back to `"O(N)"`, which can affect mastery scores.
- **First-Solve Description Availability:** `questionData` in the extension does not fetch problem descriptions; `POST /api/analyze` lazy-loads descriptions only if the `Problem` record already exists in the DB.
- **Progress Reset Scope:** Atomic progress reset with locking (`progressResetService.js`) is implemented for DynamoDB only.
- **Single Accepted Solution:** `AcceptedSolution` is upserted on re-solve, keeping only the latest accepted code and analysis per `(user, problem)`.

---

## Documentation

Full technical documentation is available in [`docs/`](docs/index.md):

- [Overview](docs/index.md) · [Problem Statement](docs/problem-statement.md) · [Architecture](docs/architecture.md) · [Tech Stack](docs/tech-stack.md) · [Workflow](docs/workflow.md)
- [Frontend](docs/frontend.md) · [Backend & API](docs/backend.md) · [Database Design](docs/database.md) · [Authentication](docs/auth.md)
- [Mastery Scoring](docs/mastery-scoring.md) · [FSRS-Inspired Scheduling](docs/fsrs.md) · [Recall Engine](docs/recall-engine.md) · [AI Integration](docs/ai-integration.md) · [Browser Extension](docs/extension.md)
- [Setup & Development](docs/setup.md) · [Testing](docs/testing.md) · [Deployment](docs/deployment.md) · [Limitations & Future Scope](docs/limitations.md)
