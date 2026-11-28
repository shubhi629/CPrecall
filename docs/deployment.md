# Deployment Architecture

## Documentation (GitHub Pages)

Automatically deployed on every push to `master` or `main` via
`.github/workflows/mkdocs.yml`:

1. Checkout repository
2. Install Python 3.x and all MkDocs dependencies
3. Run `PYTHONPATH=src:$PYTHONPATH mkdocs gh-deploy --force`

The site is built to the `gh-pages` branch by MkDocs Material.

## Application Deployment (AWS EC2)

The live CP Recall application (both the React frontend and Express.js backend API) is
deployed on **AWS EC2** at:

`http://cprecall.duckdns.org`

- **AWS Region**: Unspecified (not verified from deployment infrastructure; `.env.example`
  contains `ap-southeast-2` only as an example placeholder).
- **Transport Protocol**: The confirmed URL uses plain **HTTP** (`http://cprecall.duckdns.org`),
  not HTTPS; traffic to this endpoint is not TLS-encrypted in transit.
- **Frontend build command**: `npm run build` (Vite production build, output to `dist/`).
- **Backend start command**: `node src/server.js`. The server binds to the port
  immediately at startup and initialises the database connection in the background.

> **Note on earlier/alternative deployment references in the codebase:**
> Comments in `code/extension/cp-recal.user.js`, `code/server/src/app.js` CORS, and
> the 502/504 retry handler in `code/client/src/services/api.js` reference earlier
> Vercel (`cprecall.vercel.app`) and Render (`cprecall-api.onrender.com`) targets.
> The confirmed live deployment URL is `http://cprecall.duckdns.org` on AWS EC2.

## Database

| Environment | Backend |
|---|---|
| Development | MongoDB Atlas (via `MONGODB_URI`) or DynamoDB Local |
| Production | AWS DynamoDB (via `DB_BACKEND=dynamodb` + `AWS_*` credentials; region unspecified) |

The DynamoDB problem catalog (`problemRepo.initCatalog()`) is loaded into server
memory at startup, eliminating repeated remote reads for high-frequency pattern-matching
queries in `selectRecallTargets`.

## Environment Variables

All sensitive configuration is managed through environment variables and must never
be committed to the repository. See [Setup](setup.md) for the full list. The
`.env.example` file in `code/server/` documents all required variables with
placeholder values.
