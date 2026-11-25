import problemMasteryRepo from "../src/repositories/problemMasteryRepo.js";
import patternMasteryRepo from "../src/repositories/patternMasteryRepo.js";
import problemRepo from "../src/repositories/problemRepo.js";
import { initTables } from "./initLocalDynamo.js";

async function runMasteryRepoTests() {
  console.log("==========================================================");
  console.log("CPRecal — Group 3: Problem & Pattern Mastery Test Suite");
  console.log("==========================================================\n");

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

  const userIdA = "user-mastery-a-" + Date.now();
  const userIdB = "user-mastery-b-" + Date.now();
  const prob1Id = "prob-mastery-1-" + Date.now();
  const prob2Id = "prob-mastery-2-" + Date.now();

  // Test 1: First Solve updates UserStats atomically
  await test("First solve saves mastery and increments UserStats totalSolved", async () => {
    await problemMasteryRepo.saveProblemMastery(userIdA, prob1Id, {
      mastery: 80,
      components: {
        solutionEfficiency: 90,
        timeComplexity: 85,
        submissionsUntilSuccess: 75,
        timeTaken: 80,
        hintsUsed: 70,
      },
      totalSubmissions: 2,
      totalTimeSeconds: 450,
    });

    const mastery = await problemMasteryRepo.getProblemMastery(userIdA, prob1Id);
    if (!mastery || mastery.mastery !== 80) {
      throw new Error("Mastery record not saved correctly");
    }

    const stats = await problemMasteryRepo.getUserStats(userIdA);
    if (stats.totalSolved !== 1 || stats.totalMasterySum !== 80 || stats.averageMastery !== 80) {
      throw new Error(`Unexpected stats after first solve: ${JSON.stringify(stats)}`);
    }
  });

  // Test 2: Re-solve does NOT double-increment totalSolved
  await test("Re-solve updates score and adjusts sum without double-incrementing totalSolved", async () => {
    await problemMasteryRepo.saveProblemMastery(userIdA, prob1Id, {
      mastery: 95,
      components: {
        solutionEfficiency: 100,
        timeComplexity: 95,
        submissionsUntilSuccess: 90,
        timeTaken: 95,
        hintsUsed: 95,
      },
      totalSubmissions: 1,
      totalTimeSeconds: 200,
    });

    const stats = await problemMasteryRepo.getUserStats(userIdA);
    if (stats.totalSolved !== 1) {
      throw new Error(`Double-increment defect: totalSolved is ${stats.totalSolved}, expected 1!`);
    }
    if (stats.totalMasterySum !== 95 || stats.averageMastery !== 95) {
      throw new Error(`Mastery sum not adjusted correctly: ${JSON.stringify(stats)}`);
    }
  });

  // Test 3: Second Distinct Problem increments totalSolved and recalculates average
  await test("Solving second problem increments totalSolved and computes correct average", async () => {
    await problemMasteryRepo.saveProblemMastery(userIdA, prob2Id, {
      mastery: 65,
      components: {
        solutionEfficiency: 70,
        timeComplexity: 60,
        submissionsUntilSuccess: 70,
        timeTaken: 60,
        hintsUsed: 65,
      },
      totalSubmissions: 3,
      totalTimeSeconds: 600,
    });

    const stats = await problemMasteryRepo.getUserStats(userIdA);
    if (stats.totalSolved !== 2) {
      throw new Error(`Expected totalSolved = 2, got: ${stats.totalSolved}`);
    }
    // Sum: 95 + 65 = 160. Avg: 160 / 2 = 80
    if (stats.totalMasterySum !== 160 || stats.averageMastery !== 80) {
      throw new Error(`Expected sum=160, avg=80; got: ${JSON.stringify(stats)}`);
    }
  });

  // Test 4: ProblemMasteryScoreIndex query
  await test("ProblemMasteryScoreIndex retrieves solved problems sorted by score descending", async () => {
    const solved = await problemMasteryRepo.getUserSolvedProblems(userIdA);
    if (solved.length !== 2) {
      throw new Error(`Expected 2 solved problems, got: ${solved.length}`);
    }
    if (solved[0].mastery < solved[1].mastery) {
      throw new Error("Solved problems not returned in descending mastery order");
    }
  });

  // Test 5: Pattern Mastery Aggregation
  await test("updatePatternMastery aggregates problem masteries for a pattern", async () => {
    const testPattern = "Sliding Window Probe " + Date.now();

    // Create 2 problems with this pattern
    const patProb1 = "pat-prob-1-" + Date.now();
    const patProb2 = "pat-prob-2-" + Date.now();

    await problemRepo.createOrUpdateProblem({
      problemId: patProb1,
      leetcodeId: Math.floor(10000 + Math.random() * 80000),
      title: "Window Problem 1",
      difficulty: "Medium",
      patterns: [testPattern],
    });

    await problemRepo.createOrUpdateProblem({
      problemId: patProb2,
      leetcodeId: Math.floor(10000 + Math.random() * 80000),
      title: "Window Problem 2",
      difficulty: "Hard",
      patterns: [testPattern],
    });

    // Solve problem 1 with mastery 70, problem 2 with mastery 90
    await problemMasteryRepo.saveProblemMastery(userIdA, patProb1, {
      mastery: 70,
      components: { solutionEfficiency: 70, timeComplexity: 70, submissionsUntilSuccess: 70, timeTaken: 70, hintsUsed: 70 },
    });
    await problemMasteryRepo.saveProblemMastery(userIdA, patProb2, {
      mastery: 90,
      components: { solutionEfficiency: 90, timeComplexity: 90, submissionsUntilSuccess: 90, timeTaken: 90, hintsUsed: 90 },
    });

    // Update pattern mastery
    const patternRecord = await patternMasteryRepo.updatePatternMastery(userIdA, testPattern);
    if (!patternRecord || patternRecord.mastery !== 80) {
      // (70 + 90) / 2 = 80
      throw new Error(`Expected average pattern mastery 80, got: ${patternRecord?.mastery}`);
    }
    if (patternRecord.totalProblemsSolved !== 2) {
      throw new Error(`Expected 2 problems solved in pattern, got: ${patternRecord.totalProblemsSolved}`);
    }
  });

  // Test 6: Weak and Strong Pattern Ranking
  await test("UserPatternMasteryRankIndex queries weakest and strongest patterns", async () => {
    const pWeak = "Weak Pattern " + Date.now();
    const pMid = "Mid Pattern " + Date.now();
    const pStrong = "Strong Pattern " + Date.now();

    await patternMasteryRepo.savePatternMastery(userIdA, pWeak, { mastery: 35, totalProblemsAttempted: 1, totalProblemsSolved: 1 });
    await patternMasteryRepo.savePatternMastery(userIdA, pMid, { mastery: 65, totalProblemsAttempted: 1, totalProblemsSolved: 1 });
    await patternMasteryRepo.savePatternMastery(userIdA, pStrong, { mastery: 95, totalProblemsAttempted: 1, totalProblemsSolved: 1 });

    const weak = await patternMasteryRepo.getWeakPatterns(userIdA, 2);
    if (weak.length < 2 || weak[0].mastery > weak[1].mastery) {
      throw new Error("Weak patterns not returned in ascending order");
    }

    const strong = await patternMasteryRepo.getStrongPatterns(userIdA, 2);
    if (strong.length < 2 || strong[0].mastery < strong[1].mastery) {
      throw new Error("Strong patterns not returned in descending order");
    }
  });

  // Test 7: User Isolation
  await test("User isolation: User A's mastery and stats are completely isolated from User B", async () => {
    const statsB = await problemMasteryRepo.getUserStats(userIdB);
    if (statsB.totalSolved !== 0 || statsB.totalMasterySum !== 0) {
      throw new Error(`Isolation breach: User B has non-zero stats: ${JSON.stringify(statsB)}`);
    }

    const masteryB = await problemMasteryRepo.getProblemMastery(userIdB, prob1Id);
    if (masteryB !== null) {
      throw new Error("Isolation breach: User B can read User A's problem mastery");
    }
  });

  console.log("\n==========================================================");
  console.log(`Results: ${passed}/${total} tests passed.`);
  console.log("==========================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runMasteryRepoTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
