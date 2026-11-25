import {
  resetUserProgress,
  dismissCompletionPrompt,
} from "../services/progress/progressResetService.js";

/**
 * POST /api/progress/reset
 * Atomically resets all active question-solving and learning progress for the authenticated user.
 */
export const resetProgress = async (req, res, next) => {
  try {
    // Security Guardrail: Never trust a user ID supplied in the request body
    const userId = req.user.userId;

    const result = await resetUserProgress(userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/progress/dismiss-completion
 * Dismisses the completion prompt for the user's current completion cycle.
 */
export const dismissCompletion = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await dismissCompletionPrompt(userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
