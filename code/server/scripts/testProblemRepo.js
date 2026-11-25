import problemRepo from "../src/repositories/problemRepo.js";
import { initTables } from "./initLocalDynamo.js";
import { rawClient, TABLES } from "../src/config/dynamodb.js";
import { QueryCommand } from "@aws-sdk/client-dynamodb";

async function runProblemRepoTests() {
  console.log("====================================================");
  console.log("CPRecal — Group 2: Problem Repository Test Suite");
  console.log("====================================================\n");

  await initTables();
  problemRepo.resetMemoryCatalog();

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

  const runSuffix = Date.now();
  const p1Id = "probe-prob-1-" + runSuffix;
  const p2Id = "probe-prob-2-" + runSuffix;
  const p3Id = "probe-prob-3-" + runSuffix;
  const leetcodeId1 = Math.floor(10000 + Math.random() * 80000);
  const slug1 = "climbing-stairs-probe-" + runSuffix;

  // Test 1: Create Problem with Pattern Adjacency Items
  await test("Create problem with metadata and pattern adjacency items", async () => {
    const created = await problemRepo.createOrUpdateProblem({
      problemId: p1Id,
      leetcodeId: leetcodeId1,
      title: "Climbing Stairs Probe " + runSuffix,
      titleSlug: slug1,
      difficulty: "Easy",
      patterns: ["Dynamic Programming", "Math & Geometry"],
      description: "You are climbing a staircase.",
    });

    if (created.problemId !== p1Id) {
      throw new Error("Created problem does not match input");
    }
  });

  // Test 2: Point & GSI Lookups
  await test("Lookup by problemId, leetcodeId, and titleSlug", async () => {
    const byId = await problemRepo.getProblemById(p1Id);
    if (!byId || byId.titleSlug !== slug1) {
      throw new Error("Point lookup by ID failed");
    }

    const byLeetcode = await problemRepo.getProblemByLeetcodeId(leetcodeId1);
    if (!byLeetcode || byLeetcode.problemId !== p1Id) {
      throw new Error("GSI lookup by leetcodeId failed");
    }

    const bySlug = await problemRepo.getProblemBySlug(slug1);
    if (!bySlug || bySlug.leetcodeId !== leetcodeId1) {
      throw new Error("GSI lookup by titleSlug failed");
    }
  });

  // Test 3: Pattern & Difficulty Index Query (Zero Scans)
  await test("PatternDifficultyIndex query retrieves pattern items with zero scans", async () => {
    // Add two more test problems
    await problemRepo.createOrUpdateProblem({
      problemId: p2Id,
      leetcodeId: 9902,
      title: "House Robber Probe",
      titleSlug: "house-robber-probe",
      difficulty: "Medium",
      patterns: ["Dynamic Programming"],
    });

    await problemRepo.createOrUpdateProblem({
      problemId: p3Id,
      leetcodeId: 9903,
      title: "Two Sum Probe",
      titleSlug: "two-sum-probe",
      difficulty: "Easy",
      patterns: ["Arrays & Hashing"],
    });

    const dpEasy = await problemRepo.getProblemsByPattern("Dynamic Programming", { difficulty: "Easy" });
    if (dpEasy.length === 0 || !dpEasy.some((p) => p.problemId === p1Id)) {
      throw new Error(`Expected DP Easy problem ${p1Id} not found in results: ${JSON.stringify(dpEasy)}`);
    }

    const dpMedium = await problemRepo.getProblemsByPattern("Dynamic Programming", { difficulty: "Medium" });
    if (dpMedium.length === 0 || !dpMedium.some((p) => p.problemId === p2Id)) {
      throw new Error(`Expected DP Medium problem ${p2Id} not found in results: ${JSON.stringify(dpMedium)}`);
    }
  });

  // Test 4: Deduplication Verification on DifficultyIndex
  await test("Strict GSI sparsity check: DifficultyIndex contains ZERO duplicate rows", async () => {
    // Query raw DifficultyIndex for 'Easy' problems
    const rawRes = await rawClient.send(
      new QueryCommand({
        TableName: TABLES.PROBLEMS,
        IndexName: "DifficultyIndex",
        KeyConditionExpression: "difficulty = :d",
        ExpressionAttributeValues: { ":d": { S: "Easy" } },
      })
    );

    const items = rawRes.Items || [];
    const p1Items = items.filter((item) => item.problemId?.S === p1Id);

    // Problem 1 has 2 patterns ("Dynamic Programming" & "Math & Geometry").
    // If adjacency items were projected into DifficultyIndex, p1Items.length would be 3 (1 meta + 2 adjacency)!
    // With our strict attribute isolation, p1Items.length MUST BE EXACTLY 1!
    if (p1Items.length !== 1) {
      throw new Error(
        `DUPLICATION DEFECT: Problem ${p1Id} appeared ${p1Items.length} times in DifficultyIndex! Expected exactly 1.`
      );
    }
  });

  // Test 5: Pagination & Multi-dimensional Filtering
  await test("Problem library pagination & filtering preserves existing controller contract", async () => {
    // Query all Easy problems
    const paginatedRes = await problemRepo.getProblemsPaginated({
      difficulty: "Easy",
      limit: 10,
      offset: 0,
    });

    if (paginatedRes.total < 2) {
      throw new Error(`Expected at least 2 easy problems, got total: ${paginatedRes.total}`);
    }

    // Query text search
    const searchRes = await problemRepo.getProblemsPaginated({
      search: "Stairs",
      limit: 10,
      offset: 0,
    });

    if (searchRes.problems.length === 0 || !searchRes.problems[0].title.includes("Stairs")) {
      throw new Error("Search filter failed to match title");
    }

    // Query numeric search
    const numSearchRes = await problemRepo.getProblemsPaginated({
      search: "#9902",
      limit: 10,
      offset: 0,
    });

    if (numSearchRes.problems.length === 0 || numSearchRes.problems[0].leetcodeId !== 9902) {
      throw new Error("Numeric search filter failed to match leetcodeId");
    }

    // Status filter
    const statusRes = await problemRepo.getProblemsPaginated({
      status: "solved",
      solvedProblemIds: [p1Id],
      limit: 10,
      offset: 0,
    });

    if (statusRes.problems.length !== 1 || statusRes.problems[0].problemId !== p1Id) {
      throw new Error("Solved status filter failed to match solvedProblemIds");
    }
  });

  // Test 6: Batch Get Problems
  await test("BatchGetCommand retrieves multiple problems by IDs", async () => {
    const batch = await problemRepo.batchGetProblems([p1Id, p2Id, "non-existent-id"]);
    if (batch.length !== 2) {
      throw new Error(`Expected 2 items in batch, got: ${batch.length}`);
    }
  });

  // Test 7: Bulk Upserting
  await test("bulkUpsertProblems handles multi-item batches cleanly", async () => {
    const bulkData = Array.from({ length: 15 }, (_, i) => ({
      leetcodeId: 10000 + i,
      title: `Bulk Test Problem ${i}`,
      titleSlug: `bulk-test-problem-${i}`,
      difficulty: i % 2 === 0 ? "Easy" : "Hard",
      patterns: ["Graphs", "Backtracking"],
    }));

    const count = await problemRepo.bulkUpsertProblems(bulkData);
    // 15 problems with 2 patterns each = 15 meta + 30 adjacency = 45 records
    if (count < 45) {
      throw new Error(`Expected at least 45 records written, got: ${count}`);
    }
  });

  console.log("\n====================================================");
  console.log(`Results: ${passed}/${total} tests passed.`);
  console.log("====================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runProblemRepoTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
