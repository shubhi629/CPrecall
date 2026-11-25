import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure env variables are loaded
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const useCloud =
  (process.env.DYNAMODB_MODE || "").toLowerCase() === "cloud" ||
  process.env.NODE_ENV === "production";
const region = process.env.AWS_REGION || (useCloud ? "ap-south-1" : "local");
const endpoint = useCloud
  ? undefined
  : process.env.DYNAMODB_ENDPOINT || "http://localhost:8000";

// Security Guardrail: Prevent local mode from accidentally misconfiguring endpoint
if (!useCloud) {
  if (!endpoint || (!endpoint.includes("localhost") && !endpoint.includes("127.0.0.1"))) {
    throw new Error(
      `[SECURITY ERROR] In local mode, DYNAMODB_ENDPOINT must point to localhost! Current endpoint: ${endpoint}`
    );
  }
}

// Credentials handling
const credentials = useCloud
  ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  : {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "fakeLocalKey",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "fakeLocalSecret",
    };

export const rawClient = new DynamoDBClient({
  region,
  endpoint,
  credentials,
});

export const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

// Authoritative Table Names
export const TABLES = {
  USERS: process.env.DYNAMO_TABLE_USERS || "CPRecal_Users",
  PROBLEMS: process.env.DYNAMO_TABLE_PROBLEMS || "CPRecal_Problems",
  USER_PROBLEM_DATA: process.env.DYNAMO_TABLE_USER_PROBLEM_DATA || "CPRecal_UserProblemData",
  USER_PATTERN_MASTERY: process.env.DYNAMO_TABLE_USER_PATTERN_MASTERY || "CPRecal_UserPatternMastery",
  USER_ACTIVITY: process.env.DYNAMO_TABLE_USER_ACTIVITY || "CPRecal_UserActivity",
};

export default docClient;
