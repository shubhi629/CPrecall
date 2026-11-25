import PatternMastery from "../models/PatternMastery.js";
import Problem from "../models/Problem.js";
import ProblemMastery from "../models/ProblemMastery.js";
import FSRSState from "../models/FSRSState.js";
import {
  getWeakPatterns,
  getStrongPatterns,
} from "../services/mastery/patternMastery.js";
import { isDynamoDB } from "../config/dbBackend.js";
import patternMasteryRepo from "../repositories/patternMasteryRepo.js";
import problemRepo from "../repositories/problemRepo.js";
import problemMasteryRepo from "../repositories/problemMasteryRepo.js";
import fsrsStateRepo from "../repositories/fsrsStateRepo.js";

/**
 * GET /api/patterns
 * Get all patterns with user mastery
 */
export const getPatterns = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (isDynamoDB()) {
      const [patterns, dueReviews, futureReviews] = await Promise.all([
        patternMasteryRepo.getUserPatternMasteries(userId),
        fsrsStateRepo.getDueReviews(userId, tomorrow.toISOString()),
        fsrsStateRepo.getFutureScheduledReviews(userId, tomorrow.toISOString()),
      ]);

      const allReviews = [...(dueReviews || []), ...(futureReviews || [])];
      const reviewProblemIds = allReviews.map((r) => r.problemId);
      const problemsMeta = await problemRepo.batchGetProblems(reviewProblemIds);
      const problemMap = new Map(problemsMeta.map((p) => [(p.problemId || p._id).toString(), p]));

      const duePatternSet = new Set();
      const earliestReviewByPattern = {};

      allReviews.forEach((state) => {
        const prob = problemMap.get(state.problemId.toString());
        if (prob && prob.patterns && state.nextReviewDate) {
          const reviewDate = new Date(state.nextReviewDate);
          const isDue = reviewDate < tomorrow;

          prob.patterns.forEach((pat) => {
            if (isDue) {
              duePatternSet.add(pat);
            }
            if (!earliestReviewByPattern[pat] || reviewDate < earliestReviewByPattern[pat]) {
              earliestReviewByPattern[pat] = reviewDate;
            }
          });
        }
      });

      const patternsWithRecall = (patterns || []).map((p) => ({
        ...p,
        recallDue: duePatternSet.has(p.pattern),
        nextReviewDate: earliestReviewByPattern[p.pattern] || null,
      }));

      const weakPatterns = [...(patterns || [])]
        .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
        .slice(0, 3);
      const strongPatterns = (patterns || []).slice(0, 3);

      return res.status(200).json({
        patterns: patternsWithRecall,
        weakPatterns,
        strongPatterns,
      });
    }

    // MongoDB mode: Get all pattern masteries and scheduled problems in parallel
    const [patterns, allScheduled] = await Promise.all([
      PatternMastery.find({ userId }).sort({ mastery: -1 }).lean(),
      FSRSState.find({ userId }).populate("problemId", "patterns").lean(),
    ]);

    const duePatternSet = new Set();
    const earliestReviewByPattern = {};

    allScheduled.forEach((state) => {
      if (state.problemId && state.problemId.patterns && state.nextReviewDate) {
        const reviewDate = new Date(state.nextReviewDate);
        const isDue = reviewDate < tomorrow;

        state.problemId.patterns.forEach((pat) => {
          if (isDue) {
            duePatternSet.add(pat);
          }
          
          // Track earliest upcoming date for each pattern
          if (!earliestReviewByPattern[pat] || reviewDate < earliestReviewByPattern[pat]) {
            earliestReviewByPattern[pat] = reviewDate;
          }
        });
      }
    });

    const patternsWithRecall = patterns.map((p) => ({
      ...p,
      recallDue: duePatternSet.has(p.pattern),
      nextReviewDate: earliestReviewByPattern[p.pattern] || null,
    }));

    // Get weak and strong patterns
    const weakPatterns = await getWeakPatterns(userId, 3);
    const strongPatterns = await getStrongPatterns(userId, 3);

    res.status(200).json({
      patterns: patternsWithRecall,
      weakPatterns,
      strongPatterns,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patterns/:patternName
 * Get pattern details with problems
 */
export const getPattern = async (req, res, next) => {
  try {
    const { patternName } = req.params;
    const userId = req.user.userId;

    // Decode URL-encoded pattern name
    const decodedPattern = decodeURIComponent(patternName);

    if (isDynamoDB()) {
      const patternMastery = await patternMasteryRepo.getPatternMastery(userId, decodedPattern);
      if (!patternMastery) {
        return res
          .status(404)
          .json({ message: "Pattern not found for this user" });
      }

      const problems = await problemRepo.getProblemsByPattern(decodedPattern);
      const problemIds = problems.map((p) => (p.problemId || p._id).toString());
      const masteries = await problemMasteryRepo.batchGetProblemMasteries(userId, problemIds);

      const masteriesByProblemId = {};
      masteries.forEach((m) => {
        masteriesByProblemId[m.problemId.toString()] = m;
      });

      const problemsWithMastery = problems.map((p) => {
        const pIdStr = (p.problemId || p._id).toString();
        return {
          id: pIdStr,
          title: p.title || p.problemTitle,
          difficulty: p.difficulty || p.problemDifficulty,
          patterns: p.patterns,
          userMastery: masteriesByProblemId[pIdStr]?.mastery ?? null,
          solved: masteriesByProblemId[pIdStr] ? true : false,
        };
      });

      return res.status(200).json({
        pattern: {
          name: decodedPattern,
          mastery: patternMastery.mastery,
          masteryBreakdown: patternMastery.components,
          totalProblemsAttempted: patternMastery.totalProblemsAttempted,
          totalProblemsSolved: patternMastery.totalProblemsSolved,
        },
        problems: problemsWithMastery,
      });
    }

    // Get pattern mastery for user
    const patternMastery = await PatternMastery.findOne({
      userId,
      pattern: decodedPattern,
    });

    if (!patternMastery) {
      return res
        .status(404)
        .json({ message: "Pattern not found for this user" });
    }

    // Get all problems with this pattern
    const problems = await Problem.find({ patterns: decodedPattern });

    // Get user's mastery for each problem
    const problemIds = problems.map((p) => p._id);
    const masteries = await ProblemMastery.find({
      userId,
      problemId: { $in: problemIds },
    });

    const masteriesByProblemId = {};
    masteries.forEach((m) => {
      masteriesByProblemId[m.problemId] = m;
    });

    // Combine
    const problemsWithMastery = problems.map((p) => ({
      id: p._id,
      title: p.title,
      difficulty: p.difficulty,
      patterns: p.patterns,
      userMastery: masteriesByProblemId[p._id]?.mastery ?? null,
      solved: masteriesByProblemId[p._id] ? true : false,
    }));

    res.status(200).json({
      pattern: {
        name: decodedPattern,
        mastery: patternMastery.mastery,
        masteryBreakdown: patternMastery.components,
        totalProblemsAttempted: patternMastery.totalProblemsAttempted,
        totalProblemsSolved: patternMastery.totalProblemsSolved,
      },
      problems: problemsWithMastery,
    });
  } catch (error) {
    next(error);
  }
};
