import progressResetRepo from "../../repositories/progressResetRepo.js";
import problemMasteryRepo from "../../repositories/problemMasteryRepo.js";
import { TABLES } from "../../config/dynamodb.js";

/**
 * Progress Reset Service — Orchestrates atomic, concurrency-safe,
 * verified reset of all user-specific DSA progress in DynamoDB.
 */
export async function resetUserProgress(userId) {
  if (!userId) {
    const error = new Error("User ID is required for progress reset");
    error.statusCode = 400;
    throw error;
  }

  // 1. Acquire concurrency lock to prevent duplicate / racing reset jobs
  const { resetToken, resetVersion } = await progressResetRepo.acquireResetLock(userId);

  try {
    // 2. Query all active progress keys for this user (Zero scans)
    const [masteryKeys, fsrsKeys, patternKeys] = await Promise.all([
      progressResetRepo.queryAllUserMasteryKeys(userId),
      progressResetRepo.queryAllUserFSRSKeys(userId),
      progressResetRepo.queryAllUserPatternMasteryKeys(userId),
    ]);

    // 3. Delete active mastery records (25-item chunks with retries and heartbeat)
    if (masteryKeys.length > 0) {
      await progressResetRepo.batchDeleteKeys(TABLES.USER_PROBLEM_DATA, masteryKeys, { userId, resetToken });
    }

    // 4. Delete active FSRS records (25-item chunks with retries and heartbeat)
    if (fsrsKeys.length > 0) {
      await progressResetRepo.batchDeleteKeys(TABLES.USER_PROBLEM_DATA, fsrsKeys, { userId, resetToken });
    }

    // 5. Delete active pattern mastery records (25-item chunks with retries and heartbeat)
    if (patternKeys.length > 0) {
      await progressResetRepo.batchDeleteKeys(TABLES.USER_PATTERN_MASTERY, patternKeys, { userId, resetToken });
    }

    // 6. Strongly consistent verification check
    // The system MUST NOT report success unless all records are verified gone
    const verification = await progressResetRepo.verifyAllDeleted(userId);
    if (!verification.isClean) {
      const remainingCount =
        verification.remainingMastery +
        verification.remainingFSRS +
        verification.remainingPatterns;
      const errorMsg = `Verification failed: ${remainingCount} items remained in database after batch deletion.`;
      await progressResetRepo.recordResetFailure(userId, resetToken, errorMsg);

      const err = new Error(errorMsg);
      err.statusCode = 500;
      err.code = "RESET_VERIFICATION_FAILED";
      throw err;
    }

    // 7. Atomically finalize success, wipe STATS counters, clear lock token
    const finalizedStats = await progressResetRepo.finalizeResetSuccess(userId, resetToken);

    return {
      success: true,
      message: "Question library progress has been successfully reset. All problems are now incomplete.",
      resetAt: finalizedStats.lastResetAt || new Date().toISOString(),
      resetVersion: finalizedStats.resetVersion || resetVersion,
      stats: {
        totalSolved: 0,
        patternsCovered: 0,
        reviewDue: 0,
        averageMastery: 0,
      },
    };
  } catch (err) {
    // Mark partial failure state so retries can resume cleanly
    if (resetToken && err.code !== "RESET_IN_PROGRESS") {
      await progressResetRepo.recordResetFailure(userId, resetToken, err.message);
    }
    throw err;
  }
}

/**
 * Dismiss completion prompt for the user's current completion cycle.
 */
export async function dismissCompletionPrompt(userId) {
  if (!userId) {
    const error = new Error("User ID is required to dismiss completion prompt");
    error.statusCode = 400;
    throw error;
  }

  const userStats = await problemMasteryRepo.getUserStats(userId);
  const currentCycle = userStats?.resetVersion || 0;

  const dismissal = await progressResetRepo.dismissCompletion(userId, currentCycle);
  return {
    success: true,
    dismissed: true,
    completionCycle: currentCycle,
    dismissedAt: dismissal.dismissedAt,
  };
}

export default {
  resetUserProgress,
  dismissCompletionPrompt,
};
