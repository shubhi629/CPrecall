import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

/**
 * Review History Repository — DynamoDB Implementation
 * Records historical review events in UserActivity table.
 */
export const reviewHistoryRepo = {
  /**
   * Log a review event.
   */
  async createReviewHistory(reviewData) {
    const userId = reviewData.userId;
    const problemId = reviewData.problemId.toString();
    const reviewedAt = typeof reviewData.reviewedAt === "string" ? reviewData.reviewedAt : (reviewData.reviewedAt?.toISOString() || new Date().toISOString());
    const now = new Date().toISOString();

    const uIdStr = userId.toString();
    const pIdStr = problemId.toString();

    const item = {
      PK: `USER#${uIdStr}`,
      SK: `REVIEW#${reviewedAt}#${pIdStr}`,
      userId: uIdStr,
      problemId: pIdStr,
      reviewedAt,
      previousMastery: reviewData.previousMastery ?? null,
      newMastery: reviewData.newMastery,
      fsrsRating: reviewData.fsrsRating,
      status: reviewData.status || "completed",
      satisfiedByProblemId: reviewData.satisfiedByProblemId?.toString() || null,
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
   * Get historical review records for a user, newest first.
   */
  async getUserReviewHistory(userId, limit = 50) {
    if (!userId) return [];

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_ACTIVITY,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":prefix": "REVIEW#",
        },
        ScanIndexForward: false, // Newest first
        Limit: limit,
      })
    );

    return res.Items || [];
  },
};

export default reviewHistoryRepo;
