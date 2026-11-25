import dotenv from "dotenv";
dotenv.config();

process.env.DB_BACKEND = "dynamodb";

import http from "http";
import app from "../src/app.js";
import { initTables } from "./initLocalDynamo.js";
import problemRepo from "../src/repositories/problemRepo.js";
import problemMasteryRepo from "../src/repositories/problemMasteryRepo.js";
import acceptedSolutionRepo from "../src/repositories/acceptedSolutionRepo.js";
import progressResetRepo from "../src/repositories/progressResetRepo.js";
import fsrsStateRepo from "../src/repositories/fsrsStateRepo.js";
import patternMasteryRepo from "../src/repositories/patternMasteryRepo.js";

async function runProductionEndToEndTest() {
  console.log("================================================================================");
  console.log("CPRecal — Production-Like End-to-End Question Library Reset & Concurrency Suite");
  console.log("================================================================================\n");

  await initTables();

  // 1. Seed a 10-question reference catalog
  console.log("Populating 10-question problem catalog across diverse patterns...");
  const sampleProblems = [
    { problemId: "p101", leetcodeId: 101, title: "Two Sum", titleSlug: "two-sum", difficulty: "Easy", patterns: ["Two Pointers", "Hashing"] },
    { problemId: "p102", leetcodeId: 102, title: "3Sum", titleSlug: "3sum", difficulty: "Medium", patterns: ["Two Pointers"] },
    { problemId: "p103", leetcodeId: 103, title: "Trapping Rain Water", titleSlug: "trapping-rain-water", difficulty: "Hard", patterns: ["Two Pointers"] },
    { problemId: "p104", leetcodeId: 104, title: "Climbing Stairs", titleSlug: "climbing-stairs", difficulty: "Easy", patterns: ["Dynamic Programming"] },
    { problemId: "p105", leetcodeId: 105, title: "Coin Change", titleSlug: "coin-change", difficulty: "Medium", patterns: ["Dynamic Programming"] },
    { problemId: "p106", leetcodeId: 106, title: "Longest Increasing Subsequence", titleSlug: "longest-increasing-subsequence", difficulty: "Medium", patterns: ["Dynamic Programming", "Binary Search"] },
    { problemId: "p107", leetcodeId: 107, title: "Binary Search", titleSlug: "binary-search", difficulty: "Easy", patterns: ["Binary Search"] },
    { problemId: "p108", leetcodeId: 108, title: "Search in Rotated Sorted Array", titleSlug: "search-in-rotated-sorted-array", difficulty: "Medium", patterns: ["Binary Search"] },
    { problemId: "p109", leetcodeId: 109, title: "Maximum Subarray", titleSlug: "maximum-subarray", difficulty: "Medium", patterns: ["Arrays"] },
    { problemId: "p110", leetcodeId: 110, title: "Invert Binary Tree", titleSlug: "invert-binary-tree", difficulty: "Easy", patterns: ["Trees"] },
  ];

  await problemRepo.bulkUpsertProblems(sampleProblems);
  const totalCatalogProblems = await problemRepo.getTotalProblemsCount();
  console.log(`Problem catalog active: ${totalCatalogProblems} reference questions available.\n`);

  // 2. Start HTTP server on an ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Live HTTP API server listening on ${baseUrl}\n`);

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

  // Helper for authenticated HTTP requests
  async function makeRequest(path, method = "GET", body = null, cookie = null) {
    const headers = { "Content-Type": "application/json" };
    if (cookie) headers["Cookie"] = cookie;

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const setCookie = res.headers.get("set-cookie");
    const cookieToken = setCookie ? setCookie.split(";")[0] : null;
    let json = null;
    try {
      json = await res.json();
    } catch {}

    return { status: res.status, headers: res.headers, cookie: cookieToken, data: json };
  }

  const timestamp = Date.now();
  const emailAlpha = `user_alpha_${timestamp}@cprecall.io`;
  const emailBeta = `user_beta_${timestamp}@cprecall.io`;
  const password = "StrongPassword2026!";

  let cookieAlpha = null;
  let userAlphaId = null;
  let cookieBeta = null;
  let userBetaId = null;

  // 1. Register Account Alpha and Account Beta
  await test("User registration: registers Account Alpha and Account Beta with distinct sessions", async () => {
    // Alpha
    const resA = await makeRequest("/api/auth/register", "POST", {
      name: "User Alpha",
      email: emailAlpha,
      password,
    });
    if (resA.status !== 201) throw new Error(`Register Alpha failed with status ${resA.status}: ${JSON.stringify(resA.data)}`);
    cookieAlpha = resA.cookie;
    userAlphaId = resA.data?.user?.id || resA.data?.user?.userId || resA.data?.user?._id;

    // Beta
    const resB = await makeRequest("/api/auth/register", "POST", {
      name: "User Beta",
      email: emailBeta,
      password,
    });
    if (resB.status !== 201) throw new Error(`Register Beta failed with status ${resB.status}: ${JSON.stringify(resB.data)}`);
    cookieBeta = resB.cookie;
    userBetaId = resB.data?.user?.id || resB.data?.user?.userId || resB.data?.user?._id;

    if (!userAlphaId || !userBetaId) throw new Error("Missing user IDs from registration response");
  });

  // 2. Account Alpha completes every question (10/10), Account Beta solves 3/10
  await test("Problem solving: Alpha completes library (10/10), Beta completes 3/10", async () => {
    // Alpha solves all 10 problems
    for (const p of sampleProblems) {
      await problemMasteryRepo.saveProblemMastery(userAlphaId, p.problemId, {
        mastery: 85,
        components: { solutionEfficiency: 90, timeComplexity: 85, submissionsUntilSuccess: 80, firstAttemptSuccess: 85, spaceComplexity: 85 },
      });
      await fsrsStateRepo.saveFSRSState(userAlphaId, p.problemId, {
        stability: 2.5,
        difficulty: 4.0,
        nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
        reps: 1,
      });
      // Store raw historical accepted solution
      await acceptedSolutionRepo.saveAcceptedSolution(userAlphaId, p.problemId, {
        code: `// Solution for ${p.title}\nfunction solve() { return true; }`,
        language: "javascript",
        executionTimeMs: 45,
        memoryKb: 2048,
      });
    }

    // Alpha pattern aggregation
    for (const pat of ["Two Pointers", "Dynamic Programming", "Binary Search", "Arrays", "Trees"]) {
      await patternMasteryRepo.updatePatternMastery(userAlphaId, pat);
    }

    // Beta solves only 3 problems (p101, p102, p103)
    for (const p of sampleProblems.slice(0, 3)) {
      await problemMasteryRepo.saveProblemMastery(userBetaId, p.problemId, {
        mastery: 75,
        components: { solutionEfficiency: 75, timeComplexity: 75, submissionsUntilSuccess: 75, firstAttemptSuccess: 75, spaceComplexity: 75 },
      });
      await fsrsStateRepo.saveFSRSState(userBetaId, p.problemId, {
        stability: 2.0,
        difficulty: 4.5,
        nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
        reps: 1,
      });
      await acceptedSolutionRepo.saveAcceptedSolution(userBetaId, p.problemId, {
        code: `// Beta solution for ${p.title}`,
        language: "javascript",
        executionTimeMs: 50,
        memoryKb: 1024,
      });
    }
  });

  // 3. Verify Alpha's completion detection on dashboard
  await test("Completion detection: Alpha dashboard reports isLibraryCompleted = true", async () => {
    const res = await makeRequest("/api/dashboard", "GET", null, cookieAlpha);
    if (res.status !== 200) throw new Error(`Dashboard returned status ${res.status}`);

    const stats = res.data?.stats;
    if (stats.totalSolved !== totalCatalogProblems) {
      throw new Error(`Expected Alpha totalSolved ${totalCatalogProblems}, got ${stats.totalSolved}`);
    }
    if (stats.isLibraryCompleted !== true) {
      throw new Error("Expected isLibraryCompleted to be true for Alpha");
    }
    if (stats.completionPromptDismissed !== false) {
      throw new Error("Expected completionPromptDismissed to be false initially");
    }
  });

  // 4. Verify Beta's partial state on dashboard
  await test("Isolation check: Beta dashboard reports partial solve (3/10) and isLibraryCompleted = false", async () => {
    const res = await makeRequest("/api/dashboard", "GET", null, cookieBeta);
    if (res.status !== 200) throw new Error(`Beta dashboard returned status ${res.status}`);

    const stats = res.data?.stats;
    if (stats.totalSolved !== 3) {
      throw new Error(`Expected Beta totalSolved to be 3, got ${stats.totalSolved}`);
    }
    if (stats.isLibraryCompleted !== false) {
      throw new Error("Expected isLibraryCompleted to be false for Beta");
    }
  });

  // 5. User Alpha clicks "Keep My Progress" (dismissal)
  await test("Dismissal: Alpha dismisses prompt and dashboard suppresses prompt for current cycle", async () => {
    const dismissRes = await makeRequest("/api/progress/dismiss-completion", "POST", {}, cookieAlpha);
    if (dismissRes.status !== 200 || !dismissRes.data?.success) {
      throw new Error(`Dismiss completion failed: ${JSON.stringify(dismissRes.data)}`);
    }

    const dashRes = await makeRequest("/api/dashboard", "GET", null, cookieAlpha);
    const stats = dashRes.data?.stats;
    if (stats.isLibraryCompleted !== true) {
      throw new Error("isLibraryCompleted must remain true after dismissal");
    }
    if (stats.completionPromptDismissed !== true) {
      throw new Error("completionPromptDismissed must be true after dismissal for current cycle");
    }
  });

  // 6. Lock Recovery under Real Time Delay (Worker pause > lease duration)
  await test("Real-delay lock recovery: Worker 1 pauses > lease duration, Worker 2 recovers, Worker 1 is rejected", async () => {
    const realLeaseMs = 800; // 800ms real delay lease
    const userStallId = "user_stall_" + Date.now();

    // Worker 1 acquires lock
    const worker1 = await progressResetRepo.acquireResetLock(userStallId, realLeaseMs);
    const worker1Token = worker1.resetToken;

    // Simulate real execution stall / pause exceeding the 800ms lease
    await new Promise((resolve) => setTimeout(resolve, 950));

    // Worker 2 recovers the expired lock
    const worker2 = await progressResetRepo.acquireResetLock(userStallId, realLeaseMs);
    const worker2Token = worker2.resetToken;
    if (worker2Token === worker1Token) {
      throw new Error("Worker 2 should have received a new distinct reset token");
    }

    // Worker 1 wakes up and attempts destructive batch delete using worker1Token -> must be REJECTED
    try {
      await progressResetRepo.batchDeleteKeys(
        "CPRecal_UserProblemData",
        [{ PK: `USER#${userStallId}`, SK: "MASTERY#p101" }],
        { userId: userStallId, resetToken: worker1Token }
      );
      throw new Error("Worker 1 should have been rejected by lock validation");
    } catch (err) {
      if (err.code !== "LOCK_SUPERSEDED" && err.name !== "ConditionalCheckFailedException") {
        throw err;
      }
    }

    // Worker 1 attempts to finalize success -> must be REJECTED
    try {
      await progressResetRepo.finalizeResetSuccess(userStallId, worker1Token);
      throw new Error("Worker 1 should not be able to finalize with superseded token");
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") {
        throw err;
      }
    }

    // Worker 2 releases / completes cleanly
    await progressResetRepo.finalizeResetSuccess(userStallId, worker2Token);
  });

  // 7. Full Production Reset Execution for Alpha via HTTP API
  await test("Production reset: POST /api/progress/reset successfully executes end-to-end", async () => {
    const resetRes = await makeRequest("/api/progress/reset", "POST", {}, cookieAlpha);
    if (resetRes.status !== 200 || !resetRes.data?.success) {
      throw new Error(`Reset API failed with status ${resetRes.status}: ${JSON.stringify(resetRes.data)}`);
    }
    if (!resetRes.data?.resetVersion || resetRes.data.resetVersion < 1) {
      throw new Error(`Expected resetVersion >= 1, got ${resetRes.data?.resetVersion}`);
    }
  });

  // 8. Verify Alpha's post-reset state via API
  await test("Post-reset verification: Alpha dashboard and all library questions are completely reset", async () => {
    // 8a. Dashboard
    const dashRes = await makeRequest("/api/dashboard", "GET", null, cookieAlpha);
    const stats = dashRes.data?.stats;
    if (stats.totalSolved !== 0) {
      throw new Error(`Expected Alpha totalSolved = 0 after reset, got ${stats.totalSolved}`);
    }
    if (stats.averageMastery !== 0) {
      throw new Error(`Expected Alpha averageMastery = 0 after reset, got ${stats.averageMastery}`);
    }
    if (stats.isLibraryCompleted !== false) {
      throw new Error("Expected isLibraryCompleted to be false for Alpha after reset");
    }

    // 8b. Problem Library API
    const probRes = await makeRequest("/api/problems?limit=50", "GET", null, cookieAlpha);
    const problems = probRes.data?.problems || [];
    if (problems.length === 0) throw new Error("Expected problem library to return problems");

    for (const p of problems) {
      if (p.userState.solved !== false) {
        throw new Error(`Problem ${p.title} still marked as solved: true!`);
      }
      if (p.userState.mastery !== null) {
        throw new Error(`Problem ${p.title} still has mastery: ${p.userState.mastery}`);
      }
    }
  });

  // 9. Historical Data Integrity: Retained solutions must exist and NOT recreate mastery
  await test("Historical data integrity: Alpha raw solutions remain and do NOT resurrect mastery", async () => {
    // Raw solution for p101 must exist
    const rawSolution = await acceptedSolutionRepo.getAcceptedSolution(userAlphaId, "p101");
    if (!rawSolution || !rawSolution.code) {
      throw new Error("Expected historical accepted solution to be preserved, but it was lost!");
    }

    // Mastery record must be completely gone
    const masteryRecord = await problemMasteryRepo.getProblemMastery(userAlphaId, "p101");
    if (masteryRecord !== null) {
      throw new Error("Mastery record was resurrected!");
    }
  });

  // 10. Multi-Tenant Isolation: Account Beta must be 100% UNTOUCHED
  await test("Multi-tenant isolation: Beta remains completely untouched with 3 solved problems intact", async () => {
    // Dashboard
    const dashRes = await makeRequest("/api/dashboard", "GET", null, cookieBeta);
    const stats = dashRes.data?.stats;
    if (stats.totalSolved !== 3) {
      throw new Error(`Beta totalSolved was modified! Expected 3, got ${stats.totalSolved}`);
    }

    // Problems
    const probRes = await makeRequest("/api/problems?limit=50", "GET", null, cookieBeta);
    const problems = probRes.data?.problems || [];
    const betaSolvedCount = problems.filter((p) => p.userState.solved === true).length;
    if (betaSolvedCount !== 3) {
      throw new Error(`Expected Beta to have 3 solved problems, got ${betaSolvedCount}`);
    }

    // Confirm p101, p102, p103 have mastery: 75
    for (const pId of ["p101", "p102", "p103"]) {
      const mastery = await problemMasteryRepo.getProblemMastery(userBetaId, pId);
      if (!mastery || mastery.mastery !== 75) {
        throw new Error(`Beta problem ${pId} mastery corrupted: ${mastery?.mastery}`);
      }
    }
  });

  console.log("\n================================================================================");
  console.log(`Results: ${passed} / ${total} passed`);
  if (passed === total) {
    console.log("🎉 ALL PRODUCTION-LIKE END-TO-END TESTS PASSED CLEANLY!");
  } else {
    console.error(`⚠️ ${total - passed} tests failed!`);
    server.close();
    process.exit(1);
  }

  server.close();
}

runProductionEndToEndTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
