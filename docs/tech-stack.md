# Technology Stack

This page describes the actual role of each technology in CP Recall, not merely its category.

## Frontend

| Technology | Role in CP Recall |
|---|---|
| React 18 | Component-based UI for all dashboard views |
| Vite | Development server and production bundler |
| React Router v6 | Client-side routing between Home, Patterns, Problems, and Auth |
| Lucide React | Icon set used throughout the UI |
| Tailwind CSS | Utility-first styling with CSS variable-based theme system |
| Vitest | Unit/component test runner |
| React Testing Library | DOM-based component testing |

## Backend

| Technology | Role in CP Recall |
|---|---|
| Node.js (ESM) | Server runtime |
| Express.js 4.x | HTTP server, middleware pipeline, and route handling |
| jsonwebtoken | Stateless auth tokens — issued on login, validated on every protected request |
| bcryptjs | Password hashing before storage (10 salt rounds) |
| cookie-parser | HTTP-only cookie handling for dashboard authentication |
| cors | Cross-origin policy permitting `CLIENT_URL` (default `localhost:5173`), `cprecall.vercel.app` (legacy/alternative), and LeetCode origins |
| dotenv | Environment variable loading |
| uuid | Unique IDs for DynamoDB entities |

## Databases

| Technology | Role in CP Recall |
|---|---|
| MongoDB Atlas | Document store for all 9 data models in development/baseline mode |
| Mongoose | Schema definition, validation, compound indexes, population |
| AWS DynamoDB | Cloud NoSQL database — production backend via `DB_BACKEND=dynamodb` (AWS region unspecified) |
| AWS SDK v3 | DynamoDB client (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`) |

## AI / External Services

| Technology | Role in CP Recall |
|---|---|
| Google Gemini 2.0 Flash | Analyses the user's accepted LeetCode solution. Returns actual vs optimal time/space complexity and a 7-field rich pedagogical breakdown of the code |
| `@google/genai` SDK | Official Google GenAI SDK used to call the Gemini API |

## Browser Extension

| Technology | Role in CP Recall |
|---|---|
| Tampermonkey | Userscript manager that runs the extension on leetcode.com |
| LeetCode GraphQL API | The extension uses LeetCode's internal GraphQL endpoints to fetch problem metadata, submission history, and accepted solution code |

## Documentation & Deployment

| Technology | Role in CP Recall |
|---|---|
| MkDocs | Static site generator for this documentation |
| MkDocs Material | Theme providing search, navigation, and responsive layout |
| GitHub Actions | CI/CD — automatically builds and deploys this site on push to master |
| GitHub Pages | Hosts the static documentation site |
| AWS EC2 | Hosts the deployed CP Recall application (frontend and backend) at `http://cprecall.duckdns.org` (region unspecified) |
