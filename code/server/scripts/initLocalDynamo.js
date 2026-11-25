import {
  CreateTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { rawClient, TABLES } from "../src/config/dynamodb.js";

const tableDefinitions = [
  // 1. Users Table
  {
    TableName: TABLES.USERS,
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },

  // 2. Problems Table
  {
    TableName: TABLES.PROBLEMS,
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "leetcodeId", AttributeType: "N" },
      { AttributeName: "titleSlug", AttributeType: "S" },
      { AttributeName: "difficulty", AttributeType: "S" },
      { AttributeName: "title", AttributeType: "S" },
      { AttributeName: "patternGSI_PK", AttributeType: "S" },
      { AttributeName: "patternGSI_SK", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "LeetcodeIdIndex",
        KeySchema: [{ AttributeName: "leetcodeId", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "TitleSlugIndex",
        KeySchema: [{ AttributeName: "titleSlug", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "DifficultyIndex",
        KeySchema: [
          { AttributeName: "difficulty", KeyType: "HASH" },
          { AttributeName: "title", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "PatternDifficultyIndex",
        KeySchema: [
          { AttributeName: "patternGSI_PK", KeyType: "HASH" },
          { AttributeName: "patternGSI_SK", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },

  // 3. UserProblemData Table
  {
    TableName: TABLES.USER_PROBLEM_DATA,
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "nextReviewDate", AttributeType: "S" },
      { AttributeName: "mastery", AttributeType: "N" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "FSRSReviewDateIndex",
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "nextReviewDate", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "ProblemMasteryScoreIndex",
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "mastery", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },

  // 4. UserPatternMastery Table
  {
    TableName: TABLES.USER_PATTERN_MASTERY,
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "mastery", AttributeType: "N" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "UserPatternMasteryRankIndex",
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "mastery", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },

  // 5. UserActivity Table
  {
    TableName: TABLES.USER_ACTIVITY,
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "sessionId", AttributeType: "S" },
      { AttributeName: "timestamp", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "SessionIdIndex",
        KeySchema: [
          { AttributeName: "sessionId", KeyType: "HASH" },
          { AttributeName: "timestamp", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
];

export async function initTables() {
  console.log("=== CPRecal: Provisioning DynamoDB Tables & Indexes ===");

  const existingTablesResponse = await rawClient.send(new ListTablesCommand({}));
  const existingTables = new Set(existingTablesResponse.TableNames || []);

  for (const tableDef of tableDefinitions) {
    if (existingTables.has(tableDef.TableName)) {
      console.log(`ℹ️  Table already exists: ${tableDef.TableName}`);
      continue;
    }

    console.log(`Creating table: ${tableDef.TableName}...`);
    try {
      await rawClient.send(new CreateTableCommand(tableDef));
      console.log(`✅ Table created: ${tableDef.TableName}`);
    } catch (err) {
      console.error(`❌ Failed to create table ${tableDef.TableName}:`, err.message);
      throw err;
    }
  }

  console.log("\n=== Verifying All 5 Tables & Indexes ===");
  for (const tableDef of tableDefinitions) {
    let status = "CREATING";
    let desc = null;
    while (status !== "ACTIVE") {
      desc = await rawClient.send(
        new DescribeTableCommand({ TableName: tableDef.TableName })
      );
      status = desc.Table.TableStatus;
      if (status !== "ACTIVE") {
        console.log(`- ${tableDef.TableName}: Status is ${status}, waiting 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const gsiCount = desc.Table.GlobalSecondaryIndexes?.length || 0;
    console.log(`- ${tableDef.TableName}: Status = ${status}, GSIs = ${gsiCount}`);
  }

  console.log("\n✅ All DynamoDB tables and GSIs are active and verified!");
}

// Allow direct execution
if (process.argv[1]?.endsWith("initLocalDynamo.js")) {
  initTables().catch((err) => {
    console.error("Initialization failed:", err);
    process.exit(1);
  });
}
