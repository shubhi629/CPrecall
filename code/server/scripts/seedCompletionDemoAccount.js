import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../src/config/dynamodb.js";
import userRepo from "../src/repositories/userRepo.js";
import problemRepo from "../src/repositories/problemRepo.js";
import problemMasteryRepo from "../src/repositories/problemMasteryRepo.js";
import fsrsStateRepo from "../src/repositories/fsrsStateRepo.js";
import acceptedSolutionRepo from "../src/repositories/acceptedSolutionRepo.js";
import patternMasteryRepo from "../src/repositories/patternMasteryRepo.js";
import { getDashboardData } from "../src/services/dashboard/dashboardService.js";

async function seedDemoAccount() {
  console.log("================================================================================");
  console.log("CPRecal — Seeding QA Completion Demo Account for Live Browser UI Verification");
  console.log("================================================================================\n");

  const email = "demo@cprecall.io";
  const password = "Password123!";
  const name = "Demo Completion User";

  // 1. Find or create user
  let user = await userRepo.getUserByEmail(email);
  let userId;

  if (user) {
    console.log(`User ${email} already exists (ID: ${user.id || user.userId}). Updating credentials...`);
    userId = (user.id || user.userId).toString();
    const hashedPassword = await bcrypt.hash(password, 10);
    await docClient.send(
      new UpdateCommand({
        TableName: TABLES.USERS,
        Key: { PK: `USER#${userId}`, SK: "PROFILE" },
        UpdateExpression: "SET password = :pwd, #name = :name",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":pwd": hashedPassword, ":name": name },
      })
    );
  } else {
    console.log(`Creating new demo user ${email}...`);
    user = await userRepo.createUser({ name, email, password });
    userId = (user.id || user.userId).toString();
  }

  console.log(`Demo User ID: ${userId}`);

  // 2. Fetch 5 reference problems from the catalog
  await problemRepo.initCatalog();
  const catalogRes = await problemRepo.getProblemsPaginated({ limit: 5 });
  const problems = (catalogRes.problems || []).slice(0, 5);

  if (problems.length < 5) {
    throw new Error(`Catalog has only ${problems.length} problems. Need at least 5.`);
  }

  console.log(`Selected 5 reference problems for demo completion:`);
  problems.forEach((p, idx) => console.log(`   ${idx + 1}. [${p.problemId}] ${p.title} (${p.difficulty})`));

  // 3. Mark all 5 problems as solved with high mastery
  console.log(`\nPopulating full mastery, FSRS states, and solutions for all 5 problems...`);
  for (const p of problems) {
    const pId = p.problemId;
    await problemMasteryRepo.saveProblemMastery(userId, pId, {
      mastery: 88,
      components: {
        solutionEfficiency: 92,
        timeComplexity: 88,
        submissionsUntilSuccess: 85,
        firstAttemptSuccess: 90,
        spaceComplexity: 85,
      },
    });

    await fsrsStateRepo.saveFSRSState(userId, pId, {
      stability: 2.4,
      difficulty: 3.5,
      nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
      reps: 1,
    });

    await acceptedSolutionRepo.saveAcceptedSolution(userId, pId, {
      code: `// Demo accepted solution for ${p.title}\nfunction solution() {\n  return true;\n}`,
      language: "javascript",
      executionTimeMs: 42,
      memoryKb: 2048,
    });
  }

  // 4. Configure demoLibrarySize: 5 on UserStats item so completion detection is 5/5 = 100%
  const nowIso = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLES.USER_PROBLEM_DATA,
      Key: { PK: `USER#${userId}`, SK: "STATS" },
      UpdateExpression: "SET demoLibrarySize = :five, isDemoAccount = :trueVal, resetStatus = :idle REMOVE completionDismissalCycle",
      ExpressionAttributeValues: {
        ":five": 5,
        ":trueVal": true,
        ":idle": "IDLE",
      },
    })
  );

  // 5. Verify Dashboard State for this user
  const dashboard = await getDashboardData(userId);
  console.log(`\n--- Dashboard Verification ---`);
  console.log(`Total Solved:              ${dashboard.stats.totalSolved}`);
  console.log(`Total Problems in Library: ${dashboard.stats.totalProblems}`);
  console.log(`Is Library Completed:      ${dashboard.stats.isLibraryCompleted}`);
  console.log(`Completion Dismissed:      ${dashboard.stats.completionPromptDismissed}`);

  if (dashboard.stats.isLibraryCompleted !== true) {
    throw new Error("Expected isLibraryCompleted to be true!");
  }
  if (dashboard.stats.completionPromptDismissed !== false) {
    throw new Error("Expected completionPromptDismissed to be false initially!");
  }

  console.log("\n================================================================================");
  console.log("🎉 DEMO ACCOUNT READY FOR LIVE BROWSER VERIFICATION!");
  console.log("   URL:      http://localhost:5173");
  console.log("   Email:    demo@cprecall.io");
  console.log("   Password: Password123!");
  console.log("================================================================================\n");
}

seedDemoAccount().catch((err) => {
  console.error("Failed to seed demo account:", err);
  process.exit(1);
});
