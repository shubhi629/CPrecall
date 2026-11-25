import ProblemMastery from "../../models/ProblemMastery.js";
import SolvingSession from "../../models/SolvingSession.js";
import PatternMastery from "../../models/PatternMastery.js";
import FSRSState from "../../models/FSRSState.js";
import Problem from "../../models/Problem.js";
import { getProblemsOverdue } from "../fsrs/scheduler.js";
import {
  getStrongPatterns,
  getWeakPatterns,
} from "../mastery/patternMastery.js";
import { selectRecallTargets } from "../fsrs/recallSelector.js";
import { isDynamoDB } from "../../config/dbBackend.js";
import problemMasteryRepo from "../../repositories/problemMasteryRepo.js";
import patternMasteryRepo from "../../repositories/patternMasteryRepo.js";
import fsrsStateRepo from "../../repositories/fsrsStateRepo.js";
import problemRepo from "../../repositories/problemRepo.js";
import progressResetRepo from "../../repositories/progressResetRepo.js";

/**
 * Get complete dashboard data for a user
 */
export async function getDashboardData(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isDynamoDB()) {
    // 1. Fetch independent core queries in parallel
    const [stats, allUserPatterns, dueToday, solvedRecords, allPatterns, dismissal, totalProblemsCount] = await Promise.all([
      problemMasteryRepo.getUserStats(userId),
      patternMasteryRepo.getUserPatternMasteries(userId),
      fsrsStateRepo.getDueReviews(userId, tomorrow.toISOString()),
      problemMasteryRepo.getUserSolvedProblems(userId),
      problemRepo.getAllPatterns(),
      progressResetRepo.getCompletionDismissal(userId),
      problemRepo.getTotalProblemsCount(),
    ]);

    // Unique active solved count from active mastery records
    const uniqueSolvedCount = (solvedRecords || []).length;
    const totalProblems = Number(totalProblemsCount) || 0;
    const isLibraryCompleted = uniqueSolvedCount === totalProblems && totalProblems > 0;
    const currentCycle = stats.resetVersion || 0;
    const completionPromptDismissed = dismissal?.completionCycle === currentCycle;

    // 2. Compute pattern mastery data and rankings in memory (0 network latency)
    const userPatterns = allUserPatterns || [];
    const patternsCovered = userPatterns.filter((p) => (p.totalProblemsAttempted || 0) > 0).length;
    const totalPatterns = allPatterns.length || 1;

    const patternMasteryMap = new Map();
    userPatterns.forEach((p) => {
      if (p.pattern) patternMasteryMap.set(p.pattern, p.mastery ?? 0);
    });

    const weakPatterns = [...userPatterns]
      .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
      .slice(0, 3);

    const strongPatterns = [...userPatterns]
      .sort((a, b) => (b.mastery ?? 0) - (a.mastery ?? 0))
      .slice(0, 3);

    // 3. Batch get metadata for due problems (from memoryCatalog in RAM)
    const dueProblemIds = dueToday.map((d) => d.problemId);
    const problemsMeta = await problemRepo.batchGetProblems(dueProblemIds);
    const probMap = new Map(problemsMeta.map((p) => [(p.problemId || p._id).toString(), p]));

    const populatedDue = dueToday.map((d) => ({
      ...d,
      problemId: probMap.get(d.problemId.toString()) || { _id: d.problemId, problemId: d.problemId, patterns: [] },
    }));

    // 4. Resolve recall targets passing preloaded maps (0 N+1 remote queries)
    const solvedProblemIds = (solvedRecords || []).map((s) => s.problemId.toString());
    const resolvedTargets = await selectRecallTargets(
      populatedDue,
      userId,
      patternMasteryMap,
      solvedProblemIds
    );

    const todayRecall = resolvedTargets.map((target) => ({
      id: target.problem.problemId || target.problem._id || target.problem.id,
      title: target.problem.title,
      titleSlug: target.problem.titleSlug,
      difficulty: target.problem.difficulty,
      patterns: target.problem.patterns,
      masteryScore: 0,
      patternsWithMastery: target.patternsWithMastery,
      reviewDue: true,
      originalDueProblemId: target.originalDueProblemId,
    }));

    return {
      stats: {
        totalSolved: uniqueSolvedCount,
        totalAttempted: stats.totalAttempted,
        totalProblems,
        isLibraryCompleted,
        completionPromptDismissed,
        patternsCovered,
        patternsAttempted: patternsCovered,
        totalPatterns,
        duePatternsCount: todayRecall.length,
        reviewDue: todayRecall.length,
        averageMastery: stats.averageMastery,
      },
      todaysRevision: todayRecall,
      weakPatterns,
      strongPatterns,
    };
  }

  // MongoDB mode: Parallelize independent database queries
  const [
    totalSolved,
    totalAttempted,
    patternsCovered,
    dueToday,
    allPatternMasteries,
    allMasteries,
    uniquePatterns,
  ] = await Promise.all([
    ProblemMastery.countDocuments({ userId }),
    SolvingSession.countDocuments({ userId }),
    PatternMastery.countDocuments({ userId, totalProblemsAttempted: { $gt: 0 } }),
    FSRSState.find({ userId, nextReviewDate: { $lt: tomorrow } })
      .populate({ path: "problemId", select: "title difficulty patterns" })
      .lean(),
    PatternMastery.find({ userId }).lean(),
    ProblemMastery.find({ userId }).select("mastery problemId").lean(),
    Problem.distinct("patterns"),
  ]);

  const patternMasteryMap = new Map();
  allPatternMasteries.forEach((p) => {
    if (p.pattern) patternMasteryMap.set(p.pattern, p.mastery ?? 0);
  });

  const solvedProblemIds = allMasteries.map((m) => m.problemId.toString());
  const resolvedTargets = await selectRecallTargets(
    dueToday,
    userId,
    patternMasteryMap,
    solvedProblemIds
  );

  const todayRecall = resolvedTargets.map((target) => ({
    id: target.problem._id,
    title: target.problem.title,
    titleSlug: target.problem.titleSlug,
    difficulty: target.problem.difficulty,
    patterns: target.problem.patterns,
    masteryScore: 0,
    patternsWithMastery: target.patternsWithMastery,
    reviewDue: true,
    originalDueProblemId: target.originalDueProblemId,
  }));

  const weakPatterns = [...allPatternMasteries]
    .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
    .slice(0, 3);
  const strongPatterns = [...allPatternMasteries]
    .sort((a, b) => (b.mastery ?? 0) - (a.mastery ?? 0))
    .slice(0, 3);

  const averageMastery = allMasteries.length > 0
    ? Math.round(allMasteries.reduce((sum, m) => sum + (m.mastery || 0), 0) / allMasteries.length)
    : 0;

  const totalPatterns = uniquePatterns.length || 1;

  return {
    stats: {
      totalSolved,
      totalAttempted,
      patternsCovered,
      patternsAttempted: patternsCovered,
      totalPatterns,
      duePatternsCount: todayRecall.length,
      reviewDue: todayRecall.length,
      averageMastery,
    },
    todaysRevision: todayRecall,
    weakPatterns,
    strongPatterns,
  };
}

/**
 * Get stats only (lighter weight)
 */
export async function getDashboardStats(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isDynamoDB()) {
    const [stats, allUserPatterns, dueToday, solvedRecords, dismissal, totalProblemsCount] = await Promise.all([
      problemMasteryRepo.getUserStats(userId),
      patternMasteryRepo.getUserPatternMasteries(userId),
      fsrsStateRepo.getDueReviews(userId, tomorrow.toISOString()),
      problemMasteryRepo.getUserSolvedProblems(userId),
      progressResetRepo.getCompletionDismissal(userId),
      problemRepo.getTotalProblemsCount(),
    ]);
    const patternsCovered = (allUserPatterns || []).filter((p) => (p.totalProblemsAttempted || 0) > 0).length;
    const uniqueSolvedCount = (solvedRecords || []).length;
    const totalProblems = Number(totalProblemsCount) || 0;
    const isLibraryCompleted = uniqueSolvedCount === totalProblems && totalProblems > 0;
    const currentCycle = stats.resetVersion || 0;
    const completionPromptDismissed = dismissal?.completionCycle === currentCycle;

    return {
      totalSolved: uniqueSolvedCount,
      totalAttempted: stats.totalAttempted,
      totalProblems,
      isLibraryCompleted,
      completionPromptDismissed,
      patternsCovered,
      reviewDue: dueToday.length,
    };
  }

  const [totalSolved, totalAttempted, patternsCovered, reviewDue] = await Promise.all([
    ProblemMastery.countDocuments({ userId }),
    SolvingSession.countDocuments({ userId }),
    PatternMastery.countDocuments({ userId, totalProblemsAttempted: { $gt: 0 } }),
    FSRSState.countDocuments({ userId, nextReviewDate: { $lt: tomorrow } }),
  ]);

  return {
    totalSolved,
    totalAttempted,
    patternsCovered,
    reviewDue,
  };
}
