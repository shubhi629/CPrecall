# Testing

## Frontend Tests

The frontend uses **Vitest** as the test runner and **React Testing Library** for
DOM-based component testing. Test files are in `code/client/src/test/`.

### Test Suites

| File | What is Tested |
|---|---|
| `auth.test.jsx` | Login form submission calls the API; registration validates password mismatch client-side |
| `dashboard.test.jsx` | Dashboard data loading, stats display, recall section rendering |
| `patterns.test.jsx` | Pattern list filtering by status/tier, sorting behaviour |
| `problemDetails.test.jsx` | Problem details rendering: mastery ring, analysis panel, code display |
| `problems.test.jsx` | Problem library filter, search, and pagination interactions |
| `resetProgress.test.jsx` | Reset progress modal confirmation flow |
| `theme.test.jsx` | Light/dark theme switching and localStorage persistence |

External dependencies (api.js, React Router) are mocked using `vi.mock()`.

### Running Tests

```bash
cd code/client
npm run test                    # run all tests once
npm run test -- --coverage      # with coverage report
npm run test -- --watch         # watch mode
```

## Backend Verification Scripts

The backend does not use a formal unit test framework. Instead, it has integration
and verification scripts in `code/server/`:

| Script | Purpose |
|---|---|
| `verify_library_recall.js` | Verifies the A→B recall target resolution logic |
| `run_all_tests.js` | Runs all backend verification scripts in sequence |
| `scripts/verifyPhase1.js` | DynamoDB Phase 1 table creation verification |
| `scripts/testAllRepositories.js` | Repository layer integration tests against DynamoDB |
| `scripts/testPhase3Integration.js` | Mastery + FSRS pipeline integration test |
| `scripts/testPhase5Cutover.js` | DynamoDB cutover verification |
| `scripts/verifyCloudDatabaseIntegrity.js` | Cloud DynamoDB data integrity check |

```bash
cd code/server
npm run test    # runs verify_library_recall.js
```

## Coverage

| Area | Coverage |
|---|---|
| Auth flow (login, register) | Covered (frontend unit tests) |
| Dashboard rendering | Covered |
| Pattern filtering and sorting | Covered |
| Problem library interactions | Covered |
| Progress reset flow | Covered |
| Theme persistence | Covered |
| Tampermonkey extension | Not covered (no automated tests in this repo) |
| Gemini API integration | Not covered (mocked at boundary) |
| DynamoDB repositories | Covered by integration scripts, not unit tests |
| End-to-end browser tests | Not covered (no Playwright or Cypress setup) |
