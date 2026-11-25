import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import fs from "fs";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../src/config/dynamodb.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import User from "../src/models/User.js";
import Problem from "../src/models/Problem.js";
import ProblemMastery from "../src/models/ProblemMastery.js";
import PatternMastery from "../src/models/PatternMastery.js";
import FSRSState from "../src/models/FSRSState.js";
import AcceptedSolution from "../src/models/AcceptedSolution.js";
import SolvingSession from "../src/models/SolvingSession.js";
import Submission from "../src/models/Submission.js";
import ReviewHistory from "../src/models/ReviewHistory.js";

// Scan all items in a DynamoDB table
async function scanAll(tableName) {
  const items = [];
  let lek = undefined;
  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lek,
      })
    );
    if (res.Items) {
      items.push(...res.Items);
    }
    lek = res.LastEvaluatedKey;
  } while (lek);
  return items;
}

export function toValidObjectId(id) {
  if (!id) return null;
  const str = id.toString();
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
}

export async function runReverseSync({ cutoverTimestamp = null, isDryRun = false, dryRun = false } = {}) {
  const dry = Boolean(isDryRun || dryRun);
  console.log("================================================================================");
  console.log("CPRecal — DynamoDB -> MongoDB Lossless Reverse-Sync (Rollback Tool)");
  console.log(`Cutover Filter: ${cutoverTimestamp ? `>= ${cutoverTimestamp}` : "ALL RECENT / MODIFIED"}`);
  console.log(`Mode: ${dry ? "DRY RUN (No Mongo writes)" : "EXECUTE (Live Sync to MongoDB)"}`);
  console.log("================================================================================\n");

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in server/.env");
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB successfully.\n");

  const minDate = cutoverTimestamp ? new Date(cutoverTimestamp) : new Date(0);

  const stats = {
    usersReplayed: 0,
    problemMasteriesReplayed: 0,
    solutionsReplayed: 0,
    fsrsStatesReplayed: 0,
    patternMasteriesReplayed: 0,
    sessionsReplayed: 0,
    submissionsReplayed: 0,
    reviewsReplayed: 0,
  };

  try {
    // 1. Scan DynamoDB tables
    console.log("Scanning DynamoDB tables for reverse sync...");
    const [userItems, userProblemDataItems, userPatternMasteryItems, userActivityItems] =
      await Promise.all([
        scanAll(TABLES.USERS),
        scanAll(TABLES.USER_PROBLEM_DATA),
        scanAll(TABLES.USER_PATTERN_MASTERY),
        scanAll(TABLES.USER_ACTIVITY),
      ]);

    // 2. Replay Users
    const profiles = userItems.filter((i) => i.SK === "PROFILE");
    for (const u of profiles) {
      const updated = new Date(u.updatedAt || u.createdAt || 0);
      if (updated >= minDate) {
        if (!dry) {
          const uId = toValidObjectId(u.userId);
          const filter = uId ? { _id: uId } : { email: u.email.toLowerCase().trim() };
          await User.updateOne(
            filter,
            {
              $set: {
                name: u.name,
                email: u.email,
                passwordHash: u.passwordHash,
                createdAt: new Date(u.createdAt),
                updatedAt: new Date(u.updatedAt),
              },
              ...(uId ? {} : { $setOnInsert: { _id: new mongoose.Types.ObjectId() } }),
            },
            { upsert: true }
          );
        }
        stats.usersReplayed++;
      }
    }

    // 3. Replay ProblemMastery
    const masteries = userProblemDataItems.filter((i) => i.SK.startsWith("MASTERY#"));
    for (const m of masteries) {
      const updated = new Date(m.updatedAt || m.solvedAt || 0);
      if (updated >= minDate) {
        const uId = toValidObjectId(m.userId);
        const pId = toValidObjectId(m.problemId);
        if (uId && pId && !dry) {
          await ProblemMastery.updateOne(
            {
              userId: uId,
              problemId: pId,
            },
            {
              $set: {
                solvingSessionId: toValidObjectId(m.solvingSessionId) || undefined,
                acceptedSubmissionId: toValidObjectId(m.acceptedSubmissionId) || undefined,
                totalSubmissions: m.totalSubmissions,
                solvedAt: new Date(m.solvedAt),
                components: m.components,
                mastery: m.mastery,
                hintsUsedCount: m.hintsUsedCount,
                totalTimeSeconds: m.totalTimeSeconds,
                updatedAt: new Date(m.updatedAt),
              },
            },
            { upsert: true }
          );
        }
        stats.problemMasteriesReplayed++;
      }
    }

    // 4. Replay AcceptedSolutions (merge claim-check overflow if needed)
    const solutions = userProblemDataItems.filter((i) => i.SK.startsWith("SOLUTION#"));
    for (const sol of solutions) {
      const updated = new Date(sol.updatedAt || sol.solvedAt || 0);
      if (updated >= minDate) {
        let code = sol.code;
        let analysisResult = sol.analysisResult;

        if (sol.isOverflow && sol.s3Pointer?.localPath && fs.existsSync(sol.s3Pointer.localPath)) {
          try {
            const raw = fs.readFileSync(sol.s3Pointer.localPath, "utf8");
            const parsed = JSON.parse(raw);
            code = parsed.code;
            analysisResult = parsed.analysisResult;
          } catch (e) {
            console.warn(`[ReverseSync] Could not read overflow payload: ${e.message}`);
          }
        }

        const uId = toValidObjectId(sol.userId);
        const pId = toValidObjectId(sol.problemId);
        if (uId && pId && !dry) {
          await AcceptedSolution.updateOne(
            {
              userId: uId,
              problemId: pId,
            },
            {
              $set: {
                submissionId: toValidObjectId(sol.submissionId) || undefined,
                code,
                language: sol.language,
                runtime: sol.runtime,
                memory: sol.memory,
                analysisResult,
                createdAt: new Date(sol.solvedAt || sol.updatedAt),
                updatedAt: new Date(sol.updatedAt),
              },
            },
            { upsert: true }
          );
        }
        stats.solutionsReplayed++;
      }
    }

    // 5. Replay FSRSState
    const fsrsStates = userProblemDataItems.filter((i) => i.SK.startsWith("FSRS#"));
    for (const f of fsrsStates) {
      const updated = new Date(f.updatedAt || f.nextReviewDate || 0);
      if (updated >= minDate) {
        const uId = toValidObjectId(f.userId);
        const pId = toValidObjectId(f.problemId);
        if (uId && pId && !dry) {
          await FSRSState.updateOne(
            {
              userId: uId,
              problemId: pId,
            },
            {
              $set: {
                rating: f.rating,
                nextReviewDate: new Date(f.nextReviewDate),
                intervalDays: f.intervalDays,
                easeFactor: f.easeFactor,
                reviewHistory: (f.reviewHistory || []).map((rh) => ({
                  reviewedAt: new Date(rh.reviewedAt),
                  rating: rh.rating,
                  intervalBefore: rh.intervalBefore,
                })),
                updatedAt: new Date(f.updatedAt),
              },
            },
            { upsert: true }
          );
        }
        stats.fsrsStatesReplayed++;
      }
    }

    // 6. Replay PatternMastery
    const patternMasteries = userPatternMasteryItems.filter((i) => i.SK.startsWith("PATTERN#"));
    for (const pm of patternMasteries) {
      const updated = new Date(pm.updatedAt || 0);
      if (updated >= minDate) {
        const uId = toValidObjectId(pm.userId);
        if (uId && !dry) {
          await PatternMastery.updateOne(
            {
              userId: uId,
              pattern: pm.pattern,
            },
            {
              $set: {
                totalProblemsAttempted: pm.totalProblemsAttempted,
                totalProblemsSolved: pm.totalProblemsSolved,
                mastery: pm.mastery,
                components: pm.components,
                updatedAt: new Date(pm.updatedAt),
              },
            },
            { upsert: true }
          );
        }
        stats.patternMasteriesReplayed++;
      }
    }

    // 7. Replay SolvingSessions
    const sessions = userActivityItems.filter((i) => i.SK.startsWith("SESSION#"));
    for (const s of sessions) {
      const updated = new Date(s.createdAt || s.startTime || 0);
      if (updated >= minDate) {
        const sId = toValidObjectId(s.sessionId);
        const uId = toValidObjectId(s.userId);
        const pId = toValidObjectId(s.problemId);
        if (sId && uId && pId && !dry) {
          await SolvingSession.updateOne(
            { _id: sId },
            {
              $set: {
                userId: uId,
                problemId: pId,
                startTime: new Date(s.startTime),
                endTime: new Date(s.endTime),
                totalTimeSeconds: s.totalTimeSeconds,
                createdAt: new Date(s.createdAt),
              },
            },
            { upsert: true }
          );
        }
        stats.sessionsReplayed++;
      }
    }

    // 8. Replay Submissions
    const submissions = userActivityItems.filter((i) => i.SK.startsWith("SUBMISSION#"));
    for (const sub of submissions) {
      const updated = new Date(sub.createdAt || sub.timestamp || 0);
      if (updated >= minDate) {
        const subId = toValidObjectId(sub.submissionId);
        const uId = toValidObjectId(sub.userId);
        const pId = toValidObjectId(sub.problemId);
        const sessId = toValidObjectId(sub.sessionId);
        if (subId && uId && pId && sessId && !dry) {
          await Submission.updateOne(
            { _id: subId },
            {
              $set: {
                userId: uId,
                problemId: pId,
                sessionId: sessId,
                submissionId: sub.submissionId,
                status: sub.status,
                runtime: sub.runtime,
                memory: sub.memory,
                language: sub.language,
                timestamp: new Date(sub.timestamp),
                createdAt: new Date(sub.createdAt),
              },
            },
            { upsert: true }
          );
        }
        stats.submissionsReplayed++;
      }
    }

    // 9. Replay ReviewHistories
    const reviews = userActivityItems.filter((i) => i.SK.startsWith("REVIEW#"));
    for (const rev of reviews) {
      const updated = new Date(rev.createdAt || rev.reviewedAt || 0);
      if (updated >= minDate) {
        const uId = toValidObjectId(rev.userId);
        const pId = toValidObjectId(rev.problemId);
        if (uId && pId && !dry) {
          await ReviewHistory.updateOne(
            {
              userId: uId,
              problemId: pId,
              reviewedAt: new Date(rev.reviewedAt),
            },
            {
              $set: {
                previousMastery: rev.previousMastery,
                newMastery: rev.newMastery,
                fsrsRating: rev.fsrsRating,
                status: rev.status,
                satisfiedByProblemId: toValidObjectId(rev.satisfiedByProblemId) || undefined,
              },
            },
            { upsert: true }
          );
        }
        stats.reviewsReplayed++;
      }
    }

    console.log("================================================================================");
    console.log("🎉 REVERSE-SYNC SUMMARY");
    console.log("================================================================================");
    console.table(stats);
    console.log("================================================================================\n");

    return stats;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

// CLI Execution Support
if (process.argv[1] && process.argv[1].endsWith("reverseSyncDynamoToMongo.js")) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const cutoverArg = args.find((a) => a.startsWith("--cutover="));
  const cutoverTimestamp = cutoverArg ? cutoverArg.split("=")[1] : null;

  runReverseSync({ cutoverTimestamp, isDryRun })
    .then(() => {
      console.log("Reverse sync execution completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Reverse sync failed:", err);
      process.exit(1);
    });
}
