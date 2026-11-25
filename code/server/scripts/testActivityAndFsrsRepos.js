import fs from "fs";
import fsrsStateRepo from "../src/repositories/fsrsStateRepo.js";
import acceptedSolutionRepo from "../src/repositories/acceptedSolutionRepo.js";
import solvingSessionRepo from "../src/repositories/solvingSessionRepo.js";
import submissionRepo from "../src/repositories/submissionRepo.js";
import reviewHistoryRepo from "../src/repositories/reviewHistoryRepo.js";
import { initTables } from "./initLocalDynamo.js";

async function runActivityAndFsrsTests() {
  console.log("==================================================================");
  console.log("CPRecal — Group 4: FSRS, Solution Overflow & Activity Test Suite");
  console.log("==================================================================\n");

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

  const userId = "user-activity-" + Date.now();
  const prob1Id = "prob-act-1-" + Date.now();
  const prob2Id = "prob-act-2-" + Date.now();
  const sessionId = "sess-" + Date.now();

  // Test 1: FSRS State & Chronological Due Reviews Query
  await test("FSRSState saves and queries due reviews in chronological order via sparse GSI", async () => {
    const overdueDate = "2026-10-20T00:00:00.000Z";
    const todayDate = "2026-10-23T05:00:00.000Z";
    const futureDate = "2026-10-30T00:00:00.000Z";

    await fsrsStateRepo.saveFSRSState(userId, prob1Id, {
      rating: 2,
      nextReviewDate: overdueDate,
      intervalDays: 1,
      easeFactor: 2.3,
    });

    await fsrsStateRepo.saveFSRSState(userId, prob2Id, {
      rating: 3,
      nextReviewDate: futureDate,
      intervalDays: 7,
      easeFactor: 2.5,
    });

    const dueReviews = await fsrsStateRepo.getDueReviews(userId, todayDate);
    if (dueReviews.length !== 1 || dueReviews[0].problemId !== prob1Id) {
      throw new Error(`Expected exactly 1 due review (prob1), got: ${dueReviews.length}`);
    }

    const futureReviews = await fsrsStateRepo.getFutureScheduledReviews(userId, todayDate);
    if (futureReviews.length !== 1 || futureReviews[0].problemId !== prob2Id) {
      throw new Error(`Expected exactly 1 future review (prob2), got: ${futureReviews.length}`);
    }
  });

  // Test 2: FSRS Post-Review Update
  await test("updateAfterReview increases interval and easeFactor on completed status", async () => {
    const updated = await fsrsStateRepo.updateAfterReview(userId, prob1Id, "completed");
    if (updated.intervalDays <= 1 || updated.easeFactor <= 2.3) {
      throw new Error(`FSRS update did not increase interval/ease: interval=${updated.intervalDays}`);
    }
    if (updated.reviewHistory.length === 0) {
      throw new Error("Review history not appended to FSRS state");
    }
  });

  // Test 3: AcceptedSolution Normal Size
  await test("AcceptedSolution saves and retrieves standard payload cleanly", async () => {
    const code = "def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i";
    const analysis = { actualTimeComplexity: "O(n)", optimalTimeComplexity: "O(n)", explanation: "Hash map approach" };

    await acceptedSolutionRepo.saveAcceptedSolution(userId, prob1Id, {
      code,
      language: "python3",
      runtime: 45,
      memory: 17200,
      analysisResult: analysis,
    });

    const fetched = await acceptedSolutionRepo.getAcceptedSolution(userId, prob1Id);
    if (!fetched || fetched.code !== code || fetched.isOverflow) {
      throw new Error("Standard solution payload mismatch or incorrect overflow flag");
    }
  });

  // Test 4: S3 / Disk Claim-Check Overflow Pattern for >300 KB Payloads
  await test("AcceptedSolution offloads payloads >= 300 KB to overflow storage and merges transparently on read", async () => {
    // Generate a 350 KB payload
    const largeCode = "// Massive code payload\n" + "console.log('padding');\n".repeat(15000);
    const largeAnalysis = {
      overview: "Deep pedagogical AST breakdown",
      trace: "step_".repeat(20000),
    };

    const payloadByteSize = Buffer.byteLength(JSON.stringify({ code: largeCode, analysisResult: largeAnalysis }), "utf8");
    if (payloadByteSize < 300 * 1024) {
      throw new Error("Generated test payload must be >= 300 KB");
    }

    const saved = await acceptedSolutionRepo.saveAcceptedSolution(userId, prob2Id, {
      code: largeCode,
      language: "javascript",
      runtime: 120,
      memory: 45000,
      analysisResult: largeAnalysis,
    });

    if (!saved.isOverflow || !saved.s3Pointer?.localPath) {
      throw new Error("Oversized payload was not flagged as overflow or local path missing");
    }

    // Verify file exists on disk in overflow storage
    if (!fs.existsSync(saved.s3Pointer.localPath)) {
      throw new Error(`Overflow file was not created on disk: ${saved.s3Pointer.localPath}`);
    }

    // Read back and verify transparent, lossless merge
    const retrieved = await acceptedSolutionRepo.getAcceptedSolution(userId, prob2Id);
    if (!retrieved || retrieved.code !== largeCode || retrieved.analysisResult.trace !== largeAnalysis.trace) {
      throw new Error("Transparent overflow retrieval failed: code or analysis corrupted!");
    }
  });

  // Test 5: SolvingSession Recording & Deduplication
  await test("SolvingSession records session and handles duplicate calls idempotently", async () => {
    const start = new Date(Date.now() - 600000);
    const end = new Date();

    const sess1 = await solvingSessionRepo.createSession({
      userId,
      sessionId,
      problemId: prob1Id,
      startTime: start,
      endTime: end,
      totalTimeSeconds: 600,
    });

    if (sess1.sessionId !== sessionId) {
      throw new Error("Session ID mismatch");
    }

    // Retrying with same sessionId should not fail
    const sess2 = await solvingSessionRepo.createSession({
      userId,
      sessionId,
      problemId: prob1Id,
      startTime: start,
      endTime: end,
      totalTimeSeconds: 600,
    });

    if (sess2.sessionId !== sessionId) {
      throw new Error("Idempotent retry failed");
    }
  });

  // Test 6: Submission Attempts & SessionIdIndex
  await test("batchCreateSubmissions writes attempts and retrieves them via SessionIdIndex", async () => {
    const attempts = [
      {
        sessionId,
        problemId: prob1Id,
        submissionId: "sub-1-" + Date.now(),
        status: "Wrong Answer",
        runtime: 60,
        memory: 15000,
        language: "python3",
        timestamp: new Date(Date.now() - 300000).toISOString(),
      },
      {
        sessionId,
        problemId: prob1Id,
        submissionId: "sub-2-" + Date.now(),
        status: "Accepted",
        runtime: 45,
        memory: 14500,
        language: "python3",
        timestamp: new Date().toISOString(),
      },
    ];

    await submissionRepo.batchCreateSubmissions(userId, attempts);

    const sessionSubs = await submissionRepo.getSubmissionsBySession(sessionId);
    if (sessionSubs.length !== 2) {
      throw new Error(`Expected 2 submissions for session, got: ${sessionSubs.length}`);
    }
    if (sessionSubs[1].status !== "Accepted") {
      throw new Error("Submissions not ordered chronologically");
    }
  });

  // Test 7: ReviewHistory Logging
  await test("ReviewHistory records historical log and queries newest first", async () => {
    await reviewHistoryRepo.createReviewHistory({
      userId,
      problemId: prob1Id,
      reviewedAt: new Date(Date.now() - 10000).toISOString(),
      previousMastery: 70,
      newMastery: 85,
      fsrsRating: 3,
      status: "completed",
    });

    await reviewHistoryRepo.createReviewHistory({
      userId,
      problemId: prob2Id,
      reviewedAt: new Date().toISOString(),
      previousMastery: 50,
      newMastery: 65,
      fsrsRating: 3,
      status: "completed",
    });

    const history = await reviewHistoryRepo.getUserReviewHistory(userId, 10);
    if (history.length < 2) {
      throw new Error(`Expected at least 2 review history items, got: ${history.length}`);
    }
    if (history[0].problemId !== prob2Id) {
      throw new Error("Review history not sorted newest first");
    }
  });

  console.log("\n==================================================================");
  console.log(`Results: ${passed}/${total} tests passed.`);
  console.log("==================================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runActivityAndFsrsTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
