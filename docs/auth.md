# Authentication & Security

## Authentication Mechanism

CP Recall uses **JWT (JSON Web Token)** based stateless authentication.

### Registration
1. User submits name, email, and password via `POST /api/auth/register`
2. The `User` model's pre-save hook hashes the password with `bcrypt` (10 salt rounds)
3. A JWT is generated and returned; the user is immediately logged in

### Login
1. User submits email and password via `POST /api/auth/login`
2. The backend fetches the user record (with `passwordHash` explicitly selected,
   since `select: false` excludes it by default)
3. `bcrypt.compare()` validates the password
4. A JWT signed with `JWT_SECRET` (7-day expiry) is returned

### Session Management
The JWT is stored and used across two contexts:
- **Dashboard (Web App)**: Set in an **HTTP-only cookie** by the server (which restricts
  JavaScript from reading the cookie directly via `document.cookie`) and also stored
  in **`localStorage`** as `cprecall_token` for `Authorization: Bearer` requests and
  extension-key copying. `AuthContext` hydrates from `localStorage` on mount and
  verifies against `GET /api/auth/me` (clearing stale state on `401` without logging
  out on transient errors).
  > **Security note:** While the HTTP-only cookie prevents direct script access to the
  > cookie itself, it does **not** provide complete XSS protection—particularly because
  > the dashboard JWT is also stored in `localStorage`, which is readable by any
  > JavaScript executing on the same origin.
- **Tampermonkey Extension (`code/extension/cp-recal.user.js`)**: Has no independent
  login flow. After logging into the dashboard, the user clicks the **Extension Key**
  button in `TopHeader.jsx` to copy their JWT, pastes it into the extension widget's
  **Extension Key** input on LeetCode, and clicks **Save**. The script persists it in
  Tampermonkey storage (`GM_setValue("cprecall_sync_token", val)`) and sends it via
  `Authorization: Bearer <token>` using `GM_xmlhttpRequest` (bypassing `leetcode.com`
  CSP and cookie restrictions).

## `requireAuth` Middleware

```javascript
// 1. Check HTTP-only cookie first
let token = req.cookies?.token;

// 2. Fall back to Authorization: Bearer (for extension on leetcode.com)
if (!token && req.headers.authorization?.startsWith('Bearer ')) {
  token = req.headers.authorization.split(' ')[1];
}

// 3. Verify and attach user to request
const decoded = jwt.verify(token, process.env.JWT_SECRET);
req.user = { userId: decoded.userId };
```

## CORS Policy

In `code/server/src/app.js`, the server explicitly allows origins:
- `process.env.CLIENT_URL` (defaults to `http://localhost:5173`)
- `https://cprecall.vercel.app` (legacy/alternative origin)
- `https://leetcode.com` and `https://www.leetcode.com` (Tampermonkey extension)

Requests with no `Origin` header (e.g. `GM_xmlhttpRequest`, server-to-server, curl)
are also permitted. All other browser origins are rejected with a CORS error.

## Route Protection

- **Public routes**: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`,
  `/api/ingestion/health`, `GET /api/health`
- **All other routes**: protected by `requireAuth`

## Data Isolation

Every user-scoped database query in the service layer filters by `userId` extracted
from the verified JWT (`req.user.userId`). In addition, `ProblemMastery`, `FSRSState`,
and `AcceptedSolution` enforce `{userId, problemId}` unique compound indexes, and
`PatternMastery` enforces a `{userId, pattern}` unique compound index, while event
collections (`SolvingSession`, `Submission`, `ReviewHistory`) index `userId` for
scoped queries.
