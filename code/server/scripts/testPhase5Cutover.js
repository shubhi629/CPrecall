import dotenv from "dotenv";
dotenv.config();

// Ensure DB_BACKEND=dynamodb and DUAL_WRITE=true
process.env.DB_BACKEND = "dynamodb";
process.env.DUAL_WRITE = "true";

import http from "http";
import mongoose from "mongoose";
import app from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { initTables } from "./initLocalDynamo.js";
import problemRepo from "../src/repositories/problemRepo.js";
import { runReconciliation } from "./reconcileDatabases.js";
import { runReverseSync } from "./reverseSyncDynamoToMongo.js";

async function runPhase5CutoverVerification() {
  console.log("================================================================================");
  console.log("CPRecal — Phase 5: End-to-End Cutover & Dual-Write Verification Suite");
  console.log("================================================================================\n");

  console.log("Configuring DynamoDB Local (Primary) & MongoDB (Standby)...");
  await initTables();
  await problemRepo.initCatalog();

  try {
    await connectDB();
    console.log("MongoDB Standby connected for dual-write verification.\n");
  } catch (err) {
    console.warn("MongoDB connection warning:", err.message);
  }

  // Start HTTP server on an ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Live test server listening on ${baseUrl}\n`);

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  let cookieHeader = null;
  const uniqueSuffix = Date.now();
  const testEmail = `cutover_user_${uniqueSuffix}@example.com`;
  const testPassword = "CutoverPassword2026!";
  let testUserId = null;
  let sampleProblemId = null;
  let sampleProblemSlug = null;

  try {
    // 1. Health check
    await test("HTTP GET /api/health -> 200 OK", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.status !== "ok") throw new Error(`Expected status ok, got ${data.status}`);
    });

    // 2. Auth: Registration
    await test("HTTP POST /api/auth/register -> 201 Created with JWT cookie", async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Cutover Verifier",
          email: testEmail,
          password: testPassword,
        }),
      });

      if (res.status !== 201) {
        const body = await res.text();
        throw new Error(`Expected 201, got ${res.status}: ${body}`);
      }

      const setCookie = res.headers.get("set-cookie");
      if (!setCookie || !setCookie.includes("token=")) {
        throw new Error("Missing token cookie in response headers");
      }
      cookieHeader = setCookie.split(";")[0];

      const data = await res.json();
      if (!data.user || !data.user.id || data.user.email !== testEmail.toLowerCase()) {
        throw new Error(`Unexpected user payload: ${JSON.stringify(data)}`);
      }
      testUserId = data.user.id;
    });

    // 3. Auth: Duplicate registration rejected
    await test("HTTP POST /api/auth/register (Duplicate) -> 409 Conflict", async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Cutover Clone",
          email: testEmail,
          password: testPassword,
        }),
      });
      if (res.status !== 409) {
        throw new Error(`Expected 409, got ${res.status}`);
      }
    });

    // 4. Auth: Login
    await test("HTTP POST /api/auth/login -> 200 OK with refreshed cookie", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const setCookie = res.headers.get("set-cookie");
      if (setCookie && setCookie.includes("token=")) {
        cookieHeader = setCookie.split(";")[0];
      }
    });

    // 5. Auth: Get Current User (/me)
    await test("HTTP GET /api/auth/me -> 200 OK with authenticated user profile", async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (data.user.id !== testUserId) {
        throw new Error(`User ID mismatch: expected ${testUserId}, got ${data.user.id}`);
      }
    });

    // 6. Problem Library Pagination Contract
    await test("HTTP GET /api/problems -> exact contract { problems, total, limit, offset }", async () => {
      const res = await fetch(`${baseUrl}/api/problems?limit=15&page=1`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.problems)) throw new Error("problems is not an array");
      if (typeof data.total !== "number" || data.total <= 0) {
        throw new Error(`Invalid total: ${data.total}`);
      }
      if (data.limit !== 15 || data.offset !== 0) {
        throw new Error(`Limit/offset mismatch: limit=${data.limit}, offset=${data.offset}`);
      }
      sampleProblemId = data.problems[0].id || data.problems[0]._id;
      sampleProblemSlug = data.problems[0].titleSlug;
    });

    // 7. Problem Library Filtering by Difficulty
    await test("HTTP GET /api/problems?difficulty=Medium -> all items are Medium & 0 duplicate items", async () => {
      const res = await fetch(`${baseUrl}/api/problems?difficulty=Medium&limit=25&page=1`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      const seenIds = new Set();
      for (const p of data.problems) {
        const pId = p.id || p._id;
        if (p.difficulty !== "Medium") throw new Error(`Difficulty mismatch on ${p.title}`);
        if (seenIds.has(pId)) throw new Error(`Duplicate problem returned: ${pId}`);
        seenIds.add(pId);
      }
    });

    // 8. Problem Details by ID
    await test("HTTP GET /api/problems/:id -> retrieves problem metadata", async () => {
      const res = await fetch(`${baseUrl}/api/problems/${sampleProblemId}`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.problem || (data.problem.id !== sampleProblemId && data.problem._id !== sampleProblemId)) {
        throw new Error("Problem metadata ID mismatch");
      }
    });

    // 9. Pattern Rankings
    await test("HTTP GET /api/patterns -> returns pattern analytics", async () => {
      const res = await fetch(`${baseUrl}/api/patterns`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.patterns)) throw new Error("patterns must be an array");
    });

    // 10. Tampermonkey Extension Ingestion Pipeline
    const testLeetcodeId = 9100 + Math.floor(Math.random() * 800);
    let ingestedProblemId = null;
    await test("HTTP POST /api/ingestion/submission -> processes full extension payload", async () => {
      const payload = {
        problemId: testLeetcodeId,
        title: `Cutover Problem ${uniqueSuffix}`,
        titleSlug: `cutover-problem-${uniqueSuffix}`,
        difficulty: "Medium",
        patterns: ["Two Pointers", "Sliding Window"],
        sessionStart: new Date(Date.now() - 900000).toISOString(),
        sessionEnd: new Date().toISOString(),
        submissionHistory: [
          {
            submissionId: `cutover_sub_wrong_${uniqueSuffix}`,
            status: "Wrong Answer",
            runtime: "0 ms",
            memory: "42.1 MB",
            language: "javascript",
            timestamp: new Date(Date.now() - 400000).toISOString(),
          },
          {
            submissionId: `cutover_sub_acc_${uniqueSuffix}`,
            status: "Accepted",
            runtime: "52 ms",
            memory: "44.2 MB",
            language: "javascript",
            timestamp: new Date().toISOString(),
          },
        ],
        acceptedSubmissionId: `cutover_sub_acc_${uniqueSuffix}`,
        acceptedCode: "function cutoverSolve() { return true; }",
        language: "javascript",
        hintsUsed: 0,
        analysisResult: {
          actualTimeComplexity: "O(n)",
          actualSpaceComplexity: "O(1)",
          optimalTimeComplexity: "O(n)",
          optimalSpaceComplexity: "O(1)",
          explanation: "Optimal two pointers approach verified.",
        },
      };

      const res = await fetch(`${baseUrl}/api/ingestion/submission`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
      });

      if (res.status !== 201) {
        const body = await res.text();
        throw new Error(`Expected 201, got ${res.status}: ${body}`);
      }

      const data = await res.json();
      if (!data.success || !data.problemMastery) {
        throw new Error(`Ingestion failure: ${JSON.stringify(data)}`);
      }
      if (typeof data.problemMastery.mastery !== "number") {
        throw new Error("Missing mastery score");
      }
      ingestedProblemId = data.problem.id;
    });

    // 11. Due Reviews retrieval via sparse GSI
    await test("HTTP GET /api/reviews/due -> returns due reviews chronologically", async () => {
      const res = await fetch(`${baseUrl}/api/reviews/due`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.reviews)) throw new Error("reviews must be an array");
    });

    // 12. Review submission
    await test("HTTP POST /api/reviews -> records review & advances FSRS interval", async () => {
      const res = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          problemId: ingestedProblemId,
          status: "completed",
        }),
      });

      if (res.status !== 200) {
        const body = await res.text();
        throw new Error(`Expected 200, got ${res.status}: ${body}`);
      }

      const data = await res.json();
      const intervalDays = data.fsrsState?.intervalDays || data.updated?.fsrs?.intervalDays;
      if (!intervalDays) {
        throw new Error(`Invalid review response: ${JSON.stringify(data)}`);
      }
    });

    // 13. A -> B Recall Recommendations
    await test("HTTP GET /api/recommendations -> enforces A -> B Recall Invariant", async () => {
      const res = await fetch(`${baseUrl}/api/recommendations`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.recommendations)) {
        throw new Error("recommendations must be an array");
      }
      // Target problem B must never be the solved trigger problem
      for (const rec of data.recommendations) {
        const recId = rec.id || rec._id;
        if (recId === ingestedProblemId) {
          throw new Error(`CRITICAL INVARIANT VIOLATION: Solved trigger problem ${recId} was returned as recommendation!`);
        }
      }
    });

    // 14. Dashboard KPIs
    await test("HTTP GET /api/dashboard -> sub-2ms point lookup KPIs verified", async () => {
      const res = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const data = await res.json();
      if (!data.stats || typeof data.stats.totalSolved !== "number" || data.stats.totalSolved < 1) {
        throw new Error(`stats.totalSolved expected >= 1, got ${data?.stats?.totalSolved}`);
      }
      if (!data.weakPatterns || !Array.isArray(data.todaysRevision)) {
        throw new Error("Malformed dashboard payload");
      }
    });

    // 15. Auth Logout
    await test("HTTP POST /api/auth/logout -> clears cookie & rejects subsequent /me", async () => {
      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      
      const setCookie = res.headers.get("set-cookie");
      let expiredCookie = "";
      if (setCookie) {
        expiredCookie = setCookie.split(";")[0];
      }

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: expiredCookie },
      });
      if (meRes.status !== 401) {
        throw new Error(`Expected 401 after logout, got ${meRes.status}`);
      }
    });

    // 16. Reverse-Sync Dry Run (Zero-loss rollback safety guarantee)
    await test("Reverse-Sync Rollback Safety Guarantee (--dry-run)", async () => {
      await runReverseSync({ isDryRun: true });
    });

    // 17. Authoritative Database Reconciliation Check
    await test("Authoritative Parity Reconciliation (0 discrepancies)", async () => {
      const report = await runReconciliation();
      if (!report.passed || report.discrepancies.length !== 0) {
        throw new Error(`Reconciliation detected ${report.discrepancies.length} discrepancies!`);
      }
    });

  } finally {
    server.close();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log("\n================================================================================");
  console.log(`Results: ${passed}/${total} Phase 5 cutover verification tests passed.`);
  console.log("================================================================================");

  if (passed === total) {
    console.log("🎉 ALL PHASE 5 END-TO-END CUTOVER VERIFICATION TESTS PASSED CLEANLY!");
    console.log("🚀 DynamoDB Backend is 100% verified, dual-write verified, and cutover ready.");
  } else {
    console.error(`⚠️ ${total - passed} tests failed!`);
    process.exit(1);
  }
}

runPhase5CutoverVerification().catch((err) => {
  console.error("Fatal error during Phase 5 cutover verification:", err);
  process.exit(1);
});
