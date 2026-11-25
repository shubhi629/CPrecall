import Problem from "../../models/Problem.js";
import ProblemMastery from "../../models/ProblemMastery.js";
import SolvingSession from "../../models/SolvingSession.js";
import Submission from "../../models/Submission.js";
import AcceptedSolution from "../../models/AcceptedSolution.js";
import ReviewHistory from "../../models/ReviewHistory.js";
import FSRSState from "../../models/FSRSState.js";
import {
  calculateProblemMastery,
  saveProblemMastery,
  getProblemMastery,
} from "../mastery/problemMastery.js";
import { updateUserPatterns } from "../mastery/patternMastery.js";
import { createOrUpdateFSRSState } from "../fsrs/scheduler.js";
import mongoose from "mongoose";
import { isDynamoDB, isDualWrite } from "../../config/dbBackend.js";
import problemRepo from "../../repositories/problemRepo.js";
import solvingSessionRepo from "../../repositories/solvingSessionRepo.js";
import submissionRepo from "../../repositories/submissionRepo.js";
import acceptedSolutionRepo from "../../repositories/acceptedSolutionRepo.js";
import reviewHistoryRepo from "../../repositories/reviewHistoryRepo.js";
import problemMasteryRepo from "../../repositories/problemMasteryRepo.js";
import progressResetRepo from "../../repositories/progressResetRepo.js";

/**
 * Process submission from Tampermonkey extension
 * This is the main end-to-end ingestion flow
 *
 * Steps:
 * 1. Find or create global Problem
 * 2. Create SolvingSession
 * 3. Create Submission records
 * 4. Create AcceptedSolution
 * 5. Calculate ProblemMastery
 * 6. Update PatternMastery
 * 7. Create/Update FSRSState
 * 8. Create ReviewHistory
 * 9. Return result
 */
export async function processSubmission(userId, submissionPayload) {
  const {
    problemId: leetcodeId,
    title,
    titleSlug,
    difficulty,
    patterns,
    sessionStart,
    sessionEnd,
    submissionHistory,
    acceptedSubmissionId,
    acceptedCode,
    language,
    hintsUsed = 0,
    analysisResult,
  } = submissionPayload;

  if (isDynamoDB()) {
    if (await progressResetRepo.isResetInProgress(userId)) {
      const error = new Error("Cannot process submission: account progress reset is currently in progress.");
      error.statusCode = 409;
      error.code = "RESET_IN_PROGRESS";
      throw error;
    }

    // Step 1: Find or create global Problem
    let problem = await problemRepo.getProblemByLeetcodeId(leetcodeId);
    if (!problem) {
      problem = await problemRepo.createOrUpdateProblem({
        leetcodeId,
        title,
        titleSlug: (titleSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")).toLowerCase(),
        difficulty,
        patterns,
      });
    }

    const pIdStr = (problem.problemId || problem._id).toString();

    // Step 2: Create SolvingSession
    const totalTimeSeconds = Math.round(
      (new Date(sessionEnd) - new Date(sessionStart)) / 1000
    );
    const session = await solvingSessionRepo.createSession({
      userId,
      problemId: pIdStr,
      startTime: sessionStart,
      endTime: sessionEnd,
      totalTimeSeconds,
    });

    await problemMasteryRepo.incrementUserAttempted(userId);

    // Step 3: Create Submission records for each attempt
    const submissionItems = (submissionHistory || []).map((sub) => ({
      userId,
      problemId: pIdStr,
      sessionId: session.sessionId,
      submissionId: sub.submissionId,
      status: sub.status,
      runtime: sub.runtime,
      memory: sub.memory,
      language: sub.language || language,
      timestamp: sub.timestamp,
    }));

    await submissionRepo.batchCreateSubmissions(userId, submissionItems);

    const acceptedSub = submissionItems.find((s) => s.status === "Accepted");
    if (!acceptedSub) {
      throw new Error("No accepted submission found in submission history");
    }

    // Step 4: Upsert AcceptedSolution (claim-check overflow if >= 300 KB)
    await acceptedSolutionRepo.saveAcceptedSolution(userId, pIdStr, {
      submissionId: acceptedSub.submissionId,
      code: acceptedCode,
      language,
      runtime: acceptedSub.runtime,
      memory: acceptedSub.memory,
      analysisResult,
      solvedAt: acceptedSub.timestamp,
    });

    // Step 5: Calculate & Save ProblemMastery
    const masteryResult = await calculateProblemMastery({
      actualTimeComplexity: analysisResult.actualTimeComplexity,
      actualSpaceComplexity: analysisResult.actualSpaceComplexity,
      optimalTimeComplexity: analysisResult.optimalTimeComplexity,
      optimalSpaceComplexity: analysisResult.optimalSpaceComplexity,
      totalSubmissions: submissionItems.length,
      totalTimeSeconds: session.totalTimeSeconds,
      hintsUsed,
      difficulty,
    });

    const existingProblemMastery = await getProblemMastery(userId, pIdStr);
    const previousMastery = existingProblemMastery ? existingProblemMastery.mastery : null;

    const problemMastery = await saveProblemMastery(userId, pIdStr, {
      solvingSessionId: session.sessionId,
      acceptedSubmissionId: acceptedSub.submissionId,
      totalSubmissions: submissionItems.length,
      solvedAt: acceptedSub.timestamp,
      hintsUsedCount: hintsUsed,
      totalTimeSeconds: session.totalTimeSeconds,
      ...masteryResult,
    });

    // Step 6: Update PatternMastery for each pattern
    await updateUserPatterns(userId, pIdStr);

    // Step 7: Create/Update FSRSState
    const fsrsState = await createOrUpdateFSRSState(
      userId,
      pIdStr,
      problemMastery.mastery
    );

    // Step 8: Create ReviewHistory
    await reviewHistoryRepo.createReviewHistory({
      userId,
      problemId: pIdStr,
      reviewedAt: new Date(),
      previousMastery,
      newMastery: problemMastery.mastery,
      fsrsRating: fsrsState.rating,
      status: "completed",
    });

    // Shadow dual-write to MongoDB if dual-write mode enabled
    if (isDualWrite()) {
      try {
        let mProb = await Problem.findOne({ leetcodeId });
        if (!mProb && mongoose.Types.ObjectId.isValid(pIdStr)) {
          mProb = await Problem.create({
            _id: new mongoose.Types.ObjectId(pIdStr),
            leetcodeId,
            title: problem.title,
            titleSlug: problem.titleSlug,
            difficulty: problem.difficulty,
            patterns: problem.patterns,
          });
        }
        if (mProb) {
          const mSess = await SolvingSession.create({
            userId: new mongoose.Types.ObjectId(userId),
            problemId: mProb._id,
            startTime: new Date(sessionStart),
            endTime: new Date(sessionEnd),
            totalTimeSeconds: session.totalTimeSeconds,
          });
          const mSubmissions = [];
          for (const sub of submissionItems) {
            const mSub = await Submission.create({
              userId: new mongoose.Types.ObjectId(userId),
              problemId: mProb._id,
              sessionId: mSess._id,
              submissionId: sub.submissionId,
              status: sub.status,
              runtime: sub.runtime,
              memory: sub.memory,
              language: sub.language,
              timestamp: new Date(sub.timestamp),
            });
            mSubmissions.push(mSub);
          }
          const mAcceptedSub = mSubmissions.find((s) => s.status === "Accepted") || mSubmissions[0];
          await AcceptedSolution.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId), problemId: mProb._id },
            {
              submissionId: mAcceptedSub._id,
              code: acceptedCode,
              language,
              runtime: acceptedSub.runtime,
              memory: acceptedSub.memory,
              analysisResult,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          await ProblemMastery.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId), problemId: mProb._id },
            {
              solvingSessionId: mSess._id,
              acceptedSubmissionId: mAcceptedSub._id,
              totalSubmissions: submissionItems.length,
              solvedAt: new Date(acceptedSub.timestamp),
              components: problemMastery.components,
              mastery: problemMastery.mastery,
              hintsUsedCount: hintsUsed,
              totalTimeSeconds: session.totalTimeSeconds,
            },
            { upsert: true, new: true }
          );
          await FSRSState.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId), problemId: mProb._id },
            {
              rating: fsrsState.rating,
              nextReviewDate: fsrsState.nextReviewDate,
              intervalDays: fsrsState.intervalDays,
              easeFactor: fsrsState.easeFactor,
              reviewHistory: fsrsState.reviewHistory,
            },
            { upsert: true, new: true }
          );
        }
      } catch (err) {
        console.warn("[DualWrite] Shadow write to MongoDB failed:", err.message);
      }
    }

    // Step 9: Return result with all calculated data
    return {
      success: true,
      problem: {
        id: pIdStr,
        title: problem.title,
        difficulty: problem.difficulty,
      },
      problemMastery: {
        mastery: problemMastery.mastery,
        components: problemMastery.components,
      },
      fsrs: {
        rating: fsrsState.rating,
        nextReviewDate: fsrsState.nextReviewDate,
        intervalDays: fsrsState.intervalDays,
      },
      session: {
        totalTimeSeconds: session.totalTimeSeconds,
        submissions: submissionItems.length,
      },
    };
  }

  // Step 1: Find or create global Problem
  let problem = await Problem.findOne({ leetcodeId });
  if (!problem) {
    problem = await Problem.create({
      leetcodeId,
      title,
      titleSlug: titleSlug.toLowerCase(),
      difficulty,
      patterns,
    });
  }

  // Step 2: Create SolvingSession
  const session = await SolvingSession.create({
    userId,
    problemId: problem._id,
    startTime: new Date(sessionStart),
    endTime: new Date(sessionEnd),
    totalTimeSeconds: Math.round(
      (new Date(sessionEnd) - new Date(sessionStart)) / 1000,
    ),
  });

  // Step 3: Create Submission records for each attempt
  const submissions = [];
  for (const sub of submissionHistory) {
    const submission = await Submission.create({
      userId,
      problemId: problem._id,
      sessionId: session._id,
      submissionId: sub.submissionId,
      status: sub.status,
      runtime: sub.runtime,
      memory: sub.memory,
      language: sub.language || language,
      timestamp: new Date(sub.timestamp),
    });
    submissions.push(submission);
  }

  // Find accepted submission for reference
  const acceptedSub = submissions.find((s) => s.status === "Accepted");
  if (!acceptedSub) {
    throw new Error("No accepted submission found in submission history");
  }

  // Step 4: Upsert AcceptedSolution so repeated solves for the same problem
  // do not violate the unique userId+problemId constraint.
  const acceptedSolution = await AcceptedSolution.findOneAndUpdate(
    { userId, problemId: problem._id },
    {
      submissionId: acceptedSub._id,
      code: acceptedCode,
      language,
      runtime: acceptedSub.runtime,
      memory: acceptedSub.memory,
      analysisResult,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );

  // Step 5: Calculate ProblemMastery
  const masteryResult = await calculateProblemMastery({
    actualTimeComplexity: analysisResult.actualTimeComplexity,
    actualSpaceComplexity: analysisResult.actualSpaceComplexity,
    optimalTimeComplexity: analysisResult.optimalTimeComplexity,
    optimalSpaceComplexity: analysisResult.optimalSpaceComplexity,
    totalSubmissions: submissions.length,
    totalTimeSeconds: session.totalTimeSeconds,
    hintsUsed,
    difficulty,
  });

  // Fetch existing ProblemMastery to record in ReviewHistory before updating
  const existingProblemMastery = await getProblemMastery(userId, problem._id);
  const previousMastery = existingProblemMastery ? existingProblemMastery.mastery : null;

  // Save ProblemMastery
  const problemMastery = await saveProblemMastery(userId, problem._id, {
    solvingSessionId: session._id,
    acceptedSubmissionId: acceptedSub._id,
    totalSubmissions: submissions.length,
    solvedAt: acceptedSub.timestamp,
    hintsUsedCount: hintsUsed,
    totalTimeSeconds: session.totalTimeSeconds,
    ...masteryResult,
  });

  // Step 6: Update PatternMastery for each pattern
  await updateUserPatterns(userId, problem._id);

  // Step 7: Create/Update FSRSState
  const fsrsState = await createOrUpdateFSRSState(
    userId,
    problem._id,
    problemMastery.mastery,
  );

  // Step 8: Create ReviewHistory
  await ReviewHistory.create({
    userId,
    problemId: problem._id,
    reviewedAt: new Date(),
    previousMastery: previousMastery,
    newMastery: problemMastery.mastery,
    fsrsRating: fsrsState.rating,
    status: "completed",
  });


  // Step 9: Return result with all calculated data
  return {
    success: true,
    problem: {
      id: problem._id,
      title: problem.title,
      difficulty: problem.difficulty,
    },
    problemMastery: {
      mastery: problemMastery.mastery,
      components: problemMastery.components,
    },
    fsrs: {
      rating: fsrsState.rating,
      nextReviewDate: fsrsState.nextReviewDate,
      intervalDays: fsrsState.intervalDays,
    },
    session: {
      totalTimeSeconds: session.totalTimeSeconds,
      submissions: submissions.length,
    },
  };
}
