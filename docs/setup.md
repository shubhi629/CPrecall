# Setup & Local Development

## Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas cluster (or local MongoDB) OR AWS DynamoDB credentials
- Google Gemini API key
- Tampermonkey browser extension

## 1. Clone the Repository

```bash
git clone <your-repo-url>
cd CPrecall-master
```

## 2. Backend Setup

```bash
cd code/server
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)
npm install
npm run dev    # starts on port 5000 with nodemon
```

## Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 5000) |
| `NODE_ENV` | No | `development` or `production` |
| `MONGODB_URI` | Yes (MongoDB mode) | MongoDB Atlas connection string |
| `JWT_SECRET` | Yes | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | No | Token expiry (default: `7d`) |
| `CLIENT_URL` | No | Frontend URL for CORS |
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `DB_BACKEND` | No | `mongodb` (default) or `dynamodb` |
| `DUAL_WRITE` | No | `true` to write to both databases |
| `DYNAMODB_MODE` | No | `cloud` for AWS, `local` for emulator |
| `AWS_REGION` | Yes (DynamoDB) | AWS region for DynamoDB (`.env.example` uses `ap-southeast-2` as an example placeholder) |
| `AWS_ACCESS_KEY_ID` | Yes (DynamoDB) | — |
| `AWS_SECRET_ACCESS_KEY` | Yes (DynamoDB) | — |

## 3. Frontend Setup

```bash
cd code/client
npm install
npm run dev    # starts Vite dev server on port 5173
```

The frontend proxies API requests to the backend via Vite's proxy configuration.

## 4. DynamoDB Local (Optional)

For offline DynamoDB development:

```bash
cd code/server
npm run db:install   # downloads DynamoDB Local binary
npm run db:local     # starts local DynamoDB on port 8000
npm run db:init      # creates tables
npm run db:verify    # verifies setup
```

## 5. Extension Setup

1. Install the Tampermonkey browser extension.
2. Add a new userscript using the contents of `code/extension/cp-recal.user.js`.
3. For local development, update `BACKEND_URL` (`http://localhost:5000`) and
   `FRONTEND_URL` (`http://localhost:5173`) at the top of the script (default is
   `http://cprecall.duckdns.org`).
4. Log into the dashboard, click **Extension Key** in the top header to copy your JWT,
   and paste it into the widget's **Extension Key** field on any LeetCode problem page.

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` (server) | Start backend with hot reload |
| `npm run start` (server) | Start backend in production mode |
| `npm run dev` (client) | Start frontend dev server |
| `npm run test` (client) | Run Vitest test suite |
| `npm run build` (client) | Build for production |
| `npm run db:migrate` (server) | Migrate data from MongoDB to DynamoDB |
| `npm run db:reconcile` (server) | Reconcile data between both databases |
