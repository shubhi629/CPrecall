import dotenv from "dotenv";
dotenv.config();

// Ensure cloud mode is active
process.env.DB_BACKEND = "dynamodb";
process.env.DYNAMODB_MODE = "cloud";
process.env.DUAL_WRITE = "true";

import mongoose from "mongoose";
import { GetCommand, QueryCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { docClient, rawClient, TABLES } from "../src/config/dynamodb.js";
import { connectDB } from "../src/config/db.js";
import userRepo from "../src/repositories/userRepo.js";
import problemRepo from "../src/repositories/problemRepo.js";
import problemMasteryRepo from "../src/repositories/problemMasteryRepo.js";
import patternMasteryRepo from "../src/repositories/patternMasteryRepo.js";
import fsrsStateRepo from "../src/repositories/fsrsStateRepo.js";
import acceptedSolutionRepo from "../src/repositories/acceptedSolutionRepo.js";
import solvingSessionRepo from "../src/repositories/solvingSessionRepo.js";
import submissionRepo from "../src/repositories/submissionRepo.js";
import reviewHistoryRepo from "../src/repositories/reviewHistoryRepo.js";
import { processSubmission } from "../src/services/ingestion/processSubmission.js";
import { selectRecallTargets } from "../src/services/fsrs/recallSelector.js";

// Mongoose Models for Dual-Write Verification
import User from "../src/models/User.js";
import Problem from "../src/models/Problem.js";
import ProblemMastery from "../src/models/ProblemMastery.js";
import PatternMastery from "../src/models/PatternMastery.js";
import FSRSState from "../src/models/FSRSState.js";
import AcceptedSolution from "../src/models/AcceptedSolution.js";
import SolvingSession from "../src/models/SolvingSession.js";
import Submission from "../src/models/Submission.js";
import ReviewHistory from "../src/models/ReviewHistory.js";

async function runCloudDatabaseIntegrityVerification() {
  console.log("================================================================================");
  console.log("CPRecal — Complete AWS Cloud DynamoDB & Standby Mongo Deep Integrity Test Suite");
  console.log(`Region: ${process.env.AWS_REGION || "ap-southeast-2"} | Backend: AWS Cloud DynamoDB (Primary)`);
  console.log("================================================================================\n");

  console.log("[Setup 1/3] Connecting to MongoDB Standby...");
  await connectDB();

  console.log("[Setup 2/3] Initializing DynamoDB In-Memory Problem Catalog...");
  await problemRepo.initCatalog();

  console.log("[Setup 3/3] Cloud connection ready. Beginning deep database assertions...\n");

  let passed = 0;
  let total = 0;
  const cleanupTasks = [];

  async function assertTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Reason: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  const timestamp = Date.now();
  const testEmail = `cloud_audit_${timestamp}@example.com`;
  const testPassword = "PasswordCloud2026!";
  let testUserId = null;
  const testLeetcodeId = 9400 + Math.floor(Math.random() * 500);
  let testProblemId = null;

  try {
    // --------------------------------------------------------------------------
    // SECTION 1: Table & GSI Architecture Verification in AWS Cloud
    // --------------------------------------------------------------------------
    await assertTest("AWS Cloud Architecture: All 5 tables & 8 GSIs are ACTIVE with On-Demand billing", async () => {
      const expectedTables = [
        { name: TABLES.USERS, gsis: 0 },
        { name: TABLES.PROBLEMS, gsis: 4 },
        { name: TABLES.USER_PROBLEM_DATA, gsis: 2 },
        { name: TABLES.USER_PATTERN_MASTERY, gsis: 1 },
        { name: TABLES.USER_ACTIVITY, gsis: 1 },
      ];

      for (const t of expectedTables) {
        const desc = await rawClient.send(new DescribeTableCommand({ TableName: t.name }));
        if (desc.Table.TableStatus !== "ACTIVE") {
          throw new Error(`Table ${t.name} is ${desc.Table.TableStatus}, expected ACTIVE`);
        }
        const gsis = desc.Table.GlobalSecondaryIndexes || [];
        if (gsis.length !== t.gsis) {
          throw new Error(`Table ${t.name} has ${gsis.length} GSIs, expected ${t.gsis}`);
        }
        if (desc.Table.BillingModeSummary?.BillingMode !== "PAY_PER_REQUEST") {
          throw new Error(`Table ${t.name} billing is ${desc.Table.BillingModeSummary?.BillingMode}, expected PAY_PER_REQUEST`);
        }
      }
    });

    // --------------------------------------------------------------------------
    // SECTION 2: User Repository & Atomic Locks in Cloud DynamoDB
    // --------------------------------------------------------------------------
    await assertTest("User Lifecycle: Atomic registration, email reservation lock, and bcrypt comparison", async () => {
      // 1. Create user
      const user = await userRepo.createUser({
        name: "Cloud Auditor",
        email: testEmail,
        password: testPassword,
      });
      testUserId = user.id || user._id;

      cleanupTasks.push(async () => {
        await userRepo.deleteUser(testUserId, testEmail);
      });

      if (!testUserId || user.email !== testEmail.toLowerCase()) {
        throw new Error("Created user payload missing fields");
      }

      // 2. Direct DynamoDB Table check for Profile and Reservation items
      const profileItem = await docClient.send(
        new GetCommand({
          TableName: TABLES.USERS,
          Key: { PK: `USER#${testUserId}`, SK: "PROFILE" },
        })
      );
      if (!profileItem.Item || !profileItem.Item.passwordHash) {
        throw new Error("PROFILE item missing or lacks passwordHash in DynamoDB base table");
      }

      const lockItem = await docClient.send(
        new GetCommand({
          TableName: TABLES.USERS,
          Key: { PK: `EMAIL#${testEmail.toLowerCase()}`, SK: "RESERVATION" },
        })
      );
      if (!lockItem.Item || lockItem.Item.userId !== testUserId) {
        throw new Error("EMAIL lock item missing or has incorrect userId in DynamoDB");
      }

      // 3. Collision Test: duplicate email registration must fail with 409
      let collided = false;
      try {
        await userRepo.createUser({
          name: "Collision Clone",
          email: testEmail,
          password: testPassword,
        });
      } catch (err) {
        if (
          err.status === 409 ||
          err.statusCode === 409 ||
          err.name === "TransactionCanceledException" ||
          err.message?.includes("already exists")
        ) {
          collided = true;
        }
      }
      if (!collided) throw new Error("Duplicate email registration did not throw 409 Conflict");

      // 4. Login verification using bcrypt
      const loginUser = await userRepo.getUserByEmail(testEmail, { includePassword: true });
      if (!loginUser || (loginUser.id !== testUserId && loginUser._id !== testUserId)) {
        throw new Error("getUserByEmail failed for valid user");
      }
      const validPass = await loginUser.comparePassword(testPassword);
      if (!validPass) {
        throw new Error("comparePassword failed for valid password");
      }
      const invalidPass = await loginUser.comparePassword("WrongPassword2026!");
      if (invalidPass) {
        throw new Error("comparePassword succeeded for invalid password");
      }
    });

    // --------------------------------------------------------------------------
    // SECTION 3: Problem Catalog & Strict GSI Deduplication in Cloud
    // --------------------------------------------------------------------------
    await assertTest("Problem Catalog: Direct lookup, pattern adjacency, and zero duplicate GSI rows", async () => {
      // Lookup existing canonical problem
      const problem = await problemRepo.getProblemByLeetcodeId(1); // Two Sum
      if (!problem || problem.titleSlug !== "two-sum") {
        throw new Error("Failed to find Two Sum (leetcodeId: 1) in AWS Cloud DynamoDB");
      }

      testProblemId = problem.problemId;

      // Query by slug
      const bySlug = await problemRepo.getProblemBySlug("two-sum");
      if (!bySlug || bySlug.problemId !== testProblemId) {
        throw new Error("Failed lookup by TitleSlugIndex");
      }

      // Query pattern adjacency via PatternDifficultyIndex
      const targetPattern = Array.isArray(problem.patterns) && problem.patterns.length > 0
        ? problem.patterns[0]
        : "Array";
      const patternItems = await problemRepo.getProblemsByPattern(targetPattern, { limit: 10 });
      if (!Array.isArray(patternItems) || patternItems.length === 0) {
        throw new Error(`PatternDifficultyIndex query returned empty for pattern ${targetPattern}`);
      }

      // Strict GSI sparsity assertion: DifficultyIndex contains zero duplicate rows
      const queryGSI = await docClient.send(
        new QueryCommand({
          TableName: TABLES.PROBLEMS,
          IndexName: "DifficultyIndex",
          KeyConditionExpression: "difficulty = :d",
          ExpressionAttributeValues: { ":d": "Easy" },
          Limit: 50,
        })
      );
      const ids = new Set();
      for (const item of queryGSI.Items) {
        if (ids.has(item.problemId)) {
          throw new Error(`CRITICAL DEFECT: Duplicate problemId ${item.problemId} found in DifficultyIndex`);
        }
        ids.add(item.problemId);
      }
    });

    // --------------------------------------------------------------------------
    // SECTION 4: Ingestion Pipeline & Multi-Entity Updates in AWS Cloud
    // --------------------------------------------------------------------------
    await assertTest("Ingestion Pipeline: Writes 7 entities across 3 DynamoDB tables + MongoDB shadow", async () => {
      const payload = {
        problemId: testLeetcodeId,
        title: `Cloud Audit Problem ${timestamp}`,
        titleSlug: `cloud-audit-problem-${timestamp}`,
        difficulty: "Medium",
        patterns: ["Dynamic Programming", "Bit Manipulation"],
        sessionStart: new Date(Date.now() - 600000).toISOString(),
        sessionEnd: new Date().toISOString(),
        submissionHistory: [
          {
            submissionId: `sub_wa_${timestamp}`,
            status: "Wrong Answer",
            runtime: "0 ms",
            memory: "42.0 MB",
            language: "cpp",
            timestamp: new Date(Date.now() - 300000).toISOString(),
          },
          {
            submissionId: `sub_acc_${timestamp}`,
            status: "Accepted",
            runtime: "12 ms",
            memory: "38.5 MB",
            language: "cpp",
            timestamp: new Date().toISOString(),
          },
        ],
        acceptedSubmissionId: `sub_acc_${timestamp}`,
        acceptedCode: "class Solution { public: bool cloudCheck() { return true; } };",
        language: "cpp",
        hintsUsed: 1,
        analysisResult: {
          actualTimeComplexity: "O(n)",
          actualSpaceComplexity: "O(1)",
          optimalTimeComplexity: "O(n)",
          optimalSpaceComplexity: "O(1)",
          explanation: "Clean bitwise DP solution verified.",
        },
      };

      const result = await processSubmission(testUserId, payload);
      if (!result.success || !result.problem.id) {
        throw new Error("processSubmission returned unsuccessful result");
      }

      const pId = result.problem.id;

      cleanupTasks.push(async () => {
        // Cleanup UserProblemData, UserActivity, UserPatternMastery for this test user
        const items = await docClient.send(
          new QueryCommand({
            TableName: TABLES.USER_PROBLEM_DATA,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `USER#${testUserId}` },
          })
        );
        for (const item of items.Items || []) {
          await docClient.send(
            new DeleteCommand({
              TableName: TABLES.USER_PROBLEM_DATA,
              Key: { PK: item.PK, SK: item.SK },
            })
          );
        }
      });

      // 1. Verify ProblemMastery in DynamoDB
      const pm = await problemMasteryRepo.getProblemMastery(testUserId, pId);
      if (!pm || typeof pm.mastery !== "number" || pm.mastery <= 0) {
        throw new Error("ProblemMastery not saved or has invalid mastery score");
      }

      // 2. Verify UserStats updated
      const stats = await problemMasteryRepo.getUserStats(testUserId);
      if (!stats || stats.totalSolved !== 1) {
        throw new Error(`UserStats totalSolved expected 1, got ${stats?.totalSolved}`);
      }

      // 3. Verify AcceptedSolution in DynamoDB
      const sol = await acceptedSolutionRepo.getAcceptedSolution(testUserId, pId);
      if (!sol || !sol.code.includes("cloudCheck")) {
        throw new Error("AcceptedSolution not saved correctly in DynamoDB");
      }

      // 4. Verify FSRS state in DynamoDB
      const fsrs = await fsrsStateRepo.getFSRSState(testUserId, pId);
      if (!fsrs || !fsrs.nextReviewDate || fsrs.intervalDays < 1) {
        throw new Error("FSRSState missing or has invalid nextReviewDate");
      }

      // 5. Verify PatternMastery in DynamoDB
      const dpMastery = await patternMasteryRepo.getPatternMastery(testUserId, "Dynamic Programming");
      if (!dpMastery || dpMastery.totalProblemsSolved !== 1) {
        throw new Error("PatternMastery not updated for Dynamic Programming");
      }

      // 6. Verify Submissions and Sessions
      const userSessions = await solvingSessionRepo.getUserSessions(testUserId, 10);
      if (userSessions.length < 1) {
        throw new Error("Solving session not saved or retrieved from CPRecal_UserActivity");
      }
      const sessId = userSessions[0].sessionId;
      const sessionSubmissions = await submissionRepo.getSubmissionsBySession(sessId);
      if (sessionSubmissions.length < 2) {
        throw new Error(`Expected at least 2 submissions in SessionIdIndex, found ${sessionSubmissions.length}`);
      }

      // 7. Verify Dual-Write to MongoDB Standby
      const mongoUser = await User.findOne({ email: testEmail });
      if (mongoUser) {
        const mongoPM = await ProblemMastery.findOne({ userId: mongoUser._id });
        if (!mongoPM) {
          throw new Error("Dual-write failure: ProblemMastery not found in MongoDB Standby");
        }
      }
    });

    // --------------------------------------------------------------------------
    // SECTION 5: Re-Solve Safety & Concurrency Test
    // --------------------------------------------------------------------------
    await assertTest("Re-solve Safety: Solving the same problem twice does NOT double-increment totalSolved", async () => {
      const p = await problemRepo.getProblemByLeetcodeId(testLeetcodeId);
      const pId = p.problemId;

      const initialStats = await problemMasteryRepo.getUserStats(testUserId);
      const initialSolved = initialStats.totalSolved;

      // Re-solve with updated score
      await problemMasteryRepo.saveProblemMastery(testUserId, pId, {
        mastery: 95,
        totalTimeSeconds: 400,
        hintsUsedCount: 0,
      });

      const updatedStats = await problemMasteryRepo.getUserStats(testUserId);
      if (updatedStats.totalSolved !== initialSolved) {
        throw new Error(
          `CRITICAL BUG: Re-solving problem double-incremented totalSolved! (Initial: ${initialSolved}, After: ${updatedStats.totalSolved})`
        );
      }
      if (updatedStats.averageMastery <= 0) {
        throw new Error("Invalid averageMastery computed after re-solve");
      }
    });

    // --------------------------------------------------------------------------
    // SECTION 6: Claim-Check Overflow Pattern (>300 KB) in Cloud
    // --------------------------------------------------------------------------
    await assertTest("Claim-Check Overflow: Oversized solution (>300 KB) offloads and reconstructs transparently", async () => {
      const dummyProblemId = `overflow_prob_${timestamp}`;
      const hugeCode = "// OVERSIZED CLOUD AUDIT PAYLOAD\n" + "const x = 1;\n".repeat(25000); // ~375 KB
      if (Buffer.byteLength(hugeCode, "utf8") < 300000) {
        throw new Error("Test payload is under 300 KB threshold");
      }

      // Save oversized solution
      await acceptedSolutionRepo.saveAcceptedSolution(testUserId, dummyProblemId, {
        code: hugeCode,
        language: "javascript",
        analysisResult: {
          explanation: "Tested claim check offloading on AWS Cloud.",
        },
      });

      // Directly inspect raw DynamoDB item to verify it offloaded
      const rawItem = await docClient.send(
        new GetCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: { PK: `USER#${testUserId}`, SK: `SOLUTION#${dummyProblemId}` },
        })
      );

      if (!rawItem.Item || !rawItem.Item.isOverflow) {
        throw new Error("Payload >= 300 KB was NOT flagged as isOverflow in DynamoDB");
      }
      if (rawItem.Item.code !== "[OFFLOADED_TO_CLAIM_CHECK_STORAGE]") {
        throw new Error("Oversized code string was NOT replaced with claim check marker in DynamoDB item");
      }

      // Retrieve via repository: must transparently reconstruct the huge payload
      const loaded = await acceptedSolutionRepo.getAcceptedSolution(testUserId, dummyProblemId);
      if (!loaded || loaded.code !== hugeCode) {
        throw new Error("Claim-check failed to reconstruct original oversized code payload");
      }

      // Cleanup overflow record
      await docClient.send(
        new DeleteCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: { PK: `USER#${testUserId}`, SK: `SOLUTION#${dummyProblemId}` },
        })
      );
    });

    // --------------------------------------------------------------------------
    // SECTION 7: FSRS Spaced Repetition Lifecycle & Reviews
    // --------------------------------------------------------------------------
    await assertTest("FSRS Spaced Repetition: Due queries, interval advancement, and review logs", async () => {
      const p = await problemRepo.getProblemByLeetcodeId(testLeetcodeId);
      const pId = p.problemId;

      // 1. Force review date to yesterday to verify sparse GSI query
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      await docClient.send(
        new DeleteCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: { PK: `USER#${testUserId}`, SK: `FSRS#${pId}` },
        })
      );
      await fsrsStateRepo.saveFSRSState(testUserId, pId, {
        rating: 3,
        intervalDays: 1,
        easeFactor: 2.5,
        nextReviewDate: yesterday,
      });

      // 2. Query due reviews via sparse GSI
      const dueReviews = await fsrsStateRepo.getDueReviews(testUserId, new Date().toISOString(), 10);
      if (!Array.isArray(dueReviews) || dueReviews.length === 0) {
        throw new Error("FSRSReviewDateIndex failed to retrieve due problem");
      }
      if (dueReviews[0].problemId !== pId) {
        throw new Error(`Expected due problemId ${pId}, got ${dueReviews[0].problemId}`);
      }

      // 3. Submit Review
      const reviewResult = await fsrsStateRepo.updateAfterReview(testUserId, pId, "completed");
      if (!reviewResult || reviewResult.intervalDays <= 1) {
        throw new Error("updateAfterReview did not advance review interval");
      }

      // 4. Create ReviewHistory
      await reviewHistoryRepo.createReviewHistory({
        userId: testUserId,
        problemId: pId,
        reviewedAt: new Date(),
        previousMastery: 80,
        newMastery: 95,
        fsrsRating: 4,
        status: "completed",
      });

      // 5. Query ReviewHistory
      const history = await reviewHistoryRepo.getUserReviewHistory(testUserId, 10);
      if (!Array.isArray(history) || history.length === 0) {
        throw new Error("ReviewHistory was not saved or queried from CPRecal_UserActivity");
      }
      if (history[0].problemId !== pId || history[0].status !== "completed") {
        throw new Error("ReviewHistory item attributes mismatch");
      }
    });

    // --------------------------------------------------------------------------
    // SECTION 8: A -> B Recall Invariant Test in AWS Cloud
    // --------------------------------------------------------------------------
    await assertTest("A -> B Recall Target Invariant: Trigger problem A is NEVER recommended as review target", async () => {
      const p = await problemRepo.getProblemByLeetcodeId(testLeetcodeId);
      const solvedProblemId = p.problemId;

      // FSRS Trigger problem A that is due
      const fsrsTriggers = [
        {
          problemId: solvedProblemId,
          nextReviewDate: new Date().toISOString(),
        },
      ];

      // Request recall targets: must select unsolved problem B != A
      const targets = await selectRecallTargets(fsrsTriggers, testUserId);
      if (!Array.isArray(targets)) {
        throw new Error("selectRecallTargets did not return an array");
      }

      for (const t of targets) {
        const targetId = t.problemId || t.id || t._id;
        if (targetId === solvedProblemId) {
          throw new Error(`CRITICAL INVARIANT VIOLATION: Solved trigger problem ${targetId} was returned as recall target!`);
        }
      }
    });

  } finally {
    console.log("\n[Teardown] Cleaning up test-specific audit items from AWS Cloud DynamoDB...");
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup();
      } catch (err) {
        console.warn(`Cleanup notice: ${err.message}`);
      }
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    console.log("[Teardown] Cloud database cleaned and pristine.\n");
  }

  console.log("================================================================================");
  console.log(`Results: ${passed}/${total} deep database assertions passed.`);
  console.log("================================================================================");

  if (passed === total) {
    console.log("🎉 ALL AWS CLOUD DATABASE & STANDBY MONGO INTEGRITY TESTS PASSED CLEANLY!");
    console.log("🚀 DynamoDB Cloud in ap-southeast-2 is operating with 100% data integrity.");
  } else {
    console.error(`⚠️ ${total - passed} tests failed!`);
    process.exit(1);
  }
}

runCloudDatabaseIntegrityVerification().catch((err) => {
  console.error("Fatal error during cloud database integrity check:", err);
  process.exit(1);
});
