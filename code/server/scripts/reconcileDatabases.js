import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import fs from "fs";
import { ScanCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
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

export async function runReconciliation() {
  console.log("================================================================================");
  console.log("CPRecal — MongoDB vs DynamoDB Database Reconciliation Tool");
  console.log("================================================================================\n");

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in server/.env");
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB successfully.\n");

  const report = {
    timestamp: new Date().toISOString(),
    counts: {},
    discrepancies: [],
    passed: true,
  };

  try {
    console.log("Scanning DynamoDB tables...");
    const [userTableItems, problemTableItems, userProblemDataItems, userPatternMasteryItems, userActivityItems] =
      await Promise.all([
        scanAll(TABLES.USERS),
        scanAll(TABLES.PROBLEMS),
        scanAll(TABLES.USER_PROBLEM_DATA),
        scanAll(TABLES.USER_PATTERN_MASTERY),
        scanAll(TABLES.USER_ACTIVITY),
      ]);

    console.log("Fetching MongoDB record counts...");
    const [
      mongoUsers,
      mongoProblems,
      mongoProblemMasteries,
      mongoAcceptedSolutions,
      mongoFSRSStates,
      mongoPatternMasteries,
      mongoSessions,
      mongoSubmissions,
      mongoReviews,
    ] = await Promise.all([
      User.countDocuments({}),
      Problem.countDocuments({}),
      ProblemMastery.countDocuments({}),
      AcceptedSolution.countDocuments({}),
      FSRSState.countDocuments({}),
      PatternMastery.countDocuments({}),
      SolvingSession.countDocuments({}),
      Submission.countDocuments({}),
      ReviewHistory.countDocuments({}),
    ]);

    // Segment DynamoDB items by SK prefix
    const dynamoProfiles = userTableItems.filter((i) => i.SK === "PROFILE");
    const dynamoEmailLocks = userTableItems.filter((i) => i.SK === "RESERVATION");
    const dynamoProblemMetas = problemTableItems.filter((i) => i.SK === "META");
    const dynamoProblemMasteries = userProblemDataItems.filter((i) => i.SK.startsWith("MASTERY#"));
    const dynamoSolutions = userProblemDataItems.filter((i) => i.SK.startsWith("SOLUTION#"));
    const dynamoFSRS = userProblemDataItems.filter((i) => i.SK.startsWith("FSRS#"));
    const dynamoStats = userProblemDataItems.filter((i) => i.SK === "STATS");
    const dynamoPatternMasteries = userPatternMasteryItems.filter((i) => i.SK.startsWith("PATTERN#"));
    const dynamoSessions = userActivityItems.filter((i) => i.SK.startsWith("SESSION#"));
    const dynamoSubmissions = userActivityItems.filter((i) => i.SK.startsWith("SUBMISSION#"));
    const dynamoReviews = userActivityItems.filter((i) => i.SK.startsWith("REVIEW#"));

    // Maps for O(1) existence and attribute checking
    const dynamoUserMap = new Map(dynamoProfiles.map((u) => [u.userId, u]));
    const dynamoEmailMap = new Map(dynamoEmailLocks.map((e) => [e.email, e]));
    const dynamoProblemMap = new Map(dynamoProblemMetas.map((p) => [p.problemId, p]));
    const dynamoMasteryMap = new Map(dynamoProblemMasteries.map((m) => [`${m.userId}#${m.problemId}`, m]));
    const dynamoSolutionMap = new Map(dynamoSolutions.map((s) => [`${s.userId}#${s.problemId}`, s]));
    const dynamoFsrsMap = new Map(dynamoFSRS.map((f) => [`${f.userId}#${f.problemId}`, f]));
    const dynamoPatternMap = new Map(dynamoPatternMasteries.map((pm) => [`${pm.userId}#${pm.pattern}`, pm]));
    const dynamoSessionMap = new Map(dynamoSessions.map((s) => [s.sessionId, s]));
    const dynamoSubmissionMap = new Map(dynamoSubmissions.map((s) => [s.submissionId, s]));
    const dynamoReviewMap = new Map(dynamoReviews.map((r) => [`${r.userId}#${r.reviewedAt}#${r.problemId}`, r]));

    // 1. Verify 100% of MongoDB Users exist in DynamoDB
    let mongoUsersMatched = 0;
    const allMongoUsers = await User.find({}).lean();
    for (const u of allMongoUsers) {
      const uIdStr = u._id.toString();
      const du = dynamoUserMap.get(uIdStr);
      const de = dynamoEmailMap.get((u.email || "").toLowerCase().trim());
      if (!du || !de) {
        report.discrepancies.push(`User ${uIdStr} (${u.email}) missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoUsersMatched++;
      }
    }

    // 2. Verify 100% of MongoDB Problems exist in DynamoDB
    let mongoProblemsMatched = 0;
    const allMongoProblems = await Problem.find({}).lean();
    for (const p of allMongoProblems) {
      const pIdStr = p._id.toString();
      const dp = dynamoProblemMap.get(pIdStr);
      if (!dp) {
        report.discrepancies.push(`Problem ${pIdStr} (${p.title}) missing in DynamoDB`);
        report.passed = false;
      } else {
        if (dp.difficulty !== p.difficulty || dp.title.trim() !== (p.title || "").trim()) {
          report.discrepancies.push(`Problem ${pIdStr} attribute mismatch: Mongo="${p.title}", Dynamo="${dp.title}"`);
          report.passed = false;
        } else {
          mongoProblemsMatched++;
        }
      }
    }

    // 3. Verify 100% of MongoDB ProblemMastery exist in DynamoDB
    let mongoMasteriesMatched = 0;
    const allMongoMasteries = await ProblemMastery.find({}).lean();
    for (const m of allMongoMasteries) {
      const key = `${m.userId.toString()}#${m.problemId.toString()}`;
      const dm = dynamoMasteryMap.get(key);
      if (!dm) {
        report.discrepancies.push(`Mastery ${key} missing in DynamoDB`);
        report.passed = false;
      } else {
        if (Math.round(dm.mastery) !== Math.round(m.mastery)) {
          report.discrepancies.push(`Mastery score mismatch for ${key}: Mongo=${m.mastery}, Dynamo=${dm.mastery}`);
          report.passed = false;
        } else {
          mongoMasteriesMatched++;
        }
      }
    }

    // 4. Verify 100% of MongoDB Solutions exist in DynamoDB
    let mongoSolutionsMatched = 0;
    const allMongoSolutions = await AcceptedSolution.find({}).lean();
    for (const s of allMongoSolutions) {
      const key = `${s.userId.toString()}#${s.problemId.toString()}`;
      const ds = dynamoSolutionMap.get(key);
      if (!ds) {
        report.discrepancies.push(`AcceptedSolution ${key} missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoSolutionsMatched++;
      }
    }

    // 5. Verify 100% of MongoDB FSRSStates exist in DynamoDB
    let mongoFsrsMatched = 0;
    const allMongoFsrs = await FSRSState.find({}).lean();
    for (const f of allMongoFsrs) {
      const key = `${f.userId.toString()}#${f.problemId.toString()}`;
      const df = dynamoFsrsMap.get(key);
      if (!df) {
        report.discrepancies.push(`FSRSState ${key} missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoFsrsMatched++;
      }
    }

    // 6. Verify 100% of MongoDB PatternMasteries exist in DynamoDB
    let mongoPatternMatched = 0;
    const allMongoPattern = await PatternMastery.find({}).lean();
    for (const pm of allMongoPattern) {
      const key = `${pm.userId.toString()}#${pm.pattern}`;
      const dpm = dynamoPatternMap.get(key);
      if (!dpm) {
        report.discrepancies.push(`PatternMastery ${key} missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoPatternMatched++;
      }
    }

    // 7. Verify 100% of MongoDB SolvingSessions exist in DynamoDB
    let mongoSessionsMatched = 0;
    const allMongoSessions = await SolvingSession.find({}).lean();
    for (const s of allMongoSessions) {
      const sId = s._id.toString();
      const ds = dynamoSessionMap.get(sId);
      if (!ds) {
        report.discrepancies.push(`SolvingSession ${sId} missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoSessionsMatched++;
      }
    }

    // 8. Verify 100% of MongoDB Submissions exist in DynamoDB
    let mongoSubmissionsMatched = 0;
    const allMongoSubmissions = await Submission.find({}).lean();
    for (const sub of allMongoSubmissions) {
      const subId = (sub.submissionId || sub._id.toString()).toString();
      const dsub = dynamoSubmissionMap.get(subId);
      if (!dsub) {
        report.discrepancies.push(`Submission ${subId} missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoSubmissionsMatched++;
      }
    }

    // 9. Verify 100% of MongoDB ReviewHistories exist in DynamoDB
    let mongoReviewsMatched = 0;
    const allMongoReviews = await ReviewHistory.find({}).lean();
    for (const r of allMongoReviews) {
      const revDate = r.reviewedAt ? new Date(r.reviewedAt).toISOString() : "";
      const key = `${r.userId.toString()}#${revDate}#${r.problemId.toString()}`;
      const dr = dynamoReviewMap.get(key);
      if (!dr) {
        report.discrepancies.push(`ReviewHistory ${key} missing in DynamoDB`);
        report.passed = false;
      } else {
        mongoReviewsMatched++;
      }
    }

    report.counts = {
      users: { mongo: mongoUsers, dynamoTotal: dynamoProfiles.length, mongoMatched: mongoUsersMatched, coverage: `${Math.round((mongoUsersMatched / (mongoUsers || 1)) * 100)}%` },
      problems: { mongo: mongoProblems, dynamoTotal: dynamoProblemMetas.length, mongoMatched: mongoProblemsMatched, coverage: `${Math.round((mongoProblemsMatched / (mongoProblems || 1)) * 100)}%` },
      problemMasteries: { mongo: mongoProblemMasteries, dynamoTotal: dynamoProblemMasteries.length, mongoMatched: mongoMasteriesMatched, coverage: `${Math.round((mongoMasteriesMatched / (mongoProblemMasteries || 1)) * 100)}%` },
      acceptedSolutions: { mongo: mongoAcceptedSolutions, dynamoTotal: dynamoSolutions.length, mongoMatched: mongoSolutionsMatched, coverage: `${Math.round((mongoSolutionsMatched / (mongoAcceptedSolutions || 1)) * 100)}%` },
      fsrsStates: { mongo: mongoFSRSStates, dynamoTotal: dynamoFSRS.length, mongoMatched: mongoFsrsMatched, coverage: `${Math.round((mongoFsrsMatched / (mongoFSRSStates || 1)) * 100)}%` },
      patternMasteries: { mongo: mongoPatternMasteries, dynamoTotal: dynamoPatternMasteries.length, mongoMatched: mongoPatternMatched, coverage: `${Math.round((mongoPatternMatched / (mongoPatternMasteries || 1)) * 100)}%` },
      solvingSessions: { mongo: mongoSessions, dynamoTotal: dynamoSessions.length, mongoMatched: mongoSessionsMatched, coverage: `${Math.round((mongoSessionsMatched / (mongoSessions || 1)) * 100)}%` },
      submissions: { mongo: mongoSubmissions, dynamoTotal: dynamoSubmissions.length, mongoMatched: mongoSubmissionsMatched, coverage: `${Math.round((mongoSubmissionsMatched / (mongoSubmissions || 1)) * 100)}%` },
      reviewHistories: { mongo: mongoReviews, dynamoTotal: dynamoReviews.length, mongoMatched: mongoReviewsMatched, coverage: `${Math.round((mongoReviewsMatched / (mongoReviews || 1)) * 100)}%` },
      userStats: { dynamoCount: dynamoStats.length },
    };

    console.table(report.counts);

    // Write report to JSON
    const reportPath = path.resolve(__dirname, "reconciliation-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nReconciliation report saved to: ${reportPath}`);

    if (report.passed) {
      console.log("\n✅ RECONCILIATION PASSED: 100% parity across MongoDB and DynamoDB!");
    } else {
      console.warn("\n⚠️ RECONCILIATION DETECTED DISCREPANCIES:");
      report.discrepancies.forEach((d) => console.warn(`- ${d}`));
    }

    return report;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

// CLI Execution Support
if (process.argv[1] && process.argv[1].endsWith("reconcileDatabases.js")) {
  runReconciliation()
    .then((report) => {
      process.exit(report.passed ? 0 : 1);
    })
    .catch((err) => {
      console.error("Reconciliation failed:", err);
      process.exit(1);
    });
}
