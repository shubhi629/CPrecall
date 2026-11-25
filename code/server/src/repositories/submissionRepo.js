import { v4 as uuidv4 } from "uuid";
import { PutCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

/**
 * Submission Repository — DynamoDB Implementation
 * Records individual attempt records in UserActivity table and indexes them by session.
 */
export const submissionRepo = {
  /**
   * Record a single submission attempt.
   */
  async createSubmission(subData) {
    const userId = subData.userId;
    const sessionId = subData.sessionId.toString();
    const problemId = subData.problemId.toString();
    const submissionId = subData.submissionId?.toString() || uuidv4();
    const timestamp = typeof subData.timestamp === "string" ? subData.timestamp : subData.timestamp.toISOString();
    const now = new Date().toISOString();

    const item = {
      PK: `USER#${userId}`,
      SK: `SUBMISSION#${sessionId}#${timestamp}#${submissionId}`,
      userId,
      problemId,
      sessionId,
      submissionId,
      _id: submissionId,
      status: subData.status,
      runtime: subData.runtime ?? null,
      memory: subData.memory ?? null,
      language: subData.language || "unknown",
      timestamp,
      createdAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLES.USER_ACTIVITY,
        Item: item,
      })
    );

    return item;
  },

  /**
   * Batch create multiple submissions idempotently using BatchWriteCommand chunks of 25.
   */
  async batchCreateSubmissions(userId, submissionsArray) {
    if (!submissionsArray || submissionsArray.length === 0) return [];

    const now = new Date().toISOString();
    const items = submissionsArray.map((sub) => {
      const sessionId = sub.sessionId.toString();
      const problemId = sub.problemId.toString();
      const submissionId = sub.submissionId?.toString() || uuidv4();
      const timestamp = typeof sub.timestamp === "string" ? sub.timestamp : sub.timestamp.toISOString();

      return {
        PK: `USER#${userId}`,
        SK: `SUBMISSION#${sessionId}#${timestamp}#${submissionId}`,
        userId,
        problemId,
        sessionId,
        submissionId,
        _id: submissionId,
        status: sub.status,
        runtime: sub.runtime ?? null,
        memory: sub.memory ?? null,
        language: sub.language || "unknown",
        timestamp,
        createdAt: now,
      };
    });

    const CHUNK_SIZE = 25;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const writeRequests = chunk.map((item) => ({
        PutRequest: { Item: item },
      }));

      let attempts = 0;
      let unprocessed = { [TABLES.USER_ACTIVITY]: writeRequests };

      while (unprocessed && Object.keys(unprocessed).length > 0 && attempts < 5) {
        const res = await docClient.send(
          new BatchWriteCommand({
            RequestItems: unprocessed,
          })
        );
        unprocessed = res.UnprocessedItems;
        if (unprocessed && Object.keys(unprocessed).length > 0) {
          attempts++;
          await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 50));
        }
      }
    }

    return items;
  },

  /**
   * Get all submissions for a session using SessionIdIndex.
   */
  async getSubmissionsBySession(sessionId) {
    if (!sessionId) return [];

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_ACTIVITY,
        IndexName: "SessionIdIndex",
        KeyConditionExpression: "sessionId = :sid",
        ExpressionAttributeValues: {
          ":sid": sessionId.toString(),
        },
        ScanIndexForward: true, // Chronological
      })
    );

    return res.Items || [];
  },
};

export default submissionRepo;
