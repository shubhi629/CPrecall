import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";
import problemRepo from "./problemRepo.js";
import problemMasteryRepo from "./problemMasteryRepo.js";
import progressResetRepo from "./progressResetRepo.js";

/**
 * Pattern Mastery Repository — DynamoDB Implementation
 * Manages user pattern metrics in UserPatternMastery table and rank indexing.
 */
export const patternMasteryRepo = {
  /**
   * Save or upsert a pattern mastery record.
   */
  async savePatternMastery(userId, pattern, masteryData) {
    if (await progressResetRepo.isResetInProgress(userId)) {
      const error = new Error("Cannot save pattern mastery while an account progress reset is in progress.");
      error.statusCode = 409;
      error.code = "RESET_IN_PROGRESS";
      throw error;
    }

    const now = new Date().toISOString();
    const mastery = Math.round(masteryData.mastery || 0);

    const uIdStr = userId.toString();
    const item = {
      PK: `USER#${uIdStr}`,
      SK: `PATTERN#${pattern}`,
      userId: uIdStr,
      pattern,
      totalProblemsAttempted: masteryData.totalProblemsAttempted || 0,
      totalProblemsSolved: masteryData.totalProblemsSolved || 0,
      mastery,
      components: {
        solutionEfficiency: Math.round(masteryData.components?.solutionEfficiency ?? 0),
        timeComplexity: Math.round(masteryData.components?.timeComplexity ?? 0),
        submissionsUntilSuccess: Math.round(masteryData.components?.submissionsUntilSuccess ?? 0),
        timeTaken: Math.round(masteryData.components?.timeTaken ?? 0),
        hintsUsed: Math.round(masteryData.components?.hintsUsed ?? 0),
      },
      updatedAt: now,
    };

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLES.USER_PATTERN_MASTERY,
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
        const error = new Error("Cannot save pattern mastery while an account progress reset is in progress.");
        error.statusCode = 409;
        error.code = "RESET_IN_PROGRESS";
        throw error;
      }
      throw err;
    }

    return item;
  },

  /**
   * Update pattern mastery for a user by aggregating all solved problems with this pattern.
   * Mirrors server/src/services/mastery/patternMastery.js:10-71
   */
  async updatePatternMastery(userId, pattern) {
    if (await progressResetRepo.isResetInProgress(userId)) {
      const error = new Error("Cannot update pattern mastery while an account progress reset is in progress.");
      error.statusCode = 409;
      error.code = "RESET_IN_PROGRESS";
      throw error;
    }

    // 1. Find all problems with this pattern from Problem repo
    const problemsWithPattern = await problemRepo.getProblemsByPattern(pattern);
    const problemIds = problemsWithPattern.map((p) => p.problemId);

    if (problemIds.length === 0) {
      return null;
    }

    // 2. Batch get all problem masteries for this user on these problems
    const problemMasteries = await problemMasteryRepo.batchGetProblemMasteries(userId, problemIds);

    const totalAttempted = problemIds.length;
    const totalSolved = problemMasteries.length;

    // 3. Calculate average mastery
    const avgMastery =
      totalSolved > 0
        ? Math.round(problemMasteries.reduce((sum, pm) => sum + (pm.mastery || 0), 0) / totalSolved)
        : 0;

    // 4. Calculate average components
    const avgComponents = {
      solutionEfficiency: 0,
      timeComplexity: 0,
      submissionsUntilSuccess: 0,
      timeTaken: 0,
      hintsUsed: 0,
    };

    if (totalSolved > 0) {
      Object.keys(avgComponents).forEach((key) => {
        avgComponents[key] = Math.round(
          problemMasteries.reduce((sum, pm) => sum + (pm.components?.[key] || 0), 0) / totalSolved
        );
      });
    }

    // 5. Save updated pattern mastery record
    return this.savePatternMastery(userId, pattern, {
      totalProblemsAttempted: totalAttempted,
      totalProblemsSolved: totalSolved,
      mastery: avgMastery,
      components: avgComponents,
    });
  },

  /**
   * Strongly consistent point lookup for a user's pattern mastery.
   */
  async getPatternMastery(userId, pattern) {
    if (!userId || !pattern) return null;
    const uidStr = userId.toString();

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USER_PATTERN_MASTERY,
        Key: {
          PK: `USER#${uidStr}`,
          SK: `PATTERN#${pattern}`,
        },
        ConsistentRead: true,
      })
    );

    return res.Item || null;
  },

  /**
   * Get all pattern masteries for a user sorted by mastery descending.
   */
  async getUserPatternMasteries(userId) {
    if (!userId) return [];
    const uidStr = userId.toString();

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_PATTERN_MASTERY,
        IndexName: "UserPatternMasteryRankIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": uidStr },
        ScanIndexForward: false, // Descending
      })
    );

    return res.Items || [];
  },

  /**
   * Get weakest patterns for a user (lowest mastery first).
   */
  async getWeakPatterns(userId, limit = 3) {
    if (!userId) return [];
    const uidStr = userId.toString();

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_PATTERN_MASTERY,
        IndexName: "UserPatternMasteryRankIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": uidStr },
        ScanIndexForward: true, // Ascending = weakest first
        Limit: limit,
      })
    );

    return res.Items || [];
  },

  /**
   * Get strongest patterns for a user (highest mastery first).
   */
  async getStrongPatterns(userId, limit = 3) {
    if (!userId) return [];
    const uidStr = userId.toString();

    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLES.USER_PATTERN_MASTERY,
        IndexName: "UserPatternMasteryRankIndex",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": uidStr },
        ScanIndexForward: false, // Descending = strongest first
        Limit: limit,
      })
    );

    return res.Items || [];
  },

  /**
   * Count patterns covered with attempted problems.
   */
  async getPatternsCovered(userId) {
    const patterns = await this.getUserPatternMasteries(userId);
    return patterns.filter((p) => p.totalProblemsAttempted > 0).length;
  },
};

export default patternMasteryRepo;
