import ProblemMastery from "../../models/ProblemMastery.js";
import PatternMastery from "../../models/PatternMastery.js";
import Problem from "../../models/Problem.js";
import { isDynamoDB } from "../../config/dbBackend.js";
import problemRepo from "../../repositories/problemRepo.js";
import problemMasteryRepo from "../../repositories/problemMasteryRepo.js";
import patternMasteryRepo from "../../repositories/patternMasteryRepo.js";

/**
 * A -> B Recall Target Resolution Engine
 * 
 * CORE ARCHITECTURAL PRINCIPLE:
 * FSRS State acts as the TIMER / TRIGGER (Problem A, previously solved by user).
 * When A is due or scheduled, CPRecal dynamically selects a DIFFERENT, UNSOLVED
 * Problem B that exercises the same weak DSA pattern to reinforce understanding.
 * 
 * Target B requirements:
 * 1. B != A (never return the solved trigger problem)
 * 2. B is unsolved by the user (B not in user's ProblemMastery)
 * 3. B exercises the weakest pattern associated with Problem A
 * 4. Exhaustion rule: If no unsolved problems match the pattern, return an empty
 *    array; NEVER fall back to Problem A.
 * 
 * @param {Array} fsrsTriggers - Array of populated FSRSState documents (with problemId populated)
 * @param {String} userId - User ID to check masteries
 * @param {Map} [preloadedMasteryMap] - Optional pre-cached Map<pattern, mastery>
 * @param {Array} [preloadedSolvedIds] - Optional pre-cached array of solved problem IDs
 * @returns {Promise<Array>} - Array of resolved recall targets with originalDueProblemId & nextReviewDate
 */
export async function selectRecallTargets(fsrsTriggers, userId, preloadedMasteryMap = null, preloadedSolvedIds = null) {
  // Get all solved problem IDs
  let solvedProblemIds = [];
  if (Array.isArray(preloadedSolvedIds)) {
    solvedProblemIds = preloadedSolvedIds;
  } else if (isDynamoDB()) {
    const solved = await problemMasteryRepo.getUserSolvedProblems(userId);
    solvedProblemIds = solved.map((s) => s.problemId.toString());
  } else {
    const userMasteries = await ProblemMastery.find({ userId }).select("problemId");
    solvedProblemIds = userMasteries.map((m) => m.problemId.toString());
  }
  
  // Pre-load all pattern masteries in one query to prevent N+1 remote roundtrips
  let patternMasteryMap = preloadedMasteryMap;
  if (!patternMasteryMap) {
    patternMasteryMap = new Map();
    if (isDynamoDB()) {
      const allPM = await patternMasteryRepo.getUserPatternMasteries(userId);
      (allPM || []).forEach((pm) => {
        if (pm.pattern) patternMasteryMap.set(pm.pattern, pm.mastery ?? 0);
      });
    } else {
      const allPM = await PatternMastery.find({ userId }).select("pattern mastery").lean();
      (allPM || []).forEach((pm) => {
        if (pm.pattern) patternMasteryMap.set(pm.pattern, pm.mastery ?? 0);
      });
    }
  }

  const selectedRecallProblemIds = new Set();
  const resolvedTargets = [];
  
  for (const dueProblem of fsrsTriggers) {
    const pObj = dueProblem.problemId;
    if (!pObj || (!pObj._id && !pObj.problemId && !pObj.id)) {
      continue; // Skip if problem doesn't exist
    }

    const originalProblemId = pObj._id || pObj.problemId || pObj.id;
    const patterns = Array.isArray(pObj.patterns) ? pObj.patterns : [];

    // Get pattern masteries for this problem using pre-loaded map (instant O(1))
    const patternsWithMastery = patterns.map((pattern) => ({
      name: pattern,
      cumulativeMastery: patternMasteryMap.get(pattern) ?? 0,
    }));

    // Sort patterns by mastery ascending (weakest first)
    const sortedPatterns = [...patternsWithMastery].sort((a, b) => a.cumulativeMastery - b.cumulativeMastery);
    const relevantPattern = sortedPatterns.length > 0 ? sortedPatterns[0].name : null;
    const relevantMastery = sortedPatterns.length > 0 ? sortedPatterns[0].cumulativeMastery : 0;
    
    let selectedProblem = null;
    
    if (relevantPattern) {
      // Exclude solved problems, the original problem itself, and any problems already selected in this batch
      const excludeIds = new Set([
        ...solvedProblemIds,
        originalProblemId.toString(),
        ...Array.from(selectedRecallProblemIds),
      ]);
      
      // Determine target difficulty based on pattern mastery
      let targetDifficulty = "Easy";
      if (relevantMastery >= 50 && relevantMastery < 80) targetDifficulty = "Medium";
      else if (relevantMastery >= 80) targetDifficulty = "Hard";

      if (isDynamoDB()) {
        // 1. Try to find a matching problem with the target difficulty
        let candidateProblems = await problemRepo.getProblemsByPattern(relevantPattern, {
          difficulty: targetDifficulty,
        });
        candidateProblems = candidateProblems.filter((p) => !excludeIds.has((p.problemId || p._id).toString()));

        // 2. Fallback to any difficulty if none found
        if (candidateProblems.length === 0) {
          candidateProblems = await problemRepo.getProblemsByPattern(relevantPattern);
          candidateProblems = candidateProblems.filter((p) => !excludeIds.has((p.problemId || p._id).toString()));
        }

        if (candidateProblems.length > 0) {
          // Shuffle and pick 1 to avoid showing the same one to every user
          const picked = candidateProblems.sort(() => 0.5 - Math.random())[0];
          selectedProblem = {
            _id: picked.problemId || picked._id,
            id: picked.problemId || picked._id,
            leetcodeId: picked.leetcodeId,
            title: picked.title || picked.problemTitle,
            titleSlug: picked.titleSlug,
            difficulty: picked.difficulty || picked.problemDifficulty,
            patterns: picked.patterns,
          };
          selectedRecallProblemIds.add((picked.problemId || picked._id).toString());
        }
      } else {
        // Mongoose query
        let candidateProblems = await Problem.find({
          patterns: relevantPattern,
          _id: { $nin: Array.from(excludeIds) },
          difficulty: targetDifficulty
        }).limit(10);
        
        if (candidateProblems.length === 0) {
          candidateProblems = await Problem.find({
            patterns: relevantPattern,
            _id: { $nin: Array.from(excludeIds) }
          }).limit(10);
        }
        
        if (candidateProblems.length > 0) {
          selectedProblem = candidateProblems.sort(() => 0.5 - Math.random())[0];
          selectedRecallProblemIds.add(selectedProblem._id.toString());
        }
      }
    }
    
    if (selectedProblem) {
      resolvedTargets.push({
        problem: selectedProblem,
        originalDueProblemId: originalProblemId,
        relevantPattern: relevantPattern,
        relevantMastery: relevantMastery,
        nextReviewDate: dueProblem.nextReviewDate,
        patternsWithMastery: [{
          name: relevantPattern,
          cumulativeMastery: relevantMastery
        }]
      });
    }
  }
  
  return resolvedTargets;
}
