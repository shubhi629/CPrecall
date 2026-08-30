import mongoose from "mongoose";

const patternMasterySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    pattern: {
      type: String,
      required: [true, "Pattern name is required"],
    },
    // Aggregated from ProblemMastery records
    totalProblemsAttempted: {
      type: Number,
      default: 0,
    },
    totalProblemsSolved: {
      type: Number,
      default: 0,
    },
    // Weighted average mastery (0-100)
    mastery: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Average of component masteries
    components: {
      solutionEfficiency: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      timeComplexity: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      submissionsUntilSuccess: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      timeTaken: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      hintsUsed: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Unique compound index: one pattern mastery per user per pattern
patternMasterySchema.index({ userId: 1, pattern: 1 }, { unique: true });
patternMasterySchema.index({ userId: 1, mastery: -1 });
patternMasterySchema.index({ userId: 1 });

export const PatternMastery = mongoose.model(
  "PatternMastery",
  patternMasterySchema,
);
export default PatternMastery;
