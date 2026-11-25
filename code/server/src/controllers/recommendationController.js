import Problem from "../models/Problem.js";
import ProblemMastery from "../models/ProblemMastery.js";
import PatternMastery from "../models/PatternMastery.js";
import { isDynamoDB } from "../config/dbBackend.js";
import patternMasteryRepo from "../repositories/patternMasteryRepo.js";
import problemMasteryRepo from "../repositories/problemMasteryRepo.js";
import problemRepo from "../repositories/problemRepo.js";

/**
 * GET /api/recommendations
 * Recommends fresh problems based on user's weakest patterns.
 */
export const getRecommendations = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    if (isDynamoDB()) {
      const [allUserPatterns, solvedRecords] = await Promise.all([
        patternMasteryRepo.getUserPatternMasteries(userId),
        problemMasteryRepo.getUserSolvedProblems(userId),
      ]);

      const weakPatterns = (allUserPatterns || [])
        .sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0))
        .slice(0, 3);

      if (weakPatterns.length === 0) {
        return res.status(200).json({ recommendations: [] });
      }

      const solvedProblemIds = new Set((solvedRecords || []).map((r) => r.problemId.toString()));

      const recommendations = [];

      for (const patternRecord of weakPatterns) {
        const patternName = patternRecord.pattern;

        let targetDifficulty;
        if (patternRecord.mastery < 50) {
          targetDifficulty = "Easy";
        } else if (patternRecord.mastery < 80) {
          targetDifficulty = "Medium";
        } else {
          targetDifficulty = "Hard";
        }

        let matchedProblems = await problemRepo.getProblemsByPattern(patternName, {
          difficulty: targetDifficulty,
        });
        matchedProblems = matchedProblems.filter(
          (p) => !solvedProblemIds.has((p.problemId || p._id).toString())
        );

        if (matchedProblems.length === 0) {
          matchedProblems = await problemRepo.getProblemsByPattern(patternName);
          matchedProblems = matchedProblems.filter(
            (p) => !solvedProblemIds.has((p.problemId || p._id).toString())
          );
        }

        if (matchedProblems.length > 0) {
          const numToPick = Math.min(matchedProblems.length, 2);
          const shuffled = matchedProblems.sort(() => 0.5 - Math.random());
          const selected = shuffled.slice(0, numToPick);

          selected.forEach((problem) => {
            recommendations.push({
              problem: {
                id: problem.problemId || problem._id,
                leetcodeId: problem.leetcodeId,
                title: problem.title || problem.problemTitle,
                titleSlug: problem.titleSlug,
                difficulty: problem.difficulty || problem.problemDifficulty,
                patterns: problem.patterns,
              },
              targetPattern: patternName,
              patternMastery: patternRecord.mastery,
              reason: `Targeting your weakest pattern (${patternName} - ${Math.round(patternRecord.mastery)}% Mastery)`,
            });
          });
        }
      }

      return res.status(200).json({ recommendations });
    }

    // 1. Identify Weakest Patterns & Solved Problems in parallel
    const [weakPatterns, solvedRecords] = await Promise.all([
      PatternMastery.find({ userId }).sort({ mastery: 1 }).limit(3),
      ProblemMastery.find({ userId }).select("problemId"),
    ]);

    if (!weakPatterns || weakPatterns.length === 0) {
      return res.status(200).json({ recommendations: [] });
    }

    const solvedProblemIds = solvedRecords.map(record => record.problemId);

    // 3. Match & Select Problems
    const recommendations = [];

    for (const patternRecord of weakPatterns) {
      const patternName = patternRecord.pattern;
      
      // Determine target difficulty based on pattern mastery
      let targetDifficulty;
      if (patternRecord.mastery < 50) {
        targetDifficulty = "Easy";
      } else if (patternRecord.mastery < 80) {
        targetDifficulty = "Medium";
      } else {
        targetDifficulty = "Hard";
      }

      // Query global Problem collection
      // Find problems matching the pattern, excluding solved problems
      // Using difficulty as a ranking signal
      let matchedProblems = await Problem.find({
        patterns: patternName,
        _id: { $nin: solvedProblemIds },
        difficulty: targetDifficulty
      }).limit(10); // fetch a few to randomize

      // If strict difficulty match yields nothing, fallback to any difficulty
      if (matchedProblems.length === 0) {
        matchedProblems = await Problem.find({
          patterns: patternName,
          _id: { $nin: solvedProblemIds }
        }).limit(10);
      }

      if (matchedProblems.length > 0) {
        // Randomly pick 1-2 problems from the matched pool to keep it fresh
        const numToPick = Math.min(matchedProblems.length, 2);
        const shuffled = matchedProblems.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, numToPick);

        selected.forEach(problem => {
          recommendations.push({
            problem: {
              id: problem._id,
              leetcodeId: problem.leetcodeId,
              title: problem.title,
              titleSlug: problem.titleSlug,
              difficulty: problem.difficulty,
              patterns: problem.patterns
            },
            targetPattern: patternName,
            patternMastery: patternRecord.mastery,
            reason: `Targeting your weakest pattern (${patternName} - ${Math.round(patternRecord.mastery)}% Mastery)`
          });
        });
      }
    }

    res.status(200).json({ recommendations });
  } catch (error) {
    next(error);
  }
};
