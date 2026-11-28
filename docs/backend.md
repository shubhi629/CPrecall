# Backend Architecture & API Reference

## Stack

Node.js (ESM modules), Express.js 4.x, running on port 5000 by default.

## Middleware Chain

Every request passes through:
1. `cors()` — allows `CLIENT_URL` (default `http://localhost:5173`), `https://cprecall.vercel.app` (legacy/alternative origin), `https://leetcode.com`, and `https://www.leetcode.com`
2. `express.json()` — parses JSON body
3. `cookieParser()` — parses HTTP-only cookies

Protected routes additionally pass through `requireAuth`, which validates the JWT
from either `req.cookies.token` or `Authorization: Bearer <token>` header.

## API Endpoints

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Create new user account |
| POST | `/auth/login` | No | Authenticate and receive JWT |
| GET | `/auth/me` | Yes | Get current user profile |
| POST | `/auth/logout` | No | Clear session cookie |

### Problems — `/api/problems`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/problems` | Yes | Paginated problem list with user state overlaid |
| GET | `/problems/:id` | Yes | Single problem with mastery, analysis, FSRS state |

**Query params for `GET /problems`:**
`difficulty`, `status` (solved/unsolved/recall/scheduled), `pattern`, `search`, `limit`, `offset`

When `status=recall` or `status=scheduled`, the endpoint invokes `selectRecallTargets`
and returns Problem B — not the original FSRS trigger Problem A.

### Patterns — `/api/patterns`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/patterns` | Yes | All pattern masteries + weak/strong rankings |
| GET | `/patterns/:id` | Yes | Single pattern details |

### Dashboard — `/api/dashboard`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard` | Yes | Full dashboard: stats + today's revision + weak/strong patterns |
| GET | `/dashboard/stats` | Yes | Lightweight stats only (no recall resolution) |

### Reviews — `/api/reviews`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/reviews` | Yes | Submit review outcome for a due problem |

**Body:** `{ problemId, status: "completed"|"failed"|"skipped", satisfiedByProblemId? }`

### Ingestion — `/api/ingestion`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/ingestion/health` | No | Health check for the extension |
| POST | `/ingestion/submission` | Yes | Full 9-step submission processing pipeline |

### Analysis — `/api/analyze`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/analyze` | Yes | Send code to Gemini; returns complexity + rich analysis |

### Recommendations — `/api/recommendations`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recommendations` | Yes | Unsolved problems in the user's weakest patterns |

### Progress — `/api/progress`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/progress/reset` | Yes | Atomic reset of all user progress (DynamoDB) |
| POST | `/progress/dismiss-completion` | Yes | Dismiss the library-completion prompt |

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | No | Service liveness check |

## Error Handling

Centralised error middleware handles:
- **409 Conflict**: DynamoDB `ConditionalCheckFailedException`, Mongoose `code: 11000`
- **400 Bad Request**: Mongoose `ValidationError`
- **401 Unauthorized**: JWT `TokenExpiredError` or invalid token
- **5xx**: generic `Internal Server Error`

Unmatched routes return `404 Route not found`.
