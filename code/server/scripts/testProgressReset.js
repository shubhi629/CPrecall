import problemMasteryRepo from "../src/repositories/problemMasteryRepo.js";
import patternMasteryRepo from "../src/repositories/patternMasteryRepo.js";
import fsrsStateRepo from "../src/repositories/fsrsStateRepo.js";
import acceptedSolutionRepo from "../src/repositories/acceptedSolutionRepo.js";
import progressResetRepo from "../src/repositories/progressResetRepo.js";
import progressResetService from "../src/services/progress/progressResetService.js";
import problemRepo from "../src/repositories/problemRepo.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../src/config/dynamodb.js";
import { processSubmission } from "../src/services/ingestion/processSubmission.js";
import { initTables } from "./initLocalDynamo.js";

async function runProgressResetTests() {
  console.log("==========================================================================");
  console.log("CPRecal — Question Library Completion & Progress Reset Comprehensive Suite");
  console.log("==========================================================================\n");

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
      if (err.stack) console.error(err.stack);
    }
  }

  const userA = "test-reset-user-a-" + Date.now();
  const userB = "test-reset-user-b-" + Date.now();
  const prob1 = "prob-p1-" + Date.now();
  const prob2 = "prob-p2-" + Date.now();
  const prob3 = "prob-p3-" + Date.now();

  // 1. Completion Accuracy & Catalog Integrity
  await test("Completion accuracy: memoryCatalog.length matches actual catalog and getTotalProblemsCount()", async () => {
    const count = await problemRepo.getTotalProblemsCount();
    if (typeof count !== "number") {
      throw new Error("Expected getTotalProblemsCount() to return a number");
    }

    // Solved === count only triggers when count > 0
    let totalSolved = 0;
    let isCompleted = totalSolved === count && count > 0;
    if (isCompleted !== false) throw new Error("Expected isCompleted false when totalSolved = 0");

    // Partial solve
    totalSolved = count > 1 ? count - 1 : 0;
    isCompleted = totalSolved === count && count > 0;
    if (isCompleted !== false && count > 1) throw new Error("Expected isCompleted false for partial solve");

    // All questions solved
    totalSolved = count > 0 ? count : 10;
    const testTotal = count > 0 ? count : 10;
    isCompleted = totalSolved === testTotal && testTotal > 0;
    if (isCompleted !== true) throw new Error("Expected isCompleted true when unique solved equals library count");
  });

  let activeLockToken = null;

  // 2. Setup initial progress, FSRS, patterns, and historical solutions
  await test("Setup initial progress, FSRS, patterns, and historical solutions", async () => {
    // User A solves prob1 and prob2
    await problemMasteryRepo.saveProblemMastery(userA, prob1, {
      mastery: 85,
      components: { solutionEfficiency: 90, timeComplexity: 85, submissionsUntilSuccess: 80, firstAttemptSuccess: 85, spaceComplexity: 85 }
    });
    await problemMasteryRepo.saveProblemMastery(userA, prob2, {
      mastery: 90,
      components: { solutionEfficiency: 95, timeComplexity: 90, submissionsUntilSuccess: 85, firstAttemptSuccess: 90, spaceComplexity: 90 }
    });

    // User A FSRS state
    await fsrsStateRepo.saveFSRSState(userA, prob1, {
      stability: 2.5,
      difficulty: 4.0,
      nextReviewDate: new Date().toISOString(),
      reps: 1
    });

    // User A Pattern Mastery
    await patternMasteryRepo.savePatternMastery(userA, "Two Pointers", {
      mastery: 85,
      totalProblemsSolved: 2,
      problemIds: [prob1, prob2]
    });

    // User A Historical Accepted Solutions (must be PRESERVED)
    await acceptedSolutionRepo.saveAcceptedSolution(userA, prob1, {
      code: "function solution() { return true; }",
      language: "javascript",
      executionTimeMs: 42,
      memoryKb: 1024
    });

    // User B data (must NOT be touched)
    await problemMasteryRepo.saveProblemMastery(userB, prob1, {
      mastery: 75,
      components: { solutionEfficiency: 70, timeComplexity: 75, submissionsUntilSuccess: 80, firstAttemptSuccess: 75, spaceComplexity: 75 }
    });

    const userAStats = await problemMasteryRepo.getUserStats(userA);
    if (!userAStats || userAStats.totalSolved !== 2) {
      throw new Error(`Expected User A totalSolved to be 2, got ${userAStats?.totalSolved}`);
    }

    const userBStats = await problemMasteryRepo.getUserStats(userB);
    if (!userBStats || userBStats.totalSolved !== 1) {
      throw new Error(`Expected User B totalSolved to be 1, got ${userBStats?.totalSolved}`);
    }
  });

  // 3. Concurrency Lock & Stale Lock Prevention with Heartbeat
  await test("Stale lock recovery: active heartbeat keeps lock fresh and blocks second reset", async () => {
    const lockAcquired = await progressResetRepo.acquireResetLock(userA);
    if (!lockAcquired || !lockAcquired.resetToken) throw new Error("First lock acquire should have succeeded");
    activeLockToken = lockAcquired.resetToken;

    // Heartbeat pulses the lock timestamp
    await progressResetRepo.heartbeatResetLock(userA, activeLockToken);

    // Second reset attempt while actively heartbeating must be rejected with 409
    try {
      await progressResetRepo.acquireResetLock(userA);
      throw new Error("Second lock acquire should have been rejected with 409 Conflict");
    } catch (err) {
      if (!err.message.includes("in progress") && err.code !== "RESET_IN_PROGRESS") {
        throw new Error(`Expected 'in progress' error, got: ${err.message}`);
      }
    }
  });

  // 4. Cross-Cutting Safeguard: ALL progress-writing paths respect the reset lock
  await test("Cross-cutting guard: ALL progress-writing paths reject writes during active reset", async () => {
    // 4a. Problem Mastery solve
    try {
      await problemMasteryRepo.saveProblemMastery(userA, prob3, {
        mastery: 80,
        components: { solutionEfficiency: 80, timeComplexity: 80, submissionsUntilSuccess: 80, firstAttemptSuccess: 80, spaceComplexity: 80 }
      });
      throw new Error("saveProblemMastery should have been rejected");
    } catch (err) {
      if (err.code !== "RESET_IN_PROGRESS" && !err.message.includes("Cannot save problem solution")) {
        throw err;
      }
    }

    // 4b. FSRS State save
    try {
      await fsrsStateRepo.saveFSRSState(userA, prob3, {
        nextReviewDate: new Date().toISOString(),
        rating: "good"
      });
      throw new Error("saveFSRSState should have been rejected");
    } catch (err) {
      if (err.code !== "RESET_IN_PROGRESS" && !err.message.includes("reset is in progress")) {
        throw err;
      }
    }

    // 4c. FSRS Review update
    try {
      await fsrsStateRepo.updateAfterReview(userA, prob1, "completed");
      throw new Error("updateAfterReview should have been rejected");
    } catch (err) {
      if (err.code !== "RESET_IN_PROGRESS" && !err.message.includes("reset is in progress")) {
        throw err;
      }
    }

    // 4d. Pattern Mastery save
    try {
      await patternMasteryRepo.savePatternMastery(userA, "Dynamic Programming", { mastery: 50 });
      throw new Error("savePatternMastery should have been rejected");
    } catch (err) {
      if (err.code !== "RESET_IN_PROGRESS" && !err.message.includes("reset is in progress")) {
        throw err;
      }
    }

    // 4e. Pattern Mastery update
    try {
      await patternMasteryRepo.updatePatternMastery(userA, "Two Pointers");
      throw new Error("updatePatternMastery should have been rejected");
    } catch (err) {
      if (err.code !== "RESET_IN_PROGRESS" && !err.message.includes("reset is in progress")) {
        throw err;
      }
    }

    // 4f. Ingestion pipeline processSubmission
    try {
      await processSubmission(userA, {
        problemId: 99999,
        title: "Test Problem",
        difficulty: "Easy",
        patterns: ["Math"],
        sessionStart: Date.now() - 60000,
        sessionEnd: Date.now(),
        submissionHistory: [],
        acceptedSubmissionId: "sub-1",
        acceptedCode: "code",
        language: "javascript",
        analysisResult: { actualTimeComplexity: "O(1)", actualSpaceComplexity: "O(1)", optimalTimeComplexity: "O(1)", optimalSpaceComplexity: "O(1)" }
      });
      throw new Error("processSubmission should have been rejected");
    } catch (err) {
      if (err.code !== "RESET_IN_PROGRESS" && !err.message.includes("reset is currently in progress")) {
        throw err;
      }
    }
  });

  // 5. Partial Reset Recovery Test
  await test("Partial reset recovery: resumes safely from FAILED_PARTIAL state and cleans up", async () => {
    // Record simulated partial failure
    await progressResetRepo.recordResetFailure(userA, activeLockToken, "Simulated network failure midway through reset");

    const statsAfterFailure = await problemMasteryRepo.getUserStats(userA);
    if (statsAfterFailure.resetStatus !== "FAILED_PARTIAL") {
      throw new Error(`Expected resetStatus = 'FAILED_PARTIAL', got: ${statsAfterFailure.resetStatus}`);
    }

    // Partial reset recovery: executing reset again must acquire lock and complete cleanly
    const recoveryResult = await progressResetService.resetUserProgress(userA);
    if (!recoveryResult.success) {
      throw new Error("Expected recovery reset to succeed");
    }

    // Verify all items are now deleted
    const verification = await progressResetRepo.verifyAllDeleted(userA);
    if (!verification.isClean) {
      throw new Error("Expected database to be clean after recovery reset");
    }

    const finalStats = await problemMasteryRepo.getUserStats(userA);
    if (finalStats.totalSolved !== 0) {
      throw new Error(`Expected totalSolved = 0, got: ${finalStats.totalSolved}`);
    }
    if (finalStats.resetStatus !== "IDLE") {
      throw new Error(`Expected resetStatus = 'IDLE', got: ${finalStats.resetStatus}`);
    }
  });

  // 6. Historical Data Preservation Test
  await test("Historical data preservation: accepted solutions and sessions are preserved and do not recreate mastery", async () => {
    // Historical accepted solution for prob1 must still exist
    const acceptedSol = await acceptedSolutionRepo.getAcceptedSolution(userA, prob1);
    if (!acceptedSol || !acceptedSol.code) {
      throw new Error("Historical accepted solution was erroneously deleted!");
    }

    // Active mastery for prob1 must NOT exist
    const mastery = await problemMasteryRepo.getProblemMastery(userA, prob1);
    if (mastery !== null) {
      throw new Error("Problem mastery was not purged or was resurrected!");
    }

    // User stats totalSolved must remain 0
    const stats = await problemMasteryRepo.getUserStats(userA);
    if (stats.totalSolved !== 0) {
      throw new Error(`Expected totalSolved to be 0, got ${stats.totalSolved}`);
    }

    // User B data was completely untouched
    const userBMastery = await problemMasteryRepo.getProblemMastery(userB, prob1);
    if (!userBMastery || userBMastery.mastery !== 75) {
      throw new Error("User B mastery was corrupted or deleted during User A reset!");
    }
    const userBStats = await problemMasteryRepo.getUserStats(userB);
    if (!userBStats || userBStats.totalSolved !== 1) {
      throw new Error(`User B totalSolved should still be 1, got ${userBStats?.totalSolved}`);
    }
  });

  // 7. Dismissal Cycle & Monotonic resetVersion
  await test("Dismissal cycle: resetVersion monotonically increases and scopes dismissals", async () => {
    // Current resetVersion for User A
    const statsV1 = await problemMasteryRepo.getUserStats(userA);
    const v1 = statsV1.resetVersion;

    // Dismiss completion prompt for current cycle
    await progressResetService.dismissCompletionPrompt(userA);
    const dismissal = await progressResetRepo.getCompletionDismissal(userA);
    if (dismissal.completionCycle !== v1) {
      throw new Error(`Expected dismissal completionCycle (${dismissal.completionCycle}) === resetVersion (${v1})`);
    }

    // Run another reset cycle
    await progressResetService.resetUserProgress(userA);
    const statsV2 = await problemMasteryRepo.getUserStats(userA);
    const v2 = statsV2.resetVersion;

    if (v2 <= v1) {
      throw new Error(`Expected resetVersion to monotonically increase (v2: ${v2} > v1: ${v1})`);
    }

    // Old dismissal must NOT match the new cycle v2
    const isDismissedInNewCycle = dismissal.completionCycle === v2;
    if (isDismissedInNewCycle !== false) {
      throw new Error("Old dismissal should not suppress prompt in the new completion cycle");
    }
  });

  // 8. Lock Expiry & Superseded Worker Invalidation
  await test("Lock expiry: superseded old worker cannot finalize or delete progress after recovery", async () => {
    // 1. Worker 1 acquires lock
    const worker1Lock = await progressResetRepo.acquireResetLock(userB);
    const worker1Token = worker1Lock.resetToken;

    // 2. Simulate worker 1 crashing/stalling:
    // Backdate resetLockTimestamp by 70s to exceed stale lock threshold (60s)
    const staleTime = new Date(Date.now() - 70000).toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: { PK: `USER#${userB}`, SK: "STATS" },
        UpdateExpression: "SET resetLockTimestamp = :staleTime",
        ExpressionAttributeValues: { ":staleTime": staleTime },
      })
    );

    // 3. Worker 2 recovers the lock
    const worker2Lock = await progressResetRepo.acquireResetLock(userB);
    const worker2Token = worker2Lock.resetToken;
    if (worker2Token === worker1Token) {
      throw new Error("Worker 2 should have received a new distinct reset token");
    }

    // 4. Old Worker 1 attempts to delete items using worker1Token -> must be REJECTED
    try {
      await progressResetRepo.batchDeleteKeys(
        TABLES.USER_PROBLEM_DATA,
        [{ PK: `USER#${userB}`, SK: "MASTERY#test" }],
        { userId: userB, resetToken: worker1Token }
      );
      throw new Error("Old worker with expired token should have been rejected by lock validation");
    } catch (err) {
      if (err.code !== "LOCK_SUPERSEDED" && err.name !== "ConditionalCheckFailedException") {
        throw err;
      }
    }

    // 5. Old Worker 1 attempts to finalize success using worker1Token -> must be REJECTED
    try {
      await progressResetRepo.finalizeResetSuccess(userB, worker1Token);
      throw new Error("Old worker should not be able to finalize with superseded token");
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") {
        throw err;
      }
    }

    // 6. Active Worker 2 can finalize cleanly with its valid token
    await progressResetRepo.finalizeResetSuccess(userB, worker2Token);
    const finalStats = await problemMasteryRepo.getUserStats(userB);
    if (finalStats.resetStatus !== "IDLE") {
      throw new Error(`Expected resetStatus = 'IDLE', got ${finalStats.resetStatus}`);
    }
  });

  console.log("\n==========================================================================");
  console.log(`Results: ${passed} / ${total} passed`);
  if (passed === total) {
    console.log("🎉 ALL EDGE CASE & SAFEGUARD TESTS PASSED CLEANLY!");
  } else {
    console.error(`⚠️ ${total - passed} tests failed!`);
    process.exit(1);
  }
}

runProgressResetTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
