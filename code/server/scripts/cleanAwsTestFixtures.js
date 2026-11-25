import dotenv from "dotenv";
dotenv.config();

import { ScanCommand, BatchWriteCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../src/config/dynamodb.js";

async function cleanTestFixtures() {
  console.log("=== CPRecal: Cleaning Test Fixtures from AWS DynamoDB ===");

  // 1. Clean test problems from CPRecal_Problems
  const probScan = await docClient.send(
    new ScanCommand({
      TableName: TABLES.PROBLEMS,
      FilterExpression: "begins_with(PK, :scale) OR begins_with(SK, :scale)",
      ExpressionAttributeValues: {
        ":scale": "PROBLEM#aws_scale_p",
      },
    })
  );

  console.log(`Found ${probScan.Items?.length || 0} scale test items in ${TABLES.PROBLEMS}. Deleting...`);
  if (probScan.Items && probScan.Items.length > 0) {
    for (const item of probScan.Items) {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLES.PROBLEMS,
          Key: { PK: item.PK, SK: item.SK },
        })
      );
    }
    console.log("✅ Scale problem fixtures cleaned.");
  }

  // 2. Clean test users from CPRecal_Users
  const userScan = await docClient.send(
    new ScanCommand({
      TableName: TABLES.USERS,
      FilterExpression: "begins_with(email, :alpha) OR begins_with(email, :beta) OR begins_with(email, :scale) OR begins_with(email, :test)",
      ExpressionAttributeValues: {
        ":alpha": "user_alpha_",
        ":beta": "user_beta_",
        ":scale": "aws_scale_",
        ":test": "test-reset-user-",
      },
    })
  );

  console.log(`Found ${userScan.Items?.length || 0} test user items in ${TABLES.USERS}. Deleting...`);
  if (userScan.Items && userScan.Items.length > 0) {
    for (const item of userScan.Items) {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLES.USERS,
          Key: { PK: item.PK, SK: item.SK },
        })
      );
    }
    console.log("✅ Test user fixtures cleaned.");
  }

  console.log("=== Cleanup Complete ===\n");
}

cleanTestFixtures().catch((err) => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
