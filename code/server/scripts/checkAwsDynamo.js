import dotenv from "dotenv";
dotenv.config();

import { ListTablesCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { rawClient, TABLES } from "../src/config/dynamodb.js";

async function checkAws() {
  console.log("Checking AWS DynamoDB configuration...");
  console.log("Mode:", process.env.DYNAMODB_MODE);
  console.log("Region:", process.env.AWS_REGION);
  console.log("Endpoint:", rawClient.config.endpoint ? await rawClient.config.endpoint() : "AWS Cloud");

  try {
    const listRes = await rawClient.send(new ListTablesCommand({}));
    console.log("Tables in AWS region:", listRes.TableNames);

    for (const [name, tableName] of Object.entries(TABLES)) {
      try {
        const desc = await rawClient.send(new DescribeTableCommand({ TableName: tableName }));
        console.log(`- Table ${tableName}: Status = ${desc.Table?.TableStatus}, BillingMode = ${desc.Table?.BillingModeSummary?.BillingMode || desc.Table?.ProvisionedThroughput?.ReadCapacityUnits + " RCU"}`);
      } catch (err) {
        console.log(`- Table ${tableName}: NOT FOUND or error: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("AWS DynamoDB connection error:", err);
  }
}

checkAws();
