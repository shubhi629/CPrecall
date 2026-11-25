import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

/**
 * Solving Session Repository — DynamoDB Implementation
 * Records solving sessions in UserActivity with conditional deduplication.
 */
export const solvingSessionRepo = {
  /**
   * Record a solving session idempotently.
   */
  async createSession(sessionData) {
    const userId = sessionData.userId;
    const sessionId = sessionData.sessionId || sessionData._id?.toString() || uuidv4();
    const problemId = sessionData.problemId.toString();
    const startTime = typeof sessionData.startTime === "string" ? sessionData.startTime : sessionData.startTime.toISOString();
    const endTime = typeof sessionData.endTime === "string" ? sessionData.endTime : sessionData.endTime.toISOString();
    const totalTimeSeconds = sessionData.totalTimeSeconds || Math.round((new Date(endTime) - new Date(startTime)) / 1000);
    const now = new Date().toISOString();

    const uIdStr = userId.toString();

    const item = {
      PK: `USER#${uIdStr}`,
      SK: `SESSION#${startTime}#${sessionId}`,
      userId: uIdStr,
      sessionId,
      _id: sessionId,
      problemId,
      startTime,
      endTime,
      totalTimeSeconds,
      createdAt: now,
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLES.USER_ACTIVITY,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK)",
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        // Idempotent duplicate: already recorded, return existing item
        return item;
      }
      throw err;
    }

    return item;
  },

  /**
   * Get all sessions for a user.
   */
  async getUserSessions(userId, limit = 50) {
    if (!userId) return [];

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_ACTIVITY,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":prefix": "SESSION#",
        },
        ScanIndexForward: false, // Newest first
        Limit: limit,
      })
    );

    return res.Items || [];
  },
};

export default solvingSessionRepo;
