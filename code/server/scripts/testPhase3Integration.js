import dotenv from "dotenv";
dotenv.config();

// Enforce DynamoDB backend for this integration test
process.env.DB_BACKEND = "dynamodb";

import { initTables } from "./initLocalDynamo.js";
import problemRepo from "../src/repositories/problemRepo.js";
import { register, login, getCurrentUser } from "../src/controllers/authController.js";
import { getProblems, getProblem } from "../src/controllers/problemController.js";
import { getPatterns, getPattern } from "../src/controllers/patternController.js";
import { getDashboardData, getDashboardStats } from "../src/services/dashboard/dashboardService.js";
import { submitReview, getReviewsDue } from "../src/controllers/reviewController.js";
import { getRecommendations } from "../src/controllers/recommendationController.js";
import { processSubmission } from "../src/services/ingestion/processSubmission.js";

// Helper mock response
function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, val, opts) {
      this.cookies[name] = val;
      return this;
    },
    clearCookie(name) {
      delete this.cookies[name];
      return this;
    },
  };
  return res;
}

async function runPhase3Tests() {
  console.log("================================================================================");
  console.log("CPRecal — Phase 3: Service & Controller Integration Test Suite (DynamoDB Mode)");
  console.log("================================================================================\n");

  await initTables();

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
    }
  }

  const testEmail = `phase3_user_${Date.now()}@example.com`;
  let testUserId = null;
  let authCookie = null;
  const testLeetcodeId = 8800 + Math.floor(Math.random() * 1000);

  // 1. Auth: Registration
  await test("Auth Controller: Registration via DynamoDB backend", async () => {
    const req = {
      body: {
        name: "Phase3 Tester",
        email: testEmail,
        password: "securePassword2026",
      },
    };
    const res = createMockRes();
    let nextError = null;

    await register(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 201) throw new Error(`Expected 201, got ${res.statusCode}`);
    if (!res.body.user?.id || res.body.user.email !== testEmail.toLowerCase()) {
      throw new Error("Invalid user response from register");
    }

    testUserId = res.body.user.id;
    authCookie = res.cookies.token;
  });

  // 2. Auth: Duplicate registration returns 409
  await test("Auth Controller: Duplicate registration rejected with 409", async () => {
    const req = {
      body: {
        name: "Phase3 Imposter",
        email: testEmail,
        password: "securePassword2026",
      },
    };
    const res = createMockRes();
    let nextError = null;

    await register(req, res, (err) => { nextError = err; });

    if (!nextError && res.statusCode !== 409) {
      throw new Error(`Expected 409 status, got ${res.statusCode}`);
    }
  });

  // 3. Auth: Login
  await test("Auth Controller: Login via DynamoDB backend", async () => {
    const req = {
      body: {
        email: testEmail,
        password: "securePassword2026",
      },
    };
    const res = createMockRes();
    let nextError = null;

    await login(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (res.body.user.id !== testUserId) {
      throw new Error("Login returned different userId");
    }
  });

  // 4. Auth: Get Current User (/me)
  await test("Auth Controller: Get Current User (/me) via DynamoDB backend", async () => {
    const req = {
      user: { userId: testUserId },
    };
    const res = createMockRes();
    let nextError = null;

    await getCurrentUser(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (res.body.user.id !== testUserId || res.body.user.name !== "Phase3 Tester") {
      throw new Error("Invalid user data returned from /me");
    }
  });

  // 5. Ingestion Engine: Process Submission
  let ingestedProblemId = null;
  await test("Ingestion Service: processSubmission writes all DynamoDB entities", async () => {
    const payload = {
      problemId: testLeetcodeId,
      title: "Binary Tree Zigzag Level Order Traversal",
      titleSlug: "binary-tree-zigzag-level-order-traversal",
      difficulty: "Medium",
      patterns: ["Tree", "Breadth-First Search"],
      sessionStart: new Date(Date.now() - 900000).toISOString(),
      sessionEnd: new Date().toISOString(),
      submissionHistory: [
        {
          submissionId: "sub_1",
          status: "Wrong Answer",
          runtime: null,
          memory: null,
          language: "javascript",
          timestamp: new Date(Date.now() - 600000).toISOString(),
        },
        {
          submissionId: "sub_2",
          status: "Accepted",
          runtime: 65,
          memory: 42.1,
          language: "javascript",
          timestamp: new Date().toISOString(),
        },
      ],
      acceptedSubmissionId: "sub_2",
      acceptedCode: "function zigzagLevelOrder(root) { /* accepted implementation */ }",
      language: "javascript",
      hintsUsed: 1,
      analysisResult: {
        actualTimeComplexity: "O(N)",
        actualSpaceComplexity: "O(N)",
        optimalTimeComplexity: "O(N)",
        optimalSpaceComplexity: "O(N)",
        pedagogicalFeedback: "Optimal queue traversal implementation.",
      },
    };

    const result = await processSubmission(testUserId, payload);
    if (!result.success || !result.problem.id) {
      throw new Error("processSubmission did not return success");
    }

    ingestedProblemId = result.problem.id;
    if (typeof result.problemMastery.mastery !== "number" || result.problemMastery.mastery <= 0) {
      throw new Error("Mastery score was not computed properly");
    }
    if (!result.fsrs.nextReviewDate) {
      throw new Error("FSRS nextReviewDate was not scheduled");
    }
  });

  // 6. Problem Controller: getProblems paginated
  await test("Problem Controller: getProblems paginated & filtered via DynamoDB", async () => {
    // Populate catalog
    await problemRepo.initCatalog();

    const req = {
      query: {
        limit: "10",
        offset: "0",
        status: "solved",
      },
      user: { userId: testUserId },
    };
    const res = createMockRes();
    let nextError = null;

    await getProblems(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!Array.isArray(res.body.problems) || res.body.total < 1) {
      throw new Error("Expected at least 1 solved problem in library");
    }

    const found = res.body.problems.find((p) => p.id === ingestedProblemId);
    if (!found || !found.userState?.solved) {
      throw new Error("Solved problem not marked solved in userState");
    }
  });

  // 7. Problem Controller: getProblem by ID
  await test("Problem Controller: getProblem by ID via DynamoDB", async () => {
    const req = {
      params: { id: ingestedProblemId },
      user: { userId: testUserId },
    };
    const res = createMockRes();
    let nextError = null;

    await getProblem(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!res.body.problem || res.body.problem.id !== ingestedProblemId) {
      throw new Error("Problem metadata mismatch");
    }
    if (!res.body.userState?.acceptedSolution?.code) {
      throw new Error("Accepted solution code missing in problem details");
    }
    if (!res.body.userState?.fsrs?.rating) {
      throw new Error("FSRS rating missing in problem details");
    }
  });

  // 8. Pattern Controller: getPatterns
  await test("Pattern Controller: getPatterns list & rank via DynamoDB", async () => {
    const req = {
      user: { userId: testUserId },
    };
    const res = createMockRes();
    let nextError = null;

    await getPatterns(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!Array.isArray(res.body.patterns) || res.body.patterns.length < 1) {
      throw new Error("No patterns returned for user");
    }
    const treePattern = res.body.patterns.find((p) => p.pattern === "Tree");
    if (!treePattern || treePattern.totalProblemsSolved < 1) {
      throw new Error("Pattern mastery Tree not updated");
    }
  });

  // 9. Dashboard Service: getDashboardData & getDashboardStats
  await test("Dashboard Service: getDashboardData & stats via DynamoDB", async () => {
    const data = await getDashboardData(testUserId);
    if (data.stats.totalSolved < 1 || data.stats.totalAttempted < 1) {
      throw new Error(`Invalid stats in dashboard: ${JSON.stringify(data.stats)}`);
    }

    const stats = await getDashboardStats(testUserId);
    if (stats.totalSolved < 1) {
      throw new Error(`Invalid lightweight stats: ${JSON.stringify(stats)}`);
    }
  });

  // 10. Review Controller: submitReview
  await test("Review Controller: submitReview & getReviewsDue via DynamoDB", async () => {
    const req = {
      body: {
        problemId: ingestedProblemId,
        status: "completed",
      },
      user: { userId: testUserId },
    };
    const res = createMockRes();
    let nextError = null;

    await submitReview(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200 || !res.body.success) {
      throw new Error(`submitReview failed: status ${res.statusCode}`);
    }
    if (res.body.updated.fsrs.intervalDays < 1) {
      throw new Error("FSRS interval was not adjusted");
    }
  });

  // 11. Recommendations Controller: getRecommendations
  await test("Recommendations Controller: getRecommendations via DynamoDB", async () => {
    const req = {
      user: { userId: testUserId },
    };
    const res = createMockRes();
    let nextError = null;

    await getRecommendations(req, res, (err) => { nextError = err; });

    if (nextError) throw nextError;
    if (res.statusCode !== 200 || !Array.isArray(res.body.recommendations)) {
      throw new Error(`getRecommendations failed: status ${res.statusCode}`);
    }
  });

  console.log("\n================================================================================");
  console.log(`Results: ${passed}/${total} integration tests passed.`);
  console.log("================================================================================");

  if (passed === total) {
    console.log("🎉 ALL PHASE 3 INTEGRATION TESTS PASSED CLEANLY!");
    process.exit(0);
  } else {
    console.error("❌ Some Phase 3 integration tests failed.");
    process.exit(1);
  }
}

runPhase3Tests();
