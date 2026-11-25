import { v4 as uuidv4 } from "uuid";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLES } from "../config/dynamodb.js";

/**
 * Progress Reset Repository — DynamoDB Implementation
 * Handles concurrency-safe progress reset, 25-item chunked batch deletions with retries,
 * verification gates, and cycle-aware completion dismissal storage.
 */
export const progressResetRepo = {
  /**
   * Acquire an atomic lock to execute a progress reset for a user.
   * Throws 409 if a reset is already in progress and the lease has not expired.
   * Lease expires after 60 seconds to prevent permanent deadlocks on unexpected worker crash.
   */
  async acquireResetLock(userId, leaseDurationMs = Number(process.env.RESET_LOCK_LEASE_MS) || 60000) {
    const uidStr = userId.toString();
    const now = new Date();
    const nowIso = now.toISOString();
    const staleThreshold = new Date(now.getTime() - leaseDurationMs).toISOString(); // Default 60s lease
    const resetToken = uuidv4();

    try {
      const res = await docClient.send(
        new UpdateCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: {
            PK: `USER#${uidStr}`,
            SK: "STATS",
          },
          UpdateExpression: `
            SET resetStatus = :inProgress,
                resetToken = :token,
                resetLockTimestamp = :nowIso,
                resetVersion = if_not_exists(resetVersion, :zero) + :one,
                updatedAt = :nowIso
          `,
          ConditionExpression: `
            attribute_not_exists(resetStatus) OR
            resetStatus <> :inProgress OR
            resetLockTimestamp < :staleThreshold
          `,
          ExpressionAttributeValues: {
            ":inProgress": "IN_PROGRESS",
            ":token": resetToken,
            ":nowIso": nowIso,
            ":staleThreshold": staleThreshold,
            ":zero": 0,
            ":one": 1,
          },
          ReturnValues: "ALL_NEW",
        })
      );

      return {
        acquired: true,
        resetToken,
        resetVersion: res.Attributes?.resetVersion || 1,
      };
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        const error = new Error("A progress reset is already in progress for this account. Please wait a moment.");
        error.statusCode = 409;
        error.code = "RESET_IN_PROGRESS";
        throw error;
      }
      throw err;
    }
  },

  /**
   * Check if a reset is currently in progress for this user (used to guard concurrent solving).
   */
  async isResetInProgress(userId, leaseDurationMs = Number(process.env.RESET_LOCK_LEASE_MS) || 60000) {
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

    const stats = res.Item;
    if (!stats) return false;

    if (stats.resetStatus === "IN_PROGRESS") {
      const now = Date.now();
      const lockTime = new Date(stats.resetLockTimestamp || 0).getTime();
      return now - lockTime < leaseDurationMs;
    }

    return false;
  },

  /**
   * Query all active problem mastery keys for a user (PK = USER#<id>, SK begins_with MASTERY#).
   */
  async queryAllUserMasteryKeys(userId) {
    const uidStr = userId.toString();
    const keys = [];
    let lastEvaluatedKey = undefined;

    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": `USER#${uidStr}`,
            ":skPrefix": "MASTERY#",
          },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: lastEvaluatedKey,
          ConsistentRead: true,
        })
      );

      if (res.Items) {
        for (const item of res.Items) {
          keys.push({ PK: item.PK, SK: item.SK });
        }
      }
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return keys;
  },

  /**
   * Query all active FSRS state keys for a user (PK = USER#<id>, SK begins_with FSRS#).
   */
  async queryAllUserFSRSKeys(userId) {
    const uidStr = userId.toString();
    const keys = [];
    let lastEvaluatedKey = undefined;

    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": `USER#${uidStr}`,
            ":skPrefix": "FSRS#",
          },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: lastEvaluatedKey,
          ConsistentRead: true,
        })
      );

      if (res.Items) {
        for (const item of res.Items) {
          keys.push({ PK: item.PK, SK: item.SK });
        }
      }
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return keys;
  },

  /**
   * Query all aggregated pattern mastery keys for a user (PK = USER#<id>, SK begins_with PATTERN#).
   */
  async queryAllUserPatternMasteryKeys(userId) {
    const uidStr = userId.toString();
    const keys = [];
    let lastEvaluatedKey = undefined;

    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: TABLES.USER_PATTERN_MASTERY,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": `USER#${uidStr}`,
            ":skPrefix": "PATTERN#",
          },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: lastEvaluatedKey,
          ConsistentRead: true,
        })
      );

      if (res.Items) {
        for (const item of res.Items) {
          keys.push({ PK: item.PK, SK: item.SK });
        }
      }
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return keys;
  },

  /**
   * Heartbeat the reset lock timestamp to prevent it from expiring
   * while a large batch deletion job is actively running.
   */
  async heartbeatResetLock(userId, resetToken) {
    if (!userId || !resetToken) return;
    const uidStr = userId.toString();
    const nowIso = new Date().toISOString();

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: {
            PK: `USER#${uidStr}`,
            SK: "STATS",
          },
          UpdateExpression: "SET resetLockTimestamp = :nowIso, updatedAt = :nowIso",
          ConditionExpression: "resetToken = :token AND resetStatus = :inProgress",
          ExpressionAttributeValues: {
            ":nowIso": nowIso,
            ":token": resetToken,
            ":inProgress": "IN_PROGRESS",
          },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        const error = new Error("Reset lock was superseded or cancelled during batch deletion.");
        error.code = "LOCK_SUPERSEDED";
        error.statusCode = 409;
        throw error;
      }
      // Non-fatal if transient network jitter on a single heartbeat ping
    }
  },

  /**
   * Bulk delete items in chunks of up to 25 with exponential backoff and jitter for UnprocessedItems.
   * Handles throttling, retry exhaustion, and pulses lock heartbeat on each chunk.
   */
  async batchDeleteKeys(tableName, keys, { userId = null, resetToken = null } = {}) {
    if (!keys || keys.length === 0) return 0;

    const CHUNK_SIZE = 25;
    let totalDeleted = 0;

    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      // Validate lock token before deleting this chunk: abort immediately if superseded
      if (userId && resetToken) {
        await this.heartbeatResetLock(userId, resetToken);
      }

      const chunk = keys.slice(i, i + CHUNK_SIZE);
      let unprocessed = {
        [tableName]: chunk.map((k) => ({
          DeleteRequest: { Key: { PK: k.PK, SK: k.SK } },
        })),
      };

      let attempts = 0;
      const maxAttempts = 6;

      while (unprocessed && Object.keys(unprocessed).length > 0 && attempts < maxAttempts) {
        try {
          const res = await docClient.send(
            new BatchWriteCommand({
              RequestItems: unprocessed,
            })
          );

          unprocessed = res.UnprocessedItems;
          if (unprocessed && Object.keys(unprocessed).length > 0) {
            attempts++;
            const jitter = Math.random() * 50;
            const delay = Math.pow(2, attempts) * 50 + jitter;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } catch (err) {
          // Throttling or transient network error: back off and retry
          if (
            err.name === "ProvisionedThroughputExceededException" ||
            err.name === "ThrottlingException" ||
            err.name === "InternalServerError"
          ) {
            attempts++;
            const delay = Math.pow(2, attempts) * 100 + Math.random() * 50;
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            throw err;
          }
        }
      }

      if (unprocessed && Object.keys(unprocessed).length > 0) {
        const error = new Error(`Failed to delete all items from ${tableName} after ${maxAttempts} attempts due to retry exhaustion.`);
        error.code = "BATCH_DELETE_INCOMPLETE";
        error.unprocessed = unprocessed;
        throw error;
      }

      totalDeleted += chunk.length;

      // Heartbeat lock after each chunk to guarantee active resets never become stale
      if (userId && resetToken) {
        await this.heartbeatResetLock(userId, resetToken);
      }
    }

    return totalDeleted;
  },

  /**
   * Strongly consistent verification query to ensure all active progress records have been purged.
   */
  async verifyAllDeleted(userId) {
    const [masteryKeys, fsrsKeys, patternKeys] = await Promise.all([
      this.queryAllUserMasteryKeys(userId),
      this.queryAllUserFSRSKeys(userId),
      this.queryAllUserPatternMasteryKeys(userId),
    ]);

    const isClean =
      masteryKeys.length === 0 &&
      fsrsKeys.length === 0 &&
      patternKeys.length === 0;

    return {
      isClean,
      remainingMastery: masteryKeys.length,
      remainingFSRS: fsrsKeys.length,
      remainingPatterns: patternKeys.length,
    };
  },

  /**
   * Atomically finalize a successful reset:
   * Sets resetStatus to 'IDLE', wipes userStats counters, and stamps lastResetAt.
   * Condition: resetToken must match the current lock holder.
   */
  async finalizeResetSuccess(userId, resetToken) {
    const uidStr = userId.toString();
    const nowIso = new Date().toISOString();

    const res = await docClient.send(
      new UpdateCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: {
          PK: `USER#${uidStr}`,
          SK: "STATS",
        },
        UpdateExpression: `
          SET resetStatus = :idle,
              totalSolved = :zero,
              totalMasterySum = :zero,
              averageMastery = :zero,
              patternsCovered = :zero,
              lastResetAt = :nowIso,
              updatedAt = :nowIso
          REMOVE resetToken, resetLockTimestamp, lastResetError
        `,
        ConditionExpression: "resetToken = :token",
        ExpressionAttributeValues: {
          ":idle": "IDLE",
          ":zero": 0,
          ":nowIso": nowIso,
          ":token": resetToken,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return res.Attributes;
  },

  /**
   * Record a partial failure so the user / frontend knows the state is incomplete
   * and can safely retry without exposing inconsistent progress.
   */
  async recordResetFailure(userId, resetToken, errorDetails) {
    const uidStr = userId.toString();
    const nowIso = new Date().toISOString();

    console.error(`[CPRecal Observability] RESET_PARTIAL_FAILURE recorded for user ${uidStr}:`, errorDetails);

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLES.USER_PROBLEM_DATA,
          Key: {
            PK: `USER#${uidStr}`,
            SK: "STATS",
          },
          UpdateExpression: `
            SET resetStatus = :failed,
                lastResetError = :err,
                failedAt = :nowIso,
                updatedAt = :nowIso
            REMOVE resetLockTimestamp
          `,
          ConditionExpression: "resetToken = :token",
          ExpressionAttributeValues: {
            ":failed": "FAILED_PARTIAL",
            ":err": errorDetails || "Partial reset failure occurred during batch operations.",
            ":nowIso": nowIso,
            ":token": resetToken,
          },
        })
      );
    } catch (err) {
      console.warn(`[CPRecal Observability] Could not stamp reset failure on user ${uidStr} (likely superseded):`, err.message);
    }
  },

  /**
   * Save a completion prompt dismissal scoped to the user and their current completion cycle.
   */
  async dismissCompletion(userId, completionCycle = 0) {
    const uidStr = userId.toString();
    const nowIso = new Date().toISOString();

    const item = {
      PK: `USER#${uidStr}`,
      SK: "COMPLETION_DISMISSAL",
      userId: uidStr,
      completionCycle: Number(completionCycle) || 0,
      dismissedAt: nowIso,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Item: item,
      })
    );

    return item;
  },

  /**
   * Retrieve the user's completion prompt dismissal record if it exists.
   */
  async getCompletionDismissal(userId) {
    const uidStr = userId.toString();

    const res = await docClient.send(
      new GetCommand({
        TableName: TABLES.USER_PROBLEM_DATA,
        Key: {
          PK: `USER#${uidStr}`,
          SK: "COMPLETION_DISMISSAL",
        },
        ConsistentRead: true,
      })
    );

    return res.Item || null;
  },
};

export default progressResetRepo;
