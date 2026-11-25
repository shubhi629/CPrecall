import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import fs from "fs";
import { BatchWriteCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../src/config/dynamodb.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Import Mongoose Models
import User from "../src/models/User.js";
import Problem from "../src/models/Problem.js";
import ProblemMastery from "../src/models/ProblemMastery.js";
import PatternMastery from "../src/models/PatternMastery.js";
import FSRSState from "../src/models/FSRSState.js";
import AcceptedSolution from "../src/models/AcceptedSolution.js";
import SolvingSession from "../src/models/SolvingSession.js";
import Submission from "../src/models/Submission.js";
import ReviewHistory from "../src/models/ReviewHistory.js";

const OVERFLOW_DIR = path.resolve(__dirname, "../dynamo-data/s3-overflow");
const OVERFLOW_THRESHOLD_BYTES = 300 * 1024; // 300 KB

// Helper for chunked BatchWrite with exponential backoff
async function batchWriteAll(tableName, items, isDryRun = false) {
  if (!items || items.length === 0) return 0;
  if (isDryRun) return items.length;

  const CHUNK_SIZE = 25;
  let totalWritten = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const writeRequests = chunk.map((item) => ({
      PutRequest: { Item: item },
    }));

    let attempts = 0;
    let unprocessed = { [tableName]: writeRequests };

    while (unprocessed && Object.keys(unprocessed).length > 0 && attempts < 5) {
      const res = await docClient.send(
        new BatchWriteCommand({
          RequestItems: unprocessed,
        })
      );
      unprocessed = res.UnprocessedItems;
      if (unprocessed && Object.keys(unprocessed).length > 0) {
        attempts++;
        await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 50));
      }
    }

    totalWritten += chunk.length;
  }

  return totalWritten;
}

export async function runMigration({ isDryRun = false, isVerifyOnly = false } = {}) {
  console.log("================================================================================");
  console.log(`CPRecal — MongoDB -> DynamoDB Forward Migration Tool`);
  console.log(`Mode: ${isVerifyOnly ? "VERIFY ONLY" : isDryRun ? "DRY RUN (No writes)" : "EXECUTE (Live Migration)"}`);
  console.log("================================================================================\n");

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in server/.env");
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB successfully.\n");

  const migrationStats = {
    users: 0,
    problems: 0,
    problemAdjacencies: 0,
    problemMasteries: 0,
    patternMasteries: 0,
    fsrsStates: 0,
    acceptedSolutions: 0,
    overflowSolutions: 0,
    solvingSessions: 0,
    submissions: 0,
    reviewHistories: 0,
    userStatsRecords: 0,
  };

  try {
    // -------------------------------------------------------------------------
    // 1. Migrate Users (Profile + Email Reservation Lock)
    // -------------------------------------------------------------------------
    console.log(">>> [1/7] Migrating Users...");
    const userCursor = User.find({}).select("+passwordHash").lean().cursor({ batchSize: 500 });
    const userItems = [];

    for await (const user of userCursor) {
      const userId = user._id.toString();
      const cleanEmail = (user.email || "").toLowerCase().trim();
      const now = user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString();
      const updatedAt = user.updatedAt ? new Date(user.updatedAt).toISOString() : now;

      // Profile item
      userItems.push({
        PK: `USER#${userId}`,
        SK: "PROFILE",
        userId,
        name: user.name,
        email: cleanEmail,
        passwordHash: user.passwordHash,
        createdAt: now,
        updatedAt,
      });

      // Email reservation lock item
      userItems.push({
        PK: `EMAIL#${cleanEmail}`,
        SK: "RESERVATION",
        userId,
        email: cleanEmail,
        createdAt: now,
      });

      migrationStats.users++;
    }

    await batchWriteAll(TABLES.USERS, userItems, isDryRun);
    console.log(`✅ Users: Processed ${migrationStats.users} users (${userItems.length} items written)\n`);

    // -------------------------------------------------------------------------
    // 2. Migrate Problems (Metadata + Pattern Adjacency + Global Unique Patterns)
    // -------------------------------------------------------------------------
    console.log(">>> [2/7] Migrating Problems...");
    const problemCursor = Problem.find({}).lean().cursor({ batchSize: 500 });
    const problemItems = [];
    const allUniquePatterns = new Set();

    for await (const prob of problemCursor) {
      const problemId = prob._id.toString();
      const leetcodeId = parseInt(prob.leetcodeId, 10);
      const title = (prob.title || "").trim();
      const titleSlug = (prob.titleSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")).toLowerCase();
      const difficulty = prob.difficulty || "Medium";
      const patterns = Array.isArray(prob.patterns) ? prob.patterns : [];
      const description = prob.description || "";
      const createdAt = prob.createdAt ? new Date(prob.createdAt).toISOString() : new Date().toISOString();
      const updatedAt = prob.updatedAt ? new Date(prob.updatedAt).toISOString() : createdAt;

      // Metadata item
      problemItems.push({
        PK: `PROBLEM#${problemId}`,
        SK: "META",
        problemId,
        _id: problemId,
        leetcodeId,
        title,
        titleSlug,
        difficulty,
        patterns,
        description,
        createdAt,
        updatedAt,
      });

      // Adjacency items (1 per pattern)
      for (const p of patterns) {
        allUniquePatterns.add(p);
        problemItems.push({
          PK: `PATTERN#${p}`,
          SK: `PROBLEM#${problemId}`,
          patternGSI_PK: p,
          patternGSI_SK: `${difficulty}#${title}`,
          problemId,
          leetcodeId,
          problemTitle: title,
          problemDifficulty: difficulty,
          patterns,
          createdAt,
        });
        migrationStats.problemAdjacencies++;
      }

      migrationStats.problems++;
    }

    // Add global patterns metadata item
    if (allUniquePatterns.size > 0) {
      problemItems.push({
        PK: "METADATA",
        SK: "ALL_PATTERNS",
        uniquePatterns: Array.from(allUniquePatterns),
        updatedAt: new Date().toISOString(),
      });
    }

    await batchWriteAll(TABLES.PROBLEMS, problemItems, isDryRun);
    console.log(`✅ Problems: Processed ${migrationStats.problems} problems + ${migrationStats.problemAdjacencies} pattern adjacencies\n`);

    // -------------------------------------------------------------------------
    // 3. Migrate ProblemMastery, AcceptedSolution, FSRSState -> UserProblemData
    // -------------------------------------------------------------------------
    console.log(">>> [3/7] Migrating User Problem Data (Mastery, Solutions, FSRS, UserStats)...");
    const userProblemDataItems = [];
    const userStatsAggregators = new Map(); // userId -> { totalSolved, totalAttempted, totalMasterySum }

    // 3A. ProblemMastery
    const masteryCursor = ProblemMastery.find({}).lean().cursor({ batchSize: 500 });
    for await (const m of masteryCursor) {
      const userId = m.userId.toString();
      const problemId = m.problemId.toString();
      const masteryScore = Math.round(m.mastery || 0);
      const solvedAt = m.solvedAt ? new Date(m.solvedAt).toISOString() : new Date().toISOString();
      const updatedAt = m.updatedAt ? new Date(m.updatedAt).toISOString() : solvedAt;

      userProblemDataItems.push({
        PK: `USER#${userId}`,
        SK: `MASTERY#${problemId}`,
        userId,
        problemId,
        solvingSessionId: m.solvingSessionId?.toString() || null,
        acceptedSubmissionId: m.acceptedSubmissionId?.toString() || null,
        totalSubmissions: m.totalSubmissions || 1,
        solvedAt,
        components: {
          solutionEfficiency: Math.round(m.components?.solutionEfficiency ?? 0),
          timeComplexity: Math.round(m.components?.timeComplexity ?? 0),
          submissionsUntilSuccess: Math.round(m.components?.submissionsUntilSuccess ?? 0),
          timeTaken: Math.round(m.components?.timeTaken ?? 0),
          hintsUsed: Math.round(m.components?.hintsUsed ?? 0),
        },
        mastery: masteryScore,
        hintsUsedCount: m.hintsUsedCount || 0,
        totalTimeSeconds: m.totalTimeSeconds || 0,
        updatedAt,
      });

      // Update aggregator
      if (!userStatsAggregators.has(userId)) {
        userStatsAggregators.set(userId, { totalSolved: 0, totalAttempted: 0, totalMasterySum: 0 });
      }
      const agg = userStatsAggregators.get(userId);
      agg.totalSolved++;
      agg.totalMasterySum += masteryScore;

      migrationStats.problemMasteries++;
    }

    // 3B. AcceptedSolutions (with claim-check overflow if >= 300 KB)
    const solutionCursor = AcceptedSolution.find({}).lean().cursor({ batchSize: 200 });
    for await (const sol of solutionCursor) {
      const userId = sol.userId.toString();
      const problemId = sol.problemId.toString();
      const now = sol.updatedAt ? new Date(sol.updatedAt).toISOString() : new Date().toISOString();

      const payloadToMeasure = JSON.stringify({
        code: sol.code || "",
        analysisResult: sol.analysisResult || null,
      });
      const byteSize = Buffer.byteLength(payloadToMeasure, "utf8");

      let isOverflow = false;
      let s3Pointer = null;
      let storedCode = sol.code || "";
      let storedAnalysis = sol.analysisResult || null;

      if (byteSize >= OVERFLOW_THRESHOLD_BYTES) {
        isOverflow = true;
        migrationStats.overflowSolutions++;

        if (!isDryRun) {
          if (!fs.existsSync(OVERFLOW_DIR)) {
            fs.mkdirSync(OVERFLOW_DIR, { recursive: true });
          }
          const overflowFileName = `${userId}_${problemId}.json`;
          const overflowFilePath = path.join(OVERFLOW_DIR, overflowFileName);

          fs.writeFileSync(
            overflowFilePath,
            JSON.stringify({
              code: sol.code,
              analysisResult: sol.analysisResult,
              userId,
              problemId,
              savedAt: now,
            }),
            "utf8"
          );

          s3Pointer = {
            key: `solutions/${userId}/${problemId}.json`,
            localPath: overflowFilePath,
            size: byteSize,
            isOverflow: true,
          };
        } else {
          s3Pointer = { key: `solutions/${userId}/${problemId}.json`, size: byteSize, isOverflow: true };
        }

        storedCode = "[OFFLOADED_TO_CLAIM_CHECK_STORAGE]";
        storedAnalysis = { isOverflow: true, pointerKey: s3Pointer.key };
      }

      userProblemDataItems.push({
        PK: `USER#${userId}`,
        SK: `SOLUTION#${problemId}`,
        userId,
        problemId,
        submissionId: sol.submissionId?.toString() || null,
        code: storedCode,
        language: sol.language || "unknown",
        runtime: sol.runtime ?? null,
        memory: sol.memory ?? null,
        analysisResult: storedAnalysis,
        isOverflow,
        s3Pointer,
        solvedAt: sol.createdAt ? new Date(sol.createdAt).toISOString() : now,
        updatedAt: now,
      });

      migrationStats.acceptedSolutions++;
    }

    // 3C. FSRSState
    const fsrsCursor = FSRSState.find({}).lean().cursor({ batchSize: 500 });
    for await (const f of fsrsCursor) {
      const userId = f.userId.toString();
      const problemId = f.problemId.toString();
      const nextReviewDate = f.nextReviewDate ? new Date(f.nextReviewDate).toISOString() : new Date().toISOString();
      const now = f.updatedAt ? new Date(f.updatedAt).toISOString() : new Date().toISOString();

      const reviewHistory = Array.isArray(f.reviewHistory)
        ? f.reviewHistory.map((rh) => ({
            reviewedAt: rh.reviewedAt ? new Date(rh.reviewedAt).toISOString() : now,
            rating: rh.rating,
            intervalBefore: rh.intervalBefore || 0,
          }))
        : [];

      userProblemDataItems.push({
        PK: `USER#${userId}`,
        SK: `FSRS#${problemId}`,
        userId,
        problemId,
        rating: f.rating,
        nextReviewDate,
        intervalDays: f.intervalDays,
        easeFactor: f.easeFactor ?? 2.5,
        reviewHistory,
        updatedAt: now,
      });

      migrationStats.fsrsStates++;
    }

    // -------------------------------------------------------------------------
    // 4. Migrate SolvingSessions (to calculate accurate totalAttempted for stats)
    // -------------------------------------------------------------------------
    console.log(">>> [4/7] Migrating Solving Sessions...");
    const userActivityItems = [];
    const sessionCursor = SolvingSession.find({}).lean().cursor({ batchSize: 500 });

    for await (const sess of sessionCursor) {
      const userId = sess.userId.toString();
      const sessionId = sess._id.toString();
      const problemId = sess.problemId.toString();
      const startTime = sess.startTime ? new Date(sess.startTime).toISOString() : new Date().toISOString();
      const endTime = sess.endTime ? new Date(sess.endTime).toISOString() : startTime;
      const totalTimeSeconds = sess.totalTimeSeconds || 0;
      const now = sess.createdAt ? new Date(sess.createdAt).toISOString() : startTime;

      userActivityItems.push({
        PK: `USER#${userId}`,
        SK: `SESSION#${startTime}#${sessionId}`,
        userId,
        sessionId,
        _id: sessionId,
        problemId,
        startTime,
        endTime,
        totalTimeSeconds,
        createdAt: now,
      });

      if (!userStatsAggregators.has(userId)) {
        userStatsAggregators.set(userId, { totalSolved: 0, totalAttempted: 0, totalMasterySum: 0 });
      }
      userStatsAggregators.get(userId).totalAttempted++;
      migrationStats.solvingSessions++;
    }

    // -------------------------------------------------------------------------
    // 5. Migrate PatternMastery -> UserPatternMastery
    // -------------------------------------------------------------------------
    console.log(">>> [5/7] Migrating Pattern Mastery...");
    const patternItems = [];
    const patternCursor = PatternMastery.find({}).lean().cursor({ batchSize: 500 });
    const userCoveredPatterns = new Map(); // userId -> count

    for await (const pm of patternCursor) {
      const userId = pm.userId.toString();
      const pattern = pm.pattern;
      const now = pm.updatedAt ? new Date(pm.updatedAt).toISOString() : new Date().toISOString();

      patternItems.push({
        PK: `USER#${userId}`,
        SK: `PATTERN#${pattern}`,
        userId,
        pattern,
        totalProblemsAttempted: pm.totalProblemsAttempted || 0,
        totalProblemsSolved: pm.totalProblemsSolved || 0,
        mastery: Math.round(pm.mastery || 0),
        components: {
          solutionEfficiency: Math.round(pm.components?.solutionEfficiency ?? 0),
          timeComplexity: Math.round(pm.components?.timeComplexity ?? 0),
          submissionsUntilSuccess: Math.round(pm.components?.submissionsUntilSuccess ?? 0),
          timeTaken: Math.round(pm.components?.timeTaken ?? 0),
          hintsUsed: Math.round(pm.components?.hintsUsed ?? 0),
        },
        updatedAt: now,
      });

      if (pm.totalProblemsAttempted > 0) {
        userCoveredPatterns.set(userId, (userCoveredPatterns.get(userId) || 0) + 1);
      }
      migrationStats.patternMasteries++;
    }

    await batchWriteAll(TABLES.USER_PATTERN_MASTERY, patternItems, isDryRun);
    console.log(`✅ Pattern Mastery: Processed ${migrationStats.patternMasteries} items\n`);

    // -------------------------------------------------------------------------
    // 6. Generate and write STATS records into UserProblemData
    // -------------------------------------------------------------------------
    console.log(">>> [6/7] Computing and writing UserStats records...");
    for (const [userId, agg] of userStatsAggregators.entries()) {
      const patternsCovered = userCoveredPatterns.get(userId) || 0;
      const avgMastery = agg.totalSolved > 0 ? Math.round(agg.totalMasterySum / agg.totalSolved) : 0;

      userProblemDataItems.push({
        PK: `USER#${userId}`,
        SK: "STATS",
        userId,
        totalSolved: agg.totalSolved,
        totalAttempted: Math.max(agg.totalAttempted, agg.totalSolved),
        totalMasterySum: agg.totalMasterySum,
        averageMastery: avgMastery,
        patternsCovered,
        updatedAt: new Date().toISOString(),
      });
      migrationStats.userStatsRecords++;
    }

    await batchWriteAll(TABLES.USER_PROBLEM_DATA, userProblemDataItems, isDryRun);
    console.log(`✅ UserProblemData: Processed ${userProblemDataItems.length} items (Mastery, Solutions, FSRS, Stats)\n`);

    // -------------------------------------------------------------------------
    // 7. Migrate Submissions & ReviewHistories -> UserActivity
    // -------------------------------------------------------------------------
    console.log(">>> [7/7] Migrating Submissions & Review History...");

    // Submissions
    const subCursor = Submission.find({}).lean().cursor({ batchSize: 500 });
    for await (const sub of subCursor) {
      const userId = sub.userId.toString();
      const sessionId = sub.sessionId.toString();
      const problemId = sub.problemId.toString();
      const submissionId = sub.submissionId || sub._id.toString();
      const timestamp = sub.timestamp ? new Date(sub.timestamp).toISOString() : new Date().toISOString();
      const now = sub.createdAt ? new Date(sub.createdAt).toISOString() : timestamp;

      userActivityItems.push({
        PK: `USER#${userId}`,
        SK: `SUBMISSION#${sessionId}#${timestamp}#${submissionId}`,
        userId,
        problemId,
        sessionId,
        submissionId,
        _id: submissionId,
        status: sub.status,
        runtime: sub.runtime ?? null,
        memory: sub.memory ?? null,
        language: sub.language || "unknown",
        timestamp,
        createdAt: now,
      });
      migrationStats.submissions++;
    }

    // Review Histories
    const revCursor = ReviewHistory.find({}).lean().cursor({ batchSize: 500 });
    for await (const rev of revCursor) {
      const userId = rev.userId.toString();
      const problemId = rev.problemId.toString();
      const reviewedAt = rev.reviewedAt ? new Date(rev.reviewedAt).toISOString() : new Date().toISOString();
      const now = rev.createdAt ? new Date(rev.createdAt).toISOString() : reviewedAt;

      userActivityItems.push({
        PK: `USER#${userId}`,
        SK: `REVIEW#${reviewedAt}#${problemId}`,
        userId,
        problemId,
        reviewedAt,
        previousMastery: rev.previousMastery ?? null,
        newMastery: rev.newMastery,
        fsrsRating: rev.fsrsRating,
        status: rev.status || "completed",
        satisfiedByProblemId: rev.satisfiedByProblemId?.toString() || null,
        createdAt: now,
      });
      migrationStats.reviewHistories++;
    }

    await batchWriteAll(TABLES.USER_ACTIVITY, userActivityItems, isDryRun);
    console.log(`✅ UserActivity: Processed ${userActivityItems.length} items (Sessions, Submissions, Reviews)\n`);

    console.log("================================================================================");
    console.log("🎉 FORWARD MIGRATION SUMMARY");
    console.log("================================================================================");
    console.table(migrationStats);
    console.log("================================================================================\n");

    return migrationStats;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

// CLI Execution Support
if (process.argv[1] && process.argv[1].endsWith("migrateMongoToDynamo.js")) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isVerifyOnly = args.includes("--verify");

  runMigration({ isDryRun, isVerifyOnly })
    .then(() => {
      console.log("Migration script execution completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
