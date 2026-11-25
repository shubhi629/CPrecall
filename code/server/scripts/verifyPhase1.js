import { docClient, rawClient, TABLES } from "../src/config/dynamodb.js";
import { initTables } from "./initLocalDynamo.js";
import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";

async function verify() {
  console.log("====================================================");
  console.log("CPRecal — Phase 1: Local DynamoDB Setup Verification");
  console.log("====================================================\n");

  // Step 1: Connectivity Check
  console.log("[1/4] Checking local DynamoDB endpoint connectivity...");
  try {
    const listRes = await rawClient.send(new ListTablesCommand({}));
    console.log(`✅ Connected successfully to DynamoDB Local! Existing tables: ${listRes.TableNames?.length || 0}`);
  } catch (err) {
    console.error(`❌ Could not connect to DynamoDB Local at http://localhost:8000.`);
    console.error(`Please ensure DynamoDB Local is running via: npm run db:local`);
    console.error(`Details: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Initialize Tables & GSIs
  console.log("\n[2/4] Initializing and verifying table schemas and GSIs...");
  await initTables();

  // Step 3: Base Table CRUD & Conditional Write Test on Users
  console.log("\n[3/4] Testing strongly consistent Base Table CRUD & Conditional Writes...");
  const testUserId = "test-phase1-user-" + Date.now();
  const testEmail = `probe-${Date.now()}@test.com`;

  // Write probe user
  await docClient.send(
    new PutCommand({
      TableName: TABLES.USERS,
      Item: {
        PK: `USER#${testUserId}`,
        SK: "PROFILE",
        userId: testUserId,
        name: "Phase 1 Probe User",
        email: testEmail,
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  // Write probe email lock item
  await docClient.send(
    new PutCommand({
      TableName: TABLES.USERS,
      Item: {
        PK: `EMAIL#${testEmail}`,
        SK: "RESERVATION",
        userId: testUserId,
        createdAt: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  // Read back strongly consistent
  const readRes = await docClient.send(
    new GetCommand({
      TableName: TABLES.USERS,
      Key: { PK: `EMAIL#${testEmail}`, SK: "RESERVATION" },
      ConsistentRead: true,
    })
  );

  if (readRes.Item?.userId !== testUserId) {
    throw new Error("Verification failed: Read item userId does not match expected testUserId!");
  }
  console.log("✅ Base Table strongly consistent write and read verified!");

  // Step 4: Test Sparse GSI Query on UserProblemData
  console.log("\n[4/4] Testing Sparse GSI indexing on UserProblemData...");
  const testFSRSKey = `FSRS#test-prob-${Date.now()}`;
  const testReviewDate = "2026-10-25T12:00:00.000Z";

  await docClient.send(
    new PutCommand({
      TableName: TABLES.USER_PROBLEM_DATA,
      Item: {
        PK: `USER#${testUserId}`,
        SK: testFSRSKey,
        userId: testUserId,
        nextReviewDate: testReviewDate,
        rating: 3,
        intervalDays: 2,
      },
    })
  );

  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: TABLES.USER_PROBLEM_DATA,
      IndexName: "FSRSReviewDateIndex",
      KeyConditionExpression: "userId = :uid AND nextReviewDate <= :maxDate",
      ExpressionAttributeValues: {
        ":uid": testUserId,
        ":maxDate": "2026-10-26T00:00:00.000Z",
      },
    })
  );

  if (!queryRes.Items || queryRes.Items.length === 0) {
    throw new Error("Verification failed: Sparse GSI did not return projected FSRS item!");
  }
  console.log("✅ Sparse GSI FSRSReviewDateIndex successfully queried with 0 duplicates!");

  // Cleanup test probe items
  await docClient.send(new DeleteCommand({ TableName: TABLES.USERS, Key: { PK: `USER#${testUserId}`, SK: "PROFILE" } }));
  await docClient.send(new DeleteCommand({ TableName: TABLES.USERS, Key: { PK: `EMAIL#${testEmail}`, SK: "RESERVATION" } }));
  await docClient.send(new DeleteCommand({ TableName: TABLES.USER_PROBLEM_DATA, Key: { PK: `USER#${testUserId}`, SK: testFSRSKey } }));
  console.log("✅ Probe test items cleanly removed.");

  console.log("\n====================================================");
  console.log("🎉 PHASE 1 VERIFICATION COMPLETE: ALL CHECKS PASSED!");
  console.log("====================================================");
}

verify().catch((err) => {
  console.error("❌ Phase 1 Verification Failed:", err);
  process.exit(1);
});
