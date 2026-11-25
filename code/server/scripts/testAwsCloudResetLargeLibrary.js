import dotenv from "dotenv";
dotenv.config();

process.env.DB_BACKEND = "dynamodb";
process.env.DYNAMODB_MODE = "cloud";

import { rawClient, docClient, TABLES } from "../src/config/dynamodb.js";
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import problemRepo from "../src/repositories/problemRepo.js";
import problemMasteryRepo from "../src/repositories/problemMasteryRepo.js";
import acceptedSolutionRepo from "../src/repositories/acceptedSolutionRepo.js";
import progressResetRepo from "../src/repositories/progressResetRepo.js";
import progressResetService from "../src/services/progress/progressResetService.js";
import fsrsStateRepo from "../src/repositories/fsrsStateRepo.js";
import patternMasteryRepo from "../src/repositories/patternMasteryRepo.js";

async function runAwsCloudVerification() {
  console.log("================================================================================");
  console.log("CPRecal — AWS DynamoDB Cloud Behavior & Large Library Scale Verification");
  console.log("================================================================================\n");

  // Step 1: Confirm AWS Environment & IAM Configuration
  console.log("--- Step 1: AWS Environment & IAM Permissions Verification ---");
  console.log(`AWS Region:       ${process.env.AWS_REGION}`);
  console.log(`DynamoDB Mode:    ${process.env.DYNAMODB_MODE}`);
  const endpointUrl = rawClient.config.endpoint ? await rawClient.config.endpoint() : "AWS Cloud HTTPS";
  console.log(`Endpoint:         ${endpointUrl.protocol}//${endpointUrl.hostname}`);

  for (const [name, tableName] of Object.entries(TABLES)) {
    const desc = await rawClient.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table [${name} -> ${tableName}]: Status = ${desc.Table?.TableStatus}, Billing = ${desc.Table?.BillingModeSummary?.BillingMode || "PROVISIONED"}`);
  }
  console.log("✅ AWS IAM permissions verified for DescribeTable across all 5 tables.\n");

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

  // Step 2: Seed a Large Library (30 Questions) to test multi-chunk pagination & batch deletion
  const LARGE_LIBRARY_SIZE = 30;
  const largeCatalog = [];
  const patterns = ["Two Pointers", "Dynamic Programming", "Binary Search", "Arrays", "Trees", "Graphs", "Sliding Window", "Greedy"];

  for (let i = 1; i <= LARGE_LIBRARY_SIZE; i++) {
    const pat1 = patterns[(i - 1) % patterns.length];
    const pat2 = patterns[i % patterns.length];
    largeCatalog.push({
      problemId: `aws_scale_p${1000 + i}`,
      leetcodeId: 1000 + i,
      title: `Scale Problem #${i}`,
      titleSlug: `scale-problem-${i}`,
      difficulty: i % 3 === 0 ? "Hard" : i % 2 === 0 ? "Medium" : "Easy",
      patterns: [pat1, pat2],
    });
  }

  await test(`Seeding Large Library: Upserting ${LARGE_LIBRARY_SIZE} reference questions into AWS DynamoDB`, async () => {
    await problemRepo.bulkUpsertProblems(largeCatalog);
    const count = await problemRepo.getTotalProblemsCount();
    console.log(`   Catalog successfully seeded. Total problems in catalog: ${count}`);
    if (count < LARGE_LIBRARY_SIZE) {
      throw new Error(`Expected at least ${LARGE_LIBRARY_SIZE} problems in catalog, got ${count}`);
    }
  });

  const timestamp = Date.now();
  const testUserId = `aws_scale_user_${timestamp}`;
  const isolatedUserId = `aws_isolated_user_${timestamp}`;

  // Step 3: Populate user progress for all 30 problems
  await test(`Progress Population: Populating ${LARGE_LIBRARY_SIZE} problem masteries, FSRS states, and solutions`, async () => {
    console.log(`   Populating ${LARGE_LIBRARY_SIZE} problem solves for User ${testUserId}...`);
    for (const p of largeCatalog) {
      await problemMasteryRepo.saveProblemMastery(testUserId, p.problemId, {
        mastery: 80,
        components: { solutionEfficiency: 80, timeComplexity: 80, submissionsUntilSuccess: 80, firstAttemptSuccess: 80, spaceComplexity: 80 },
      });
      await fsrsStateRepo.saveFSRSState(testUserId, p.problemId, {
        stability: 2.0,
        difficulty: 4.0,
        nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
        reps: 1,
      });
      await acceptedSolutionRepo.saveAcceptedSolution(testUserId, p.problemId, {
        code: `// AWS scale solution for ${p.problemId}`,
        language: "javascript",
        executionTimeMs: 40,
        memoryKb: 1024,
      });
    }

    // Populate pattern masteries
    for (const pat of patterns) {
      await patternMasteryRepo.savePatternMastery(testUserId, pat, {
        mastery: 80,
        totalProblemsAttempted: 10,
        totalProblemsSolved: 10,
        components: { solutionEfficiency: 80, timeComplexity: 80, submissionsUntilSuccess: 80, timeTaken: 80, hintsUsed: 80 },
      });
    }

    // Populate partial solves for isolated user (5 problems)
    for (const p of largeCatalog.slice(0, 5)) {
      await problemMasteryRepo.saveProblemMastery(isolatedUserId, p.problemId, {
        mastery: 70,
        components: { solutionEfficiency: 70, timeComplexity: 70, submissionsUntilSuccess: 70, firstAttemptSuccess: 70, spaceComplexity: 70 },
      });
    }

    // Verify stats
    const stats = await problemMasteryRepo.getUserStats(testUserId);
    if (stats.totalSolved !== LARGE_LIBRARY_SIZE) {
      throw new Error(`Expected totalSolved = ${LARGE_LIBRARY_SIZE}, got ${stats.totalSolved}`);
    }
  });

  // Step 4: Verify Lock Recovery under real network conditions on AWS DynamoDB
  await test("AWS Lock Recovery: Stale lock recovery with real time delay against AWS Cloud", async () => {
    const realLeaseMs = 1200; // 1.2s lease
    const stallUserId = `aws_stall_${Date.now()}`;

    // Worker 1 acquires lock on AWS
    const lock1 = await progressResetRepo.acquireResetLock(stallUserId, realLeaseMs);
    const token1 = lock1.resetToken;

    // Real delay exceeding lease
    await new Promise((resolve) => setTimeout(resolve, 1400));

    // Worker 2 recovers lock on AWS
    const lock2 = await progressResetRepo.acquireResetLock(stallUserId, realLeaseMs);
    const token2 = lock2.resetToken;
    if (token1 === token2) throw new Error("Worker 2 should have received a new token");

    // Worker 1 attempts deletion on AWS -> must be rejected by conditional check
    try {
      await progressResetRepo.batchDeleteKeys(
        TABLES.USER_PROBLEM_DATA,
        [{ PK: `USER#${stallUserId}`, SK: "MASTERY#aws_scale_p1001" }],
        { userId: stallUserId, resetToken: token1 }
      );
      throw new Error("Worker 1 should have been rejected by lock token validation");
    } catch (err) {
      if (err.code !== "LOCK_SUPERSEDED" && err.name !== "ConditionalCheckFailedException") {
        throw err;
      }
    }

    // Worker 1 attempts finalization on AWS -> must fail
    try {
      await progressResetRepo.finalizeResetSuccess(stallUserId, token1);
      throw new Error("Worker 1 should not finalize with superseded token");
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") throw err;
    }

    // Worker 2 finalizes cleanly on AWS
    await progressResetRepo.finalizeResetSuccess(stallUserId, token2);
  });

  // Step 5: Large-Scale Multi-Chunk Reset Execution on AWS DynamoDB
  await test(`Scale Reset: Purging ${LARGE_LIBRARY_SIZE * 2 + patterns.length}+ records across multiple 25-item DynamoDB chunks`, async () => {
    const startTime = Date.now();
    const result = await progressResetService.resetUserProgress(testUserId);
    const durationMs = Date.now() - startTime;

    console.log(`   Reset completed in ${durationMs}ms`);
    console.log(`   Result success: ${result.success}, New resetVersion: ${result.resetVersion}`);

    if (!result.success) {
      throw new Error("Expected resetUserProgress to return success: true");
    }
    if (!result.resetVersion || result.resetVersion < 1) {
      throw new Error(`Expected valid resetVersion, got ${result.resetVersion}`);
    }

    // Verify strongly consistent purge check on AWS
    const verification = await progressResetRepo.verifyAllDeleted(testUserId);
    if (!verification.isClean) {
      throw new Error(`DynamoDB verifyAllDeleted reported leftovers: ${JSON.stringify(verification)}`);
    }
  });

  // Step 6: Post-Reset State & Stats Verification on AWS
  await test("Post-Reset Verification on AWS: User stats are zeroed and questions marked incomplete", async () => {
    const stats = await problemMasteryRepo.getUserStats(testUserId);
    if (stats.totalSolved !== 0) throw new Error(`Expected totalSolved = 0, got ${stats.totalSolved}`);
    if (stats.averageMastery !== 0) throw new Error(`Expected averageMastery = 0, got ${stats.averageMastery}`);

    const masteries = await problemMasteryRepo.batchGetProblemMasteries(
      testUserId,
      largeCatalog.map((p) => p.problemId)
    );
    if (masteries.length !== 0) {
      throw new Error(`Expected 0 masteries returned, got ${masteries.length}`);
    }
  });

  // Step 7: Historical Data & Isolation Integrity on AWS
  await test("AWS Data Integrity: Historical accepted solutions preserved & isolated user untouched", async () => {
    // Check historical solution for testUserId p1001
    const sol = await acceptedSolutionRepo.getAcceptedSolution(testUserId, "aws_scale_p1001");
    if (!sol || !sol.code) {
      throw new Error("Historical accepted solution was incorrectly deleted!");
    }

    // Check isolated user remains untouched
    const isoStats = await problemMasteryRepo.getUserStats(isolatedUserId);
    if (isoStats.totalSolved !== 5) {
      throw new Error(`Isolated user was mutated! Expected totalSolved = 5, got ${isoStats.totalSolved}`);
    }

    const isoMastery = await problemMasteryRepo.getProblemMastery(isolatedUserId, "aws_scale_p1001");
    if (!isoMastery || isoMastery.mastery !== 70) {
      throw new Error("Isolated user mastery record was corrupted!");
    }
  });

  console.log("\n================================================================================");
  console.log(`Results: ${passed} / ${total} passed`);
  if (passed === total) {
    console.log("🎉 ALL AWS CLOUD DYNAMODB SCALE & BEHAVIOR TESTS PASSED CLEANLY!");
  } else {
    console.error(`⚠️ ${total - passed} tests failed!`);
    process.exit(1);
  }
}

runAwsCloudVerification().catch((err) => {
  console.error("AWS Cloud verification failed:", err);
  process.exit(1);
});
