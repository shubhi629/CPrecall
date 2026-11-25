import {
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchGetCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

/**
 * Problem Mastery Repository — DynamoDB Implementation
 * Manages user-level problem mastery records in UserProblemData table
 * and maintains atomic UserStats counters.
 */
export const problemMasteryRepo = {
  /**
   * Save or update problem mastery and atomically update UserStats.
   * Concurrency-safe: correctly handles first solve vs re-solve.
   */
  async saveProblemMastery(userId, problemId, masteryData) {
    const now = new Date().toISOString();
    const masteryScore = Math.round(masteryData.mastery || 0);

    // 1. Check if problem mastery already exists for this user + problem
    const existingMastery = await this.getProblemMastery(userId, problemId);
    const isFirstSolve = !existingMastery;
    const oldScore = existingMastery ? existingMastery.mastery || 0 : 0;
    const scoreDiff = masteryScore - oldScore;

    const uIdStr = userId.toString();
    const pIdStr = problemId.toString();

    const masteryItem = {
      PK: `USER#${uIdStr}`,
      SK: `MASTERY#${pIdStr}`,
      userId: uIdStr,
      problemId: pIdStr,
      solvingSessionId: masteryData.solvingSessionId?.toString() || null,
      acceptedSubmissionId: masteryData.acceptedSubmissionId?.toString() || null,
      totalSubmissions: masteryData.totalSubmissions || 1,
      solvedAt: masteryData.solvedAt || now,
      components: {
        solutionEfficiency: Math.round(masteryData.components?.solutionEfficiency ?? 0),
        timeComplexity: Math.round(masteryData.components?.timeComplexity ?? 0),
        submissionsUntilSuccess: Math.round(masteryData.components?.submissionsUntilSuccess ?? 0),
        timeTaken: Math.round(masteryData.components?.timeTaken ?? 0),
        hintsUsed: Math.round(masteryData.components?.hintsUsed ?? 0),
      },
      mastery: masteryScore,
      hintsUsedCount: masteryData.hintsUsedCount || 0,
      totalTimeSeconds: masteryData.totalTimeSeconds || 0,
      updatedAt: now,
    };

    // 2. Transact write mastery item + UserStats atomic update
    const statsUpdateExpression = isFirstSolve
      ? "ADD totalSolved :one, totalMasterySum :scoreDiff SET updatedAt = :now"
      : "ADD totalMasterySum :scoreDiff SET updatedAt = :now";

    const statsExprValues = isFirstSolve
      ? { ":one": 1, ":scoreDiff": scoreDiff, ":now": now, ":inProgress": "IN_PROGRESS" }
      : { ":scoreDiff": scoreDiff, ":now": now, ":inProgress": "IN_PROGRESS" };

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLES.USER_PROBLEM_DATA,
                Item: masteryItem,
              },
            },
            {
              Update: {
                TableName: TABLES.USER_PROBLEM_DATA,
                Key: {
                  PK: `USER#${uIdStr}`,
                  SK: "STATS",
                },
                UpdateExpression: statsUpdateExpression,
                ConditionExpression: "attribute_not_exists(resetStatus) OR resetStatus <> :inProgress",
                ExpressionAttributeValues: statsExprValues,
              },
            },
          ],
        })
      );
    } catch (err) {
      if (err.name === "TransactionCanceledException") {
        const error = new Error("Cannot save problem solution while an account progress reset is in progress.");
        error.statusCode = 409;
        error.code = "RESET_IN_PROGRESS";
        throw error;
      }
      throw err;
    }

    return masteryItem;
  },

  /**
   * Strongly consistent point lookup for a user's problem mastery.
   */
  async getProblemMastery(userId, problemId) {
    if (!userId || !problemId) return null;
    const uidStr = userId.toString();

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: {
          PK: `USER#${uidStr}`,
          SK: `MASTERY#${problemId.toString()}`,
        },
        ConsistentRead: true,
      })
    );

    return res.Item || null;
  },

  /**
   * Batch get multiple problem masteries for a user.
   */
  async batchGetProblemMasteries(userId, problemIds) {
    if (!userId || !problemIds || problemIds.length === 0) return [];
    const uidStr = userId.toString();

    const uniqueIds = Array.from(new Set(problemIds.filter(Boolean)));
    const results = [];
    const CHUNK_SIZE = 100;

    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
      const keys = chunk.map((id) => ({
        PK: `USER#${uidStr}`,
        SK: `MASTERY#${id.toString()}`,
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
   * Get all solved problem IDs and mastery scores for a user
   * using the ProblemMasteryScoreIndex.
   */
  async getUserSolvedProblems(userId) {
    if (!userId) return [];
    const uidStr = userId.toString();

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        IndexName: "ProblemMasteryScoreIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": uidStr },
        ScanIndexForward: false, // Highest mastery first
      })
    );

    return (res.Items || []).map((item) => ({
      problemId: item.problemId,
      mastery: item.mastery,
      solvedAt: item.solvedAt,
    }));
  },

  /**
   * Get UserStats aggregator (totalSolved, totalAttempted, totalMasterySum, averageMastery)
   * Runs in a single point lookup (<2ms, 1 RCU).
   */
  async getUserStats(userId) {
    if (!userId) {
      return { totalSolved: 0, totalAttempted: 0, averageMastery: 0, patternsCovered: 0 };
    }
    const uidStr = userId.toString();

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: {
          PK: `USER#${uidStr}`,
          SK: "STATS",
        },
        ConsistentRead: true,
      })
    );

    const stats = res.Item || {};
    const totalSolved = stats.totalSolved || 0;
    const totalAttempted = stats.totalAttempted || 0;
    const totalMasterySum = stats.totalMasterySum || 0;
    const patternsCovered = stats.patternsCovered || 0;
    const averageMastery = totalSolved > 0 ? Math.round(totalMasterySum / totalSolved) : 0;

    return {
      totalSolved,
      totalAttempted,
      totalMasterySum,
      averageMastery,
      patternsCovered,
      resetVersion: stats.resetVersion || 0,
      resetStatus: stats.resetStatus || "IDLE",
      lastResetAt: stats.lastResetAt,
      // demoLibrarySize removed — QA-only override, not needed in production
    };
  },

  /**
   * Atomically increment totalAttempted counter on UserStats.
   */
  async incrementUserAttempted(userId) {
    const now = new Date().toISOString();
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: {
            PK: `USER#${userId}`,
            SK: "STATS",
          },
          UpdateExpression: "ADD totalAttempted :one SET updatedAt = :now",
          ConditionExpression: "attribute_not_exists(resetStatus) OR resetStatus <> :inProgress",
          ExpressionAttributeValues: {
            ":one": 1,
            ":now": now,
            ":inProgress": "IN_PROGRESS",
          },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return; // Suppress increment during active reset
      }
      throw err;
    }
  },

  /**
   * Calculate average mastery for user (matches getUserAverageMastery in problemMastery.js).
   */
  async getUserAverageMastery(userId) {
    const stats = await this.getUserStats(userId);
    return {
      average: stats.averageMastery,
      count: stats.totalSolved,
    };
  },
};

export default problemMasteryRepo;
