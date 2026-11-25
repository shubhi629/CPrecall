import { execSync } from "child_process";

console.log("================================================================================");
console.log("CPRecal — Complete DynamoDB Repository Integration Test Suite (Phase 2)");
console.log("================================================================================\n");

const suites = [
  { name: "Group 1: User Repository (Registration, Auth, Locks)", script: "scripts/testUserRepo.js" },
  { name: "Group 2: Problem Repository (Catalog, Adjacency, Deduplication)", script: "scripts/testProblemRepo.js" },
  { name: "Group 3: Mastery Repositories (Problem & Pattern Mastery, UserStats)", script: "scripts/testMasteryRepos.js" },
  { name: "Group 4: Activity & FSRS Repositories (FSRS, S3 Overflow, Sessions)", script: "scripts/testActivityAndFsrsRepos.js" },
];

let allPassed = true;

for (const suite of suites) {
  console.log(`\n>>> Running: ${suite.name}...`);
  try {
    execSync(`node ${suite.script}`, { stdio: "inherit" });
  } catch (err) {
    allPassed = false;
    console.error(`❌ Suite failed: ${suite.name}`);
  }
}

console.log("\n================================================================================");
if (allPassed) {
  console.log("🎉 ALL PHASE 2 REPOSITORY TEST SUITES PASSED CLEANLY!");
} else {
  console.error("❌ Some repository test suites failed. Check logs above.");
  process.exit(1);
}
console.log("================================================================================");
