import {
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchGetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";
import progressResetRepo from "./progressResetRepo.js";

/**
 * FSRS State Repository — DynamoDB Implementation
 * Manages spaced repetition timer state in UserProblemData
 * and powers chronological due review queries via FSRSReviewDateIndex.
 */
export const fsrsStateRepo = {
  /**
   * Save or update FSRS state for a problem.
   */
  async saveFSRSState(userId, problemId, data) {
    if (await progressResetRepo.isResetInProgress(userId)) {
      const error = new Error("Cannot save FSRS state while an account progress reset is in progress.");
      error.statusCode = 409;
      error.code = "RESET_IN_PROGRESS";
      throw error;
    }

    const now = new Date().toISOString();
    const pIdStr = problemId.toString();

    const existing = await this.getFSRSState(userId, pIdStr);
    const reviewHistory = existing?.reviewHistory ? [...existing.reviewHistory] : [];

    if (data.newReview) {
      reviewHistory.push({
        reviewedAt: now,
        rating: data.rating,
        intervalBefore: existing?.intervalDays || 0,
      });
    }

    const uIdStr = userId.toString();
    const item = {
      PK: `USER#${uIdStr}`,
      SK: `FSRS#${pIdStr}`,
      userId: uIdStr,
      problemId: pIdStr,
      rating: data.rating,
      nextReviewDate: typeof data.nextReviewDate === "string" ? data.nextReviewDate : data.nextReviewDate.toISOString(),
      intervalDays: data.intervalDays,
      easeFactor: data.easeFactor ?? 2.5,
      reviewHistory,
      updatedAt: now,
    };

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLES.USER_PROBLEM_DATA,
                Item: item,
              },
            },
            {
              ConditionCheck: {
                TableName: TABLES.USER_PROBLEM_DATA,
                Key: {
                  PK: `USER#${uIdStr}`,
                  SK: "STATS",
                },
                ConditionExpression: "attribute_not_exists(resetStatus) OR resetStatus <> :inProgress",
                ExpressionAttributeValues: {
                  ":inProgress": "IN_PROGRESS",
                },
              },
            },
          ],
        })
      );
    } catch (err) {
      if (err.name === "TransactionCanceledException") {
        const error = new Error("Cannot save FSRS state while an account progress reset is in progress.");
        error.statusCode = 409;
        error.code = "RESET_IN_PROGRESS";
        throw error;
      }
      throw err;
    }

    return item;
  },

  /**
   * Point lookup for FSRS state.
   */
  async getFSRSState(userId, problemId) {
    if (!userId || !problemId) return null;
    const uidStr = userId.toString();

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: {
          PK: `USER#${uidStr}`,
          SK: `FSRS#${problemId.toString()}`,
        },
        ConsistentRead: true,
      })
    );

    return res.Item || null;
  },

  /**
   * Batch get multiple FSRS states for a user.
   */
  async batchGetFSRSStates(userId, problemIds) {
    if (!userId || !problemIds || problemIds.length === 0) return [];
    const uidStr = userId.toString();

    const uniqueIds = Array.from(new Set(problemIds.filter(Boolean)));
    const results = [];
    const CHUNK_SIZE = 100;

    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
      const keys = chunk.map((id) => ({
        PK: `USER#${uidStr}`,
        SK: `FSRS#${id.toString()}`,
      }));

      const res = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [TABLES.USER_PROBLEM_DATA]: {
              Keys: keys,
              ConsistentRead: true,
            },
          },
        })
      );

      if (res.Responses && res.Responses[TABLES.USER_PROBLEM_DATA]) {
        results.push(...res.Responses[TABLES.USER_PROBLEM_DATA]);
      }
    }

    return results;
  },

  /**
   * Get all due/overdue reviews for a user in chronological order.
   * Query runs on sparse GSI FSRSReviewDateIndex (Zero scans!).
   */
  async getDueReviews(userId, maxDateIso = null) {
    if (!userId) return [];
    const uidStr = userId.toString();

    const limitDate = maxDateIso || new Date().toISOString();

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        IndexName: "FSRSReviewDateIndex",
        KeyConditionExpression: "userId = :uid AND nextReviewDate < :limitDate",
        ExpressionAttributeValues: {
          ":uid": uidStr,
          ":limitDate": limitDate,
        },
        ScanIndexForward: true, // Chronological: oldest overdue first
      })
    );

    return res.Items || [];
  },

  /**
   * Get all future scheduled reviews (nextReviewDate >= minDateIso)
   */
  async getFutureScheduledReviews(userId, minDateIso) {
    if (!userId) return [];
    const uidStr = userId.toString();

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        IndexName: "FSRSReviewDateIndex",
        KeyConditionExpression: "userId = :uid AND nextReviewDate >= :minDate",
        ExpressionAttributeValues: {
          ":uid": uidStr,
          ":minDate": minDateIso,
        },
        ScanIndexForward: true,
      })
    );

    return res.Items || [];
  },

  /**
   * Update FSRS state after user completes or skips a review.
   * Mirrors scheduler.js:113-162 logic.
   */
  async updateAfterReview(userId, problemId, reviewStatus) {
    if (await progressResetRepo.isResetInProgress(userId)) {
      const error = new Error("Cannot update review interval while an account progress reset is in progress.");
      error.statusCode = 409;
      error.code = "RESET_IN_PROGRESS";
      throw error;
    }

    const existing = await this.getFSRSState(userId, problemId);
    if (!existing) {
      throw new Error("FSRS state not found");
    }

    let newRating = existing.rating;
    let newIntervalDays = existing.intervalDays;
    let newEaseFactor = existing.easeFactor || 2.5;

    if (reviewStatus === "completed") {
      newIntervalDays = Math.ceil(existing.intervalDays * newEaseFactor);
      newEaseFactor = Math.min(2.5, newEaseFactor + 0.1);
    } else if (reviewStatus === "failed") {
      newIntervalDays = 1;
      newEaseFactor = Math.max(1.3, newEaseFactor - 0.2);
    } else if (reviewStatus === "skipped") {
      newIntervalDays = 1;
    }

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + newIntervalDays);

    return this.saveFSRSState(userId, problemId, {
      rating: newRating,
      intervalDays: newIntervalDays,
      easeFactor: newEaseFactor,
      nextReviewDate: nextDate.toISOString(),
      newReview: true,
    });
  },
};

export default fsrsStateRepo;
