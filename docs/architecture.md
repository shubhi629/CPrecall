# System Architecture

## High-Level Overview

CP Recall consists of three primary components:

```
┌────────────────────────────────────────────────────────────┐
│                     LeetCode (Browser)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Tampermonkey Browser Extension              │  │
│  │  • Detects accepted submissions via GraphQL polling  │  │
│  │  • Tracks session time (page open → accepted)        │  │
│  │  • Collects full submission history array            │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┼──────────────────────────────────┘
                          │  POST /api/analyze  (Bearer token)
                          │  POST /api/ingestion/submission
                          ▼
┌────────────────────────────────────────────────────────────┐
│               Express.js REST API (Node.js, ESM)            │
│                                                            │
│  /api/auth          User registration and login             │
│  /api/analyze       LLM code complexity analysis           │
│  /api/ingestion     Submission processing pipeline         │
│  /api/problems      Problem catalog with user state        │
│  /api/patterns      Pattern mastery aggregates             │
│  /api/dashboard     Combined stats + today's recall        │
│  /api/reviews       FSRS review submission                 │
│  /api/recommendations  Targeted practice suggestions       │
│  /api/progress      Progress reset and completion          │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Database Abstraction Layer                   │  │
│  │  DB_BACKEND=mongodb  → Mongoose (MongoDB Atlas)       │  │
│  │  DB_BACKEND=dynamodb → Repositories (AWS DynamoDB)  │  │
│  │  DUAL_WRITE=true     → Shadow-sync to both           │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────────────────┘
                       │
           ┌───────────┴────────────┐
           ▼                        ▼
      MongoDB Atlas            AWS DynamoDB
      (Mongoose models)        (Repository layer)

┌────────────────────────────────────────────────────────────┐
│               React Dashboard (Vite + React 18)             │
│                                                            │
│  /            Home — today's recall + stats overview       │
│  /patterns    Pattern Mastery — all 25 DSA patterns        │
│  /problems    Problem Library — 4000+ indexed problems     │
│  /problems/:id  Problem Details — mastery + AI analysis   │
│  /login, /register  Authentication                         │
└────────────────────────────────────────────────────────────┘
```

## Repository Structure

```
CPrecall-master/
│
├── .github/workflows/
│   └── mkdocs.yml              # CI/CD — deploys this documentation to GitHub Pages
│
├── code/
│   ├── client/                 # React frontend (Vite)
│   │   └── src/
│   │       ├── components/     # Reusable UI components
│   │       │   ├── auth/       # ProtectedRoute, PublicRoute
│   │       │   ├── common/     # DifficultyBadge, MasteryBar, MasteryRing, etc.
│   │       │   └── layout/     # AppShell, Sidebar, TopHeader, MobileDrawer
│   │       ├── context/        # AuthContext, ThemeContext
│   │       ├── pages/          # Home, PatternDashboard, ProblemLibrary,
│   │       │                   # ProblemDetails, Auth (Login/Register)
│   │       ├── services/       # api.js (HTTP client), utils.js (helpers)
│   │       └── test/           # 7 Vitest test suites
│   │
│   ├── extension/              # Tampermonkey userscript
│   │   └── cp-recal.user.js    # LeetCode tracker, widget UI, Gemini + ingestion client
│   │
│   └── server/                 # Express.js backend (Node.js, ESM)
│       └── src/
│           ├── config/         # db.js, dbBackend.js, dynamodb.js, cookieConfig.js
│           ├── controllers/    # Route handler functions
│           ├── middleware/     # auth.js (JWT validation)
│           ├── models/         # 9 Mongoose schemas
│           ├── repositories/   # 10 DynamoDB data access objects (9 models + progressResetRepo)
│           ├── routes/         # 9 Express router files
│           └── services/
│               ├── dashboard/  # dashboardService.js
│               ├── fsrs/       # scheduler.js, recallSelector.js, ratingMapper.js
│               ├── ingestion/  # processSubmission.js
│               ├── llm/        # codeAnalysis.js (Gemini integration)
│               ├── mastery/    # scoring.js, problemMastery.js, patternMastery.js
│               └── progress/   # progressResetService.js
│
├── docs/                       # GitHub Pages documentation (this site)
├── journals/                   # Individual team member journals
├── assets/                     # Site assets (logo, icons, CSS)
├── mkdocs.yml                  # MkDocs site configuration
└── summary.md                  # MkDocs navigation definition
```
